import assert from "node:assert/strict";
import test from "node:test";

import type { AudioControlResult, AudioEngine } from "../src/audio/index.ts";
import { createAudioEngine } from "../src/audio/index.ts";
import { audioProject } from "./audio-fixtures.ts";
import {
  disableCancelAndHoldAtTime,
  FakeAudioContext,
  FakeTimers,
} from "./audio-fakes.ts";

const deferredBuffer = (): {
  readonly promise: Promise<ArrayBuffer>;
  readonly resolve: () => void;
} => {
  let resolveBuffer = (_: ArrayBuffer): void => undefined;
  const promise = new Promise<ArrayBuffer>((resolve) => {
    resolveBuffer = resolve;
  });
  return {
    promise,
    resolve: () => resolveBuffer(new ArrayBuffer(8)),
  };
};

test("prepare resumes context, loads samples, and creates project mixer buses", async () => {
  const context = new FakeAudioContext();
  const timers = new FakeTimers();
  const engine = createAudioEngine({
    createContext: () => context.asAudioContext(),
    loadArrayBuffer: async () => new ArrayBuffer(8),
    setInterval: (callback, milliseconds) => timers.setInterval(callback, milliseconds),
    clearInterval: (handle) => timers.clearInterval(handle),
  });
  engine.replaceProject(audioProject());
  assert.deepEqual(await engine.prepare(), {
    ok: true,
    status: "ready",
    unavailableSoundIds: [],
  });
  assert.equal(context.state, "running");
  assert.equal(engine.getSnapshot().trackBusCount, 2);
  assert.equal(context.panners.length, 2);
});

test("mute and solo update gains without replacing mixer buses", async () => {
  const context = new FakeAudioContext();
  const timers = new FakeTimers();
  const engine = createAudioEngine({
    createContext: () => context.asAudioContext(),
    loadArrayBuffer: async () => new ArrayBuffer(8),
    setInterval: (callback, milliseconds) => timers.setInterval(callback, milliseconds),
    clearInterval: (handle) => timers.clearInterval(handle),
  });
  const before = audioProject();
  engine.replaceProject(before);
  await engine.prepare();
  const gainCount = context.gains.length;
  engine.replaceProject({
    ...before,
    masterVolumeDb: -3,
    tracks: [
      { ...before.tracks[0]!, muted: true, pan: -0.5 },
      { ...before.tracks[1]!, soloed: true, pan: 0.5 },
    ],
  });
  assert.equal(context.gains.length, gainCount);
  assert.equal(context.gains[1]?.gain.value, 0);
  assert.equal(context.gains[2]?.gain.value, 10 ** (-6 / 20));
  assert.equal(context.gains[0]?.gain.value, 10 ** (-3 / 20));
  assert.equal(context.panners[0]?.pan.value, -0.5);
  assert.equal(context.panners[1]?.pan.value, 0.5);
});

test("one missing sample produces degraded preparation and local diagnostics", async () => {
  const context = new FakeAudioContext();
  const timers = new FakeTimers();
  const engine = createAudioEngine({
    createContext: () => context.asAudioContext(),
    loadArrayBuffer: async (url) => {
      if (url.endsWith("hat.wav")) throw new Error("asset missing");
      return new ArrayBuffer(8);
    },
    setInterval: (callback, milliseconds) => timers.setInterval(callback, milliseconds),
    clearInterval: (handle) => timers.clearInterval(handle),
  });
  assert.deepEqual(await engine.prepare(), {
    ok: true,
    status: "degraded",
    unavailableSoundIds: ["hat"],
  });
  assert.deepEqual(engine.getSnapshot().unavailableSoundIds, ["hat"]);
  assert.equal(engine.getSnapshot().lastIssue?.code, "missing_sample");
});

test("blocked preparation and disposal return actionable state", async () => {
  const context = new FakeAudioContext();
  context.resume = async () => undefined;
  const timers = new FakeTimers();
  const engine = createAudioEngine({
    createContext: () => context.asAudioContext(),
    loadArrayBuffer: async () => new ArrayBuffer(8),
    setInterval: (callback, milliseconds) => timers.setInterval(callback, milliseconds),
    clearInterval: (handle) => timers.clearInterval(handle),
  });
  assert.deepEqual(await engine.prepare(), {
    ok: false,
    code: "blocked",
    message: "Audio context is suspended; retry from a user gesture",
  });
  await engine.dispose();
  await engine.dispose();
  assert.equal(engine.getSnapshot().status, "closed");
  assert.equal(context.state, "closed");
});

