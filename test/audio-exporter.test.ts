import assert from "node:assert/strict";
import test from "node:test";

import type { Project } from "../src/project/index.ts";
import {
  WavExportError,
  type WavExportErrorCode,
  encodeWav,
  renderProjectToWav,
  wavFileName,
} from "../src/audio/index.ts";
import { audioProject } from "./audio-fixtures.ts";
import { FakeOfflineAudioContext } from "./audio-fakes.ts";

const audioBuffer = (
  left: readonly number[],
  right: readonly number[],
): AudioBuffer => ({
  duration: left.length / 44_100,
  length: left.length,
  numberOfChannels: 2,
  sampleRate: 44_100,
  getChannelData: (channel: number): Float32Array =>
    Float32Array.from(channel === 0 ? left : right),
} as AudioBuffer);

test("encodeWav writes a stereo 16-bit RIFF file with clamped samples", async () => {
  const bytes = new DataView(await encodeWav(
    audioBuffer([-2, -0.5, 0], [2, 0.5, 0]),
  ).arrayBuffer());

  assert.equal(String.fromCharCode(...new Uint8Array(bytes.buffer, 0, 4)), "RIFF");
  assert.equal(bytes.getUint32(4, true), 48);
  assert.equal(String.fromCharCode(...new Uint8Array(bytes.buffer, 8, 4)), "WAVE");
  assert.equal(bytes.getUint16(20, true), 1);
  assert.equal(bytes.getUint16(22, true), 2);
  assert.equal(bytes.getUint32(24, true), 44_100);
  assert.equal(bytes.getUint32(28, true), 176_400);
  assert.equal(bytes.getUint16(32, true), 4);
  assert.equal(bytes.getUint16(34, true), 16);
  assert.equal(bytes.getUint32(40, true), 12);
  assert.deepEqual(
    [44, 46, 48, 50, 52, 54].map((offset) => bytes.getInt16(offset, true)),
    [-32_768, 32_767, -16_384, 16_384, 0, 0],
  );
});

test("encodeWav rejects buffers outside the fixed stereo 44.1 kHz format", () => {
  assert.throws(
    () => encodeWav({ ...audioBuffer([0], [0]), numberOfChannels: 1 } as AudioBuffer),
    RangeError,
  );
  assert.throws(
    () => encodeWav({ ...audioBuffer([0], [0]), sampleRate: 48_000 } as AudioBuffer),
    RangeError,
  );
});

test("wavFileName keeps a readable safe name and has a fallback", () => {
  assert.equal(wavFileName("  Demo: Beat/One.  "), "Demo- Beat-One.wav");
  assert.equal(wavFileName("  Demo Mix.WAV  "), "Demo Mix.wav");
  assert.equal(wavFileName("Demo.wav.wav"), "Demo.wav");
  assert.equal(wavFileName(' \\ / : * ? " < > | . '), "agentdaw.wav");
});

test("renderProjectToWav schedules the full shared mixer graph with a release tail", async () => {
  const project = audioProject();
  let context: FakeOfflineAudioContext | undefined;
  const blob = await renderProjectToWav({
    ...project,
    masterVolumeDb: -3,
    tracks: [
      { ...project.tracks[0]!, pan: -0.5 },
      { ...project.tracks[1]!, pan: 0.5, soloed: true },
      {
        ...project.tracks[1]!,
        id: "00000000-0000-4000-8000-000000000011",
        name: "Muted solo",
        pan: 0.25,
        muted: true,
        soloed: true,
      },
    ],
  }, {
    createContext: (channels, length, sampleRate) => {
      context = new FakeOfflineAudioContext(channels, length, sampleRate);
      return context.asOfflineAudioContext();
    },
    loadArrayBuffer: async () => new ArrayBuffer(8),
  });

  assert.equal(blob.type, "audio/wav");
  assert.equal(context?.length, 269_892);
  assert.deepEqual(context?.bufferSources.map(({ startTimes }) => startTimes), [
    [0], [0.5], [2], [2.5],
  ]);
  assert.deepEqual(context?.oscillators.map(({ startTimes }) => startTimes), [[4.5]]);
  assert.deepEqual(
    context?.gains.slice(0, 4).map(({ gain }) => gain.events[0]),
    [
      { method: "set", value: 0.7079457843841379, time: 0 },
      { method: "set", value: 0, time: 0 },
      { method: "set", value: 0.5011872336272722, time: 0 },
      { method: "set", value: 0, time: 0 },
    ],
  );
  assert.deepEqual(
    context?.panners.map(({ pan }) => pan.events[0]),
    [
      { method: "set", value: -0.5, time: 0 },
      { method: "set", value: 0.5, time: 0 },
      { method: "set", value: 0.25, time: 0 },
    ],
  );
});

