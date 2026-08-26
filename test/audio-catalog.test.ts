import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  BASIC_DRUM_KIT,
  SOUND_CATALOG,
  SYNTH_PRESETS,
  findDrumSound,
  findSynthPreset,
} from "../src/audio/index.ts";

test("sound catalog exposes the stable MVP identifiers", () => {
  assert.equal(BASIC_DRUM_KIT.id, "kit.basic");
  assert.deepEqual(BASIC_DRUM_KIT.sounds.map((sound) => sound.id), ["kick", "snare", "hat"]);
  assert.deepEqual(Object.keys(SYNTH_PRESETS), [
    "synth.bass",
    "synth.chord",
    "synth.lead",
    "synth.pad",
  ]);
  assert.deepEqual(SOUND_CATALOG, {
    drumKits: [{ id: "kit.basic", soundIds: ["kick", "snare", "hat"] }],
    synthPresets: [
      { id: "synth.bass" },
      { id: "synth.chord" },
      { id: "synth.lead" },
      { id: "synth.pad" },
    ],
  });
  assert.equal(findDrumSound("snare")?.url, "/demo/drums/snare.wav");
  assert.equal(findDrumSound("missing"), undefined);
  assert.equal(findSynthPreset("synth.pad")?.oscillator, "sine");
  assert.equal(findSynthPreset("missing"), undefined);
});

for (const soundId of ["kick", "snare", "hat"] as const) {
  test(`${soundId} is a non-empty PCM WAV asset`, async () => {
    const bytes = await readFile(
      new URL(`../public/demo/drums/${soundId}.wav`, import.meta.url),
    );
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF");
    assert.equal(bytes.subarray(8, 12).toString("ascii"), "WAVE");
    assert.equal(bytes.readUInt16LE(20), 1);
    assert.equal(bytes.readUInt16LE(22), 1);
    assert.equal(bytes.readUInt32LE(24), 44_100);
    assert.ok(bytes.length > 44);
  });
}
