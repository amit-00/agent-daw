import assert from "node:assert/strict";
import test from "node:test";

import { encodeWav, renderProjectToWav, wavFileName } from "../src/audio/index.ts";
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