test("prepare only converts autoplay-policy rejection into blocked state", async () => {
  const unexpectedContext = new FakeAudioContext();
  const unexpected = new TypeError("invalid audio context");
  unexpectedContext.resume = async () => {
    throw unexpected;
  };
  const unexpectedEngine = createAudioEngine({
    createContext: () => unexpectedContext.asAudioContext(),
    loadArrayBuffer: async () => new ArrayBuffer(8),
    setInterval: () => 0,
    clearInterval: () => undefined,
  });
  await assert.rejects(unexpectedEngine.prepare(), unexpected);

  const blockedContext = new FakeAudioContext();
  blockedContext.resume = async () => {
    throw new DOMException("autoplay denied", "NotAllowedError");
  };
  const blockedEngine = createAudioEngine({
    createContext: () => blockedContext.asAudioContext(),
    loadArrayBuffer: async () => new ArrayBuffer(8),
    setInterval: () => 0,
    clearInterval: () => undefined,
  });
  assert.deepEqual(await blockedEngine.prepare(), {
    ok: false,
    code: "blocked",
    message: "Audio context is suspended; retry from a user gesture",
  });
});

test("prepare permanently closes when resume rejects after external closure", async () => {
  const context = new FakeAudioContext();
  const timers = new FakeTimers();
  const engine = createAudioEngine({
    createContext: () => context.asAudioContext(),
    loadArrayBuffer: async () => new ArrayBuffer(8),
    setInterval: (callback, milliseconds) => timers.setInterval(callback, milliseconds),
    clearInterval: (handle) => timers.clearInterval(handle),
  });
  engine.replaceProject(audioProject());
  assert.equal((await engine.prepare()).ok, true);
  assert.equal(engine.getSnapshot().trackBusCount, 2);

  const resumeError = new DOMException("context already closed", "InvalidStateError");
  let closeCalls = 0;
  context.state = "closed";
  context.resume = async (): Promise<void> => {
    throw resumeError;
  };
  context.close = async (): Promise<void> => {
    closeCalls += 1;
    throw resumeError;
  };
  const closedFailure = {
    ok: false,
    code: "closed",
    message: "Audio engine is closed; create a new engine",
  } as const;

  assert.deepEqual(await engine.prepare(), closedFailure);
  assert.equal(engine.getSnapshot().status, "closed");
  assert.equal(engine.getSnapshot().trackBusCount, 0);
  assert.equal(engine.getSnapshot().pendingSources, 0);
  assert.equal(timers.callbacks.size, 0);
  assert.deepEqual(engine.pause(), closedFailure);
  assert.deepEqual(engine.seek(1), closedFailure);
  assert.deepEqual(engine.stop(), closedFailure);
  assert.deepEqual(await engine.play(0), closedFailure);
  await engine.dispose();
  await engine.dispose();
  assert.equal(closeCalls, 0);
});

test("disposing during resume keeps pending and later preparation closed", async () => {
  const context = new FakeAudioContext();
  let resolveResume = (): void => undefined;
  context.resume = () => new Promise<void>((resolve) => {
    resolveResume = resolve;
  });
  const engine = createAudioEngine({
    createContext: () => context.asAudioContext(),
    loadArrayBuffer: async () => new ArrayBuffer(8),
    setInterval: () => 0,
    clearInterval: () => undefined,
  });
  const preparation = engine.prepare();
  await engine.dispose();
  resolveResume();
  assert.deepEqual(await preparation, {
    ok: false,
    code: "closed",
    message: "Audio engine is closed; create a new engine",
  });
  assert.equal(engine.getSnapshot().status, "closed");
  context.resume = async () => undefined;
  assert.deepEqual(await engine.prepare(), {
    ok: false,
    code: "closed",
    message: "Audio engine is closed; create a new engine",
  });
});

test("mixer replacement holds the current value before its five millisecond ramp", async () => {
  const context = new FakeAudioContext();
  const engine = createAudioEngine({
    createContext: () => context.asAudioContext(),
    loadArrayBuffer: async () => new ArrayBuffer(8),
    setInterval: () => 0,
    clearInterval: () => undefined,
  });
  const before = audioProject();
  engine.replaceProject(before);
  await engine.prepare();
  context.currentTime = 2;
  engine.replaceProject({ ...before, masterVolumeDb: -3 });
  assert.deepEqual(context.gains[0]?.gain.events.slice(-2), [
    { method: "hold", time: 2 },
    { method: "linear", value: 10 ** (-3 / 20), time: 2.005 },
  ]);
});

