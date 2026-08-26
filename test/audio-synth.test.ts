import assert from "node:assert/strict";
import test from "node:test";

import { SYNTH_PRESETS, createSynth, midiNoteToFrequency } from "../src/audio/index.ts";
import { FakeAudioContext, FakeAudioNode } from "./audio-fakes.ts";

const event = (key: string, trackId: string, instrumentId: string) => ({
  key,
  kind: "synth" as const,
  trackId,
  instrumentId,
  startStep: 0,
  durationSteps: 4,
  midiNote: 69,
});

test("MIDI note conversion uses A4 as 440 Hz", () => {
  assert.equal(midiNoteToFrequency(69), 440);
  assert.equal(midiNoteToFrequency(81), 880);
});

test("synth schedules the approved oscillator, filter, and envelope", () => {
  const context = new FakeAudioContext();
  const synth = createSynth({
    context: context.asAudioContext(),
    presets: SYNTH_PRESETS,
    voiceCap: 64,
    stopRampSeconds: 0.005,
  });
  const voice = synth.schedule(
    event("note-1", "bass", "synth.bass"),
    2,
    0.5,
    new FakeAudioNode() as unknown as AudioNode,
  );
  assert.ok(voice);
  assert.equal(context.oscillators[0]?.type, "sawtooth");
  assert.equal(context.oscillators[0]?.frequency.value, 440);
  assert.equal(context.filters[0]?.frequency.value, 600);
  assert.deepEqual(context.oscillators[0]?.startTimes, [2]);
  assert.deepEqual(context.oscillators[0]?.stopTimes, [2.62]);
  assert.equal(synth.activeVoiceCount(), 1);
});

test("voice cap evicts the oldest voice on the requesting track first", () => {
  const context = new FakeAudioContext();
  const synth = createSynth({
    context: context.asAudioContext(),
    presets: SYNTH_PRESETS,
    voiceCap: 2,
    stopRampSeconds: 0.005,
  });
  const destination = new FakeAudioNode() as unknown as AudioNode;
  synth.schedule(event("a", "bass", "synth.bass"), 1, 2, destination);
  synth.schedule(event("b", "lead", "synth.lead"), 1.1, 2, destination);
  synth.schedule(event("c", "bass", "synth.bass"), 1.2, 2, destination);
  assert.deepEqual(context.oscillators[0]?.stopTimes, [1.205]);
  assert.deepEqual(context.oscillators[1]?.stopTimes, [3.28]);
  assert.equal(synth.activeVoiceCount(), 2);
});

test("unknown preset is skipped and stopAll is idempotent", async () => {
  const context = new FakeAudioContext();
  const synth = createSynth({
    context: context.asAudioContext(),
    presets: SYNTH_PRESETS,
    voiceCap: 64,
    stopRampSeconds: 0.005,
  });
  const destination = new FakeAudioNode() as unknown as AudioNode;
  assert.equal(synth.schedule(event("bad", "x", "unknown"), 0, 1, destination), undefined);
  const voice = synth.schedule(event("ok", "x", "synth.bass"), 0, 1, destination);
  assert.ok(voice);
  synth.stopAll(0.5);
  synth.stopAll(0.6);
  assert.deepEqual(context.oscillators[0]?.stopTimes, [0.505]);
  context.oscillators[0]?.finish();
  await voice.ended;
  assert.equal(synth.activeVoiceCount(), 0);
});

test("forced stop holds the envelope before its five millisecond fade", () => {
  const context = new FakeAudioContext();
  const synth = createSynth({
    context: context.asAudioContext(),
    presets: SYNTH_PRESETS,
    voiceCap: 64,
    stopRampSeconds: 0.005,
  });
  const voice = synth.schedule(
    event("note-1", "bass", "synth.bass"),
    0,
    1,
    new FakeAudioNode() as unknown as AudioNode,
  );
  assert.ok(voice);
  voice.stop(0.5);
  assert.deepEqual(context.gains[0]?.gain.events.slice(-2), [
    { method: "hold", time: 0.5 },
    { method: "linear", value: 0, time: 0.505 },
  ]);
});

test("short pad note holds its envelope at note end before release", () => {
  const context = new FakeAudioContext();
  const synth = createSynth({
    context: context.asAudioContext(),
    presets: SYNTH_PRESETS,
    voiceCap: 64,
    stopRampSeconds: 0.005,
  });
  synth.schedule(
    event("note-1", "pad", "synth.pad"),
    2,
    0.1,
    new FakeAudioNode() as unknown as AudioNode,
  );
  assert.deepEqual(context.gains[0]?.gain.events.slice(-2), [
    { method: "hold", time: 2.1 },
    { method: "linear", value: 0, time: 2.9 },
  ]);
});

test("voice cap evicts the earliest requesting-track voice when scheduled out of order", () => {
  const context = new FakeAudioContext();
  const synth = createSynth({
    context: context.asAudioContext(),
    presets: SYNTH_PRESETS,
    voiceCap: 2,
    stopRampSeconds: 0.005,
  });
  const destination = new FakeAudioNode() as unknown as AudioNode;
  synth.schedule(event("newer", "bass", "synth.bass"), 2, 2, destination);
  synth.schedule(event("older", "bass", "synth.bass"), 1, 2, destination);
  synth.schedule(event("incoming", "bass", "synth.bass"), 3, 2, destination);
  assert.deepEqual(context.oscillators[0]?.stopTimes, [4.12]);
  assert.deepEqual(context.oscillators[1]?.stopTimes, [3.005]);
});

test("synth rejects non-finite and fractional caps and non-finite ramps", () => {
  const context = new FakeAudioContext();
  for (const voiceCap of [Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
    assert.throws(
      () => createSynth({
        context: context.asAudioContext(),
        presets: SYNTH_PRESETS,
        voiceCap,
        stopRampSeconds: 0.005,
      }),
      RangeError,
    );
  }
  for (const stopRampSeconds of [Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => createSynth({
        context: context.asAudioContext(),
        presets: SYNTH_PRESETS,
        voiceCap: 64,
        stopRampSeconds,
      }),
      RangeError,
    );
  }
});