test("renderProjectToWav names a missing pattern when no arrangement steps can expand", async () => {
  const project = audioProject();
  const missingPatternId = "missing-pattern";

  await assert.rejects(
    renderProjectToWav(
      { ...project, arrangement: [{ ...project.arrangement[0]!, patternId: missingPatternId }] },
      {
        createContext: () => new FakeOfflineAudioContext(2, 1, 44_100).asOfflineAudioContext(),
        loadArrayBuffer: async () => new ArrayBuffer(8),
      },
    ),
    (error: unknown) =>
      error instanceof WavExportError &&
      error.code === "invalid_project_reference" &&
      error.message.includes(missingPatternId),
  );
});

test("renderProjectToWav permits ten minutes but rejects longer projects before allocation", async () => {
  const project = audioProject();
  const tenMinutes = {
    ...project,
    bpm: 40,
    arrangement: [{ ...project.arrangement[0]!, repeatCount: 100 }],
  };
  let requestedContext: readonly number[] | undefined;

  await assert.rejects(
    renderProjectToWav(tenMinutes, {
      createContext: (channels, length, sampleRate) => {
        requestedContext = [channels, length, sampleRate];
        throw new Error("context created");
      },
      loadArrayBuffer: async () => new ArrayBuffer(8),
    }),
    /context created/,
  );
  assert.deepEqual(requestedContext, [2, 26_460_000, 44_100]);

  let allocations = 0;
  await assert.rejects(
    renderProjectToWav(
      { ...tenMinutes, arrangement: [{ ...tenMinutes.arrangement[0]!, repeatCount: 101 }] },
      {
        createContext: () => {
          allocations += 1;
          return new FakeOfflineAudioContext(2, 1, 44_100).asOfflineAudioContext();
        },
        loadArrayBuffer: async () => new ArrayBuffer(8),
      },
    ),
    (error: unknown) => error instanceof WavExportError && error.code === "duration_exceeded",
  );
  assert.equal(allocations, 0);
});

test("renderProjectToWav rejects invalid projects before downloading partial audio", async (t) => {
  const base = audioProject();
  const cases: readonly {
    readonly name: string;
    readonly project: Project;
    readonly code: WavExportErrorCode;
  }[] = [
    {
      name: "empty arrangement",
      project: { ...base, arrangement: [] },
      code: "empty_arrangement",
    },
    {
      name: "duration above ten minutes",
      project: {
        ...base,
        bpm: 40,
        arrangement: [{ ...base.arrangement[0]!, startBar: 200, repeatCount: 64 }],
      },
      code: "duration_exceeded",
    },
    {
      name: "missing pattern",
      project: { ...base, arrangement: [{ ...base.arrangement[0]!, patternId: "missing" }] },
      code: "invalid_project_reference",
    },
    {
      name: "unknown preset",
      project: {
        ...base,
        tracks: base.tracks.map((track) => track.kind === "synth"
          ? { ...track, instrumentId: "synth.missing" }
          : track),
      },
      code: "unknown_preset",
    },
    {
      name: "unknown drum sound",
      project: {
        ...base,
        patterns: base.patterns.map((pattern) => pattern.kind === "drum"
          ? { ...pattern, events: [{ ...pattern.events[0]!, soundId: "missing" }] }
          : pattern),
      },
      code: "missing_sample",
    },
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      let allocations = 0;
      await assert.rejects(
        renderProjectToWav(item.project, {
          createContext: () => {
            allocations += 1;
            return new FakeOfflineAudioContext(2, 1, 44_100).asOfflineAudioContext();
          },
          loadArrayBuffer: async () => new ArrayBuffer(8),
        }),
        (error: unknown) => error instanceof WavExportError && error.code === item.code,
      );
      if (item.code === "empty_arrangement" || item.code === "duration_exceeded" || item.code === "invalid_project_reference" || item.code === "unknown_preset") {
        assert.equal(allocations, 0);
      }
    });
  }
});

test("renderProjectToWav distinguishes sample loading and rendering failures", async () => {
  await assert.rejects(
    renderProjectToWav(audioProject(), {
      createContext: (channels, length, rate) =>
        new FakeOfflineAudioContext(channels, length, rate).asOfflineAudioContext(),
      loadArrayBuffer: async () => { throw new Error("network down"); },
    }),
    (error: unknown) => error instanceof WavExportError && error.code === "sample_load_failed",
  );

  await assert.rejects(
    renderProjectToWav(audioProject(), {
      createContext: (channels, length, rate) => {
        const context = new FakeOfflineAudioContext(channels, length, rate);
        context.renderFailure = new Error("render stopped");
        return context.asOfflineAudioContext();
      },
      loadArrayBuffer: async () => new ArrayBuffer(8),
    }),
    (error: unknown) => error instanceof WavExportError && error.code === "render_failed",
  );
});

test("renderProjectToWav reports a decoded sample that is unavailable", async () => {
  await assert.rejects(
    renderProjectToWav(audioProject(), {
      createContext: (channels, length, rate) => {
        const context = new FakeOfflineAudioContext(channels, length, rate);
        context.decodeFailures = 1;
        return context.asOfflineAudioContext();
      },
      loadArrayBuffer: async () => new ArrayBuffer(8),
    }),
    (error: unknown) => error instanceof WavExportError && error.code === "missing_sample",
  );
});