test("mixer fallback preserves the effective value of an interrupted ramp", async () => {
  const context = new FakeAudioContext();
  const createGain = context.createGain.bind(context);
  const createStereoPanner = context.createStereoPanner.bind(context);
  context.createGain = (): GainNode => {
    const node = createGain();
    disableCancelAndHoldAtTime(node.gain);
    return node;
  };
  context.createStereoPanner = (): StereoPannerNode => {
    const node = createStereoPanner();
    disableCancelAndHoldAtTime(node.pan);
    return node;
  };
  const engine = createAudioEngine({
    createContext: () => context.asAudioContext(),
    loadArrayBuffer: async () => new ArrayBuffer(8),
    setInterval: () => 0,
    clearInterval: () => undefined,
  });
  const project = audioProject();
  engine.replaceProject(project);
  await engine.prepare();
  context.currentTime = 0.0025;
  engine.replaceProject({ ...project, masterVolumeDb: -12.041199826559248 });
  assert.deepEqual(context.gains[0]?.gain.events.slice(-3), [
    { method: "cancel", time: 0.0025 },
    { method: "set", value: 0.5, time: 0.0025 },
    { method: "linear", value: 0.25, time: 0.0075 },
  ]);
});

test("play schedules once across overlapping ticks and stops at arrangement end", async () => {
  const context = new FakeAudioContext();
  const timers = new FakeTimers();
  const engine = createAudioEngine({
    createContext: () => context.asAudioContext(),
    loadArrayBuffer: async () => new ArrayBuffer(8),
    setInterval: (callback, milliseconds) => timers.setInterval(callback, milliseconds),
    clearInterval: (handle) => timers.clearInterval(handle),
  });
  engine.replaceProject(audioProject());
  assert.equal((await engine.play(0)).ok, true);
  assert.deepEqual(timers.intervals, [25]);
  assert.equal(context.bufferSources.length, 1);
  timers.tick();
  assert.equal(context.bufferSources.length, 1);
  context.currentTime = 6.1;
  timers.tick();
  assert.equal(engine.getSnapshot().status, "stopped");
});

test("pause, seek, and BPM replacement preserve musical position", async () => {
  const context = new FakeAudioContext();
  const timers = new FakeTimers();
  const engine = createAudioEngine({
    createContext: () => context.asAudioContext(),
    loadArrayBuffer: async () => new ArrayBuffer(8),
    setInterval: (callback, milliseconds) => timers.setInterval(callback, milliseconds),
    clearInterval: (handle) => timers.clearInterval(handle),
  });
  const value = audioProject();
  engine.replaceProject(value);
  await engine.play(0);
  context.currentTime = 1.05;
  engine.replaceProject({ ...value, bpm: 60 });
  assert.equal(engine.getSnapshot().positionStep, 8);
  engine.pause();
  assert.equal(engine.getSnapshot().status, "paused");
  engine.seek(40);
  assert.equal(engine.getSnapshot().positionStep, 40);
  assert.equal(context.oscillators.at(-1)?.startTimes.at(-1), undefined);
});

test("mixer-only replacement does not create a new transport generation", async () => {
  const context = new FakeAudioContext();
  const timers = new FakeTimers();
  const engine = createAudioEngine({
    createContext: () => context.asAudioContext(),
    loadArrayBuffer: async () => new ArrayBuffer(8),
    setInterval: (callback, milliseconds) => timers.setInterval(callback, milliseconds),
    clearInterval: (handle) => timers.clearInterval(handle),
  });
  const before = audioProject();
  engine.replaceProject(before);
  await engine.play(0);
  const sourceCount = context.bufferSources.length;
  engine.replaceProject({
    ...before,
    masterVolumeDb: -6,
    tracks: before.tracks.map((track) => ({ ...track, pan: 0.5 })),
  });
  timers.tick();
  assert.equal(context.bufferSources.length, sourceCount);
});

