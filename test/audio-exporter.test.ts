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
  assert.equal(bytes.getUint16(22, true), 2);
  assert.equal(bytes.getUint32(24, true), 44_100);
  assert.equal(bytes.getUint16(34, true), 16);
  assert.equal(bytes.getUint32(40, true), 12);
  assert.deepEqual(
    [44, 46, 48, 50, 52, 54].map((offset) => bytes.getInt16(offset, true)),
    [-32_768, 32_767, -16_384, 16_384, 0, 0],
  );
});

test("wavFileName keeps a readable safe name and has a fallback", () => {
  assert.equal(wavFileName("  Demo: Beat/One.  "), "Demo- Beat-One.wav");
  assert.equal(wavFileName(' \\ / : * ? " < > | . '), "agentdaw.wav");
});

test("renderProjectToWav schedules the full shared mixer graph with a release tail", async () => {
  let context: FakeOfflineAudioContext | undefined;
  const blob = await renderProjectToWav(audioProject(), {
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
    context?.gains.slice(0, 3).map(({ gain }) => gain.events[0]),
    [
      { method: "set", value: 1, time: 0 },
      { method: "set", value: 1, time: 0 },
      { method: "set", value: 10 ** (-6 / 20), time: 0 },
    ],
  );
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
