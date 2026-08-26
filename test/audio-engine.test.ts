import assert from "node:assert/strict";
import test from "node:test";

import { createAudioEngine } from "../src/audio/index.ts";
import { audioProject } from "./audio-fixtures.ts";
import { FakeAudioContext, FakeTimers } from "./audio-fakes.ts";

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