test("late wakeup drops missed drums and resumes an overlapping synth note", async () => {
  const context = new FakeAudioContext();
  const timers = new FakeTimers();
  const engine = createAudioEngine({
    createContext: () => context.asAudioContext(),
    loadArrayBuffer: async () => new ArrayBuffer(8),
    setInterval: (callback, milliseconds) => timers.setInterval(callback, milliseconds),
    clearInterval: (handle) => timers.clearInterval(handle),
  });
  engine.replaceProject(audioProject());
  await engine.play(32);
  context.currentTime = 1;
  timers.tick();
  assert.equal(engine.getSnapshot().lateWakeups, 1);
  assert.equal(engine.getSnapshot().lastIssue?.code, "late_scheduler");
  assert.equal(context.bufferSources.length, 0);
  assert.equal(context.oscillators.length, 1);
});

test("empty, closed, and repeated controls return specific outcomes", async () => {
  const context = new FakeAudioContext();
  const timers = new FakeTimers();
  const engine = createAudioEngine({
    createContext: () => context.asAudioContext(),
    loadArrayBuffer: async () => new ArrayBuffer(8),
    setInterval: (callback, milliseconds) => timers.setInterval(callback, milliseconds),
    clearInterval: (handle) => timers.clearInterval(handle),
  });
  engine.replaceProject({ ...audioProject(), arrangement: [] });
  assert.deepEqual(await engine.play(0), {
    ok: false,
    code: "nothing_to_play",
    message: "Project arrangement is empty",
  });
  assert.equal(engine.pause().ok, true);
  assert.equal(engine.stop().ok, true);
  await engine.dispose();
  assert.deepEqual(engine.stop(), {
    ok: false,
    code: "closed",
    message: "Audio engine is closed; create a new engine",
  });
});

test("pending play respects later pause, seek, and stop intents", async () => {
  const cases = [
    {
      name: "pause",
      control: (engine: AudioEngine): AudioControlResult => engine.pause(),
      expected: { ok: true, status: "stopped", positionStep: 0 },
    },
    {
      name: "seek",
      control: (engine: AudioEngine): AudioControlResult => engine.seek(12),
      expected: { ok: true, status: "stopped", positionStep: 12 },
    },
    {
      name: "stop",
      control: (engine: AudioEngine): AudioControlResult => engine.stop(),
      expected: { ok: true, status: "stopped", positionStep: 0 },
    },
  ] as const;

  for (const { name, control, expected } of cases) {
    const context = new FakeAudioContext();
    const timers = new FakeTimers();
    const loading = deferredBuffer();
    const engine = createAudioEngine({
      createContext: () => context.asAudioContext(),
      loadArrayBuffer: async () => loading.promise,
      setInterval: (callback, milliseconds) => timers.setInterval(callback, milliseconds),
      clearInterval: (handle) => timers.clearInterval(handle),
    });
    engine.replaceProject(audioProject());
    const playback = engine.play(0);
    await Promise.resolve();
    assert.deepEqual(control(engine), expected, name);
    loading.resolve();
    assert.deepEqual(await playback, expected, name);
    assert.equal(timers.callbacks.size, 0, name);
    assert.equal(context.bufferSources.length, 0, name);
  }
});

test("a newer pending play supersedes the earlier play intent", async () => {
  const context = new FakeAudioContext();
  const timers = new FakeTimers();
  const loading = deferredBuffer();
  const engine = createAudioEngine({
    createContext: () => context.asAudioContext(),
    loadArrayBuffer: async () => loading.promise,
    setInterval: (callback, milliseconds) => timers.setInterval(callback, milliseconds),
    clearInterval: (handle) => timers.clearInterval(handle),
  });
  engine.replaceProject(audioProject());
  const earlier = engine.play(0);
  await Promise.resolve();
  const later = engine.play(16);
  loading.resolve();
  assert.deepEqual(await earlier, {
    ok: true,
    status: "stopped",
    positionStep: 0,
  });
  assert.deepEqual(await later, {
    ok: true,
    status: "playing",
    positionStep: 16,
  });
  assert.equal(context.bufferSources.length, 1);
  assert.deepEqual(timers.intervals, [25]);
});

test("play blocks if the context suspends during sample preparation", async () => {
  const context = new FakeAudioContext();
  const timers = new FakeTimers();
  const loading = deferredBuffer();
  const engine = createAudioEngine({
    createContext: () => context.asAudioContext(),
    loadArrayBuffer: async () => loading.promise,
    setInterval: (callback, milliseconds) => timers.setInterval(callback, milliseconds),
    clearInterval: (handle) => timers.clearInterval(handle),
  });
  engine.replaceProject(audioProject());
  const playback = engine.play(0);
  await Promise.resolve();
  context.state = "suspended";
  loading.resolve();
  assert.deepEqual(await playback, {
    ok: false,
    code: "blocked",
    message: "Audio context is suspended; retry from a user gesture",
  });
  assert.equal(timers.callbacks.size, 0);
  assert.equal(context.bufferSources.length, 0);
});

test("a scheduler tick blocks and cancels playback when the context suspends", async () => {
  const context = new FakeAudioContext();
  const timers = new FakeTimers();
  const engine = createAudioEngine({
    createContext: () => context.asAudioContext(),
    loadArrayBuffer: async () => new ArrayBuffer(8),
    setInterval: (callback, milliseconds) => timers.setInterval(callback, milliseconds),
    clearInterval: (handle) => timers.clearInterval(handle),
  });
  engine.replaceProject(audioProject());
  await engine.play(0);
  context.state = "suspended";
  timers.tick();
  assert.equal(engine.getSnapshot().status, "blocked");
  assert.equal(engine.getSnapshot().pendingSources, 0);
  assert.equal(timers.callbacks.size, 0);
  assert.deepEqual(context.bufferSources[0]?.stopTimes, [0]);
});

test("an externally closed context permanently closes the engine on a scheduler tick", async () => {
  const context = new FakeAudioContext();
  const closeError = new DOMException("context already closed", "InvalidStateError");
  let closeCalls = 0;
  context.close = async (): Promise<void> => {
    closeCalls += 1;
    throw closeError;
  };
  const timers = new FakeTimers();
  const engine = createAudioEngine({
    createContext: () => context.asAudioContext(),
    loadArrayBuffer: async () => new ArrayBuffer(8),
    setInterval: (callback, milliseconds) => timers.setInterval(callback, milliseconds),
    clearInterval: (handle) => timers.clearInterval(handle),
  });
  engine.replaceProject(audioProject());
  await engine.play(0);
  context.state = "closed";
  timers.tick();

  const closedFailure = {
    ok: false,
    code: "closed",
    message: "Audio engine is closed; create a new engine",
  } as const;
  assert.equal(engine.getSnapshot().status, "closed");
  assert.equal(engine.getSnapshot().pendingSources, 0);
  assert.equal(engine.getSnapshot().trackBusCount, 0);
  assert.equal(timers.callbacks.size, 0);
  assert.deepEqual(engine.stop(), closedFailure);
  assert.deepEqual(await engine.play(0), closedFailure);
  await engine.dispose();
  await engine.dispose();
  assert.equal(closeCalls, 0);
});

test("a periodic scheduling fault rolls back playback before rethrowing unchanged", async () => {
  const context = new FakeAudioContext();
  const createBufferSource = context.createBufferSource.bind(context);
  const sourceError = new TypeError("later buffer source failed");
  let sourceCreations = 0;
  context.createBufferSource = (): AudioBufferSourceNode => {
    sourceCreations += 1;
    if (sourceCreations === 2) {
      throw sourceError;
    }
    return createBufferSource();
  };
  const timers = new FakeTimers();
  const engine = createAudioEngine({
    createContext: () => context.asAudioContext(),
    loadArrayBuffer: async () => new ArrayBuffer(8),
    setInterval: (callback, milliseconds) => timers.setInterval(callback, milliseconds),
    clearInterval: (handle) => timers.clearInterval(handle),
  });
  const project = audioProject();
  engine.replaceProject({
    ...project,
    patterns: project.patterns.map((pattern) => pattern.kind === "drum"
      ? {
        ...pattern,
        events: pattern.events.map((event, index) => ({
          ...event,
          startStep: index,
        })),
      }
      : pattern),
  });
  await engine.play(0);
  context.currentTime = 0.1;
  let thrown: unknown;
  try {
    timers.tick();
  } catch (error) {
    thrown = error;
  }
  assert.equal(thrown, sourceError);
  assert.equal(engine.getSnapshot().status, "stopped");
  assert.equal(engine.getSnapshot().positionStep, 0.4);
  assert.equal(engine.getSnapshot().pendingSources, 0);
  assert.equal(timers.callbacks.size, 0);
  assert.deepEqual(context.bufferSources[0]?.stopTimes, [0.1]);
});

test("an evicted sustained voice stays suppressed until its musical end", async () => {
  const context = new FakeAudioContext();
  const timers = new FakeTimers();
  const engine = createAudioEngine({
    createContext: () => context.asAudioContext(),
    loadArrayBuffer: async () => new ArrayBuffer(8),
    setInterval: (callback, milliseconds) => timers.setInterval(callback, milliseconds),
    clearInterval: (handle) => timers.clearInterval(handle),
  });
  const project = audioProject();
  const synthTrack = project.tracks[1];
  const synthPattern = project.patterns[1];
  const synthClip = project.arrangement[1];
  assert.ok(synthTrack);
  assert.ok(synthPattern?.kind === "synth");
  assert.ok(synthClip);
  engine.replaceProject({
    ...project,
    tracks: [synthTrack],
    patterns: [{
      ...synthPattern,
      events: Array.from({ length: 65 }, (_, index) => ({
        id: `note-${index}`,
        midiNote: 48,
        startStep: 0,
        lengthSteps: 16,
      })),
    }],
    arrangement: [{ ...synthClip, startBar: 0 }],
  });
  await engine.play(0);
  assert.equal(context.oscillators.length, 65);
  context.oscillators[0]?.finish();
  await Promise.resolve();
  assert.equal(engine.getSnapshot().pendingSources, 64);
  timers.tick();
  assert.equal(context.oscillators.length, 65);
  assert.equal(engine.getSnapshot().pendingSources, 64);
});

test("play rolls back partial scheduling before propagating programmer errors", async () => {
  const context = new FakeAudioContext();
  const createBufferSource = context.createBufferSource.bind(context);
  const sourceError = new TypeError("invalid buffer source factory");
  let sourceCreations = 0;
  context.createBufferSource = (): AudioBufferSourceNode => {
    sourceCreations += 1;
    if (sourceCreations === 2) {
      throw sourceError;
    }
    return createBufferSource();
  };
  const timers = new FakeTimers();
  const engine = createAudioEngine({
    createContext: () => context.asAudioContext(),
    loadArrayBuffer: async () => new ArrayBuffer(8),
    setInterval: (callback, milliseconds) => timers.setInterval(callback, milliseconds),
    clearInterval: (handle) => timers.clearInterval(handle),
  });
  const project = audioProject();
  engine.replaceProject({
    ...project,
    patterns: project.patterns.map((pattern) => pattern.kind === "drum"
      ? {
        ...pattern,
        events: pattern.events.map((event) => ({ ...event, startStep: 0 })),
      }
      : pattern),
  });
  await assert.rejects(engine.play(0), sourceError);
  assert.equal(engine.getSnapshot().status, "stopped");
  assert.equal(engine.getSnapshot().positionStep, 0);
  assert.equal(engine.getSnapshot().pendingSources, 0);
  assert.equal(timers.callbacks.size, 0);
  assert.equal(context.bufferSources.length, 1);
  assert.deepEqual(context.bufferSources[0]?.stopTimes, [0]);
});

test("Web Audio source errors are diagnosed while sibling events continue", async () => {
  const context = new FakeAudioContext();
  const createBufferSource = context.createBufferSource.bind(context);
  let sourceFailures = 1;
  context.createBufferSource = (): AudioBufferSourceNode => {
    if (sourceFailures > 0) {
      sourceFailures -= 1;
      throw new DOMException("source unavailable", "InvalidStateError");
    }
    return createBufferSource();
  };
  const timers = new FakeTimers();
  const engine = createAudioEngine({
    createContext: () => context.asAudioContext(),
    loadArrayBuffer: async () => new ArrayBuffer(8),
    setInterval: (callback, milliseconds) => timers.setInterval(callback, milliseconds),
    clearInterval: (handle) => timers.clearInterval(handle),
  });
  const project = audioProject();
  engine.replaceProject({
    ...project,
    patterns: project.patterns.map((pattern) => pattern.kind === "drum"
      ? {
        ...pattern,
        events: pattern.events.map((event) => ({ ...event, startStep: 0 })),
      }
      : pattern),
  });
  assert.deepEqual(await engine.play(0), {
    ok: true,
    status: "playing",
    positionStep: 0,
  });
  assert.equal(context.bufferSources.length, 1);
  assert.equal(timers.callbacks.size, 1);
  assert.equal(engine.getSnapshot().lastIssue?.code, "source_failed");
});
