import assert from "node:assert/strict";
import test from "node:test";

import { BASIC_DRUM_KIT, createSampler } from "../src/audio/index.ts";
import { FakeAudioContext, FakeAudioNode } from "./audio-fakes.ts";

test("sampler loads each sound once and reuses decoded buffers", async () => {
  const context = new FakeAudioContext();
  const loaded: string[] = [];
  const sampler = createSampler({
    context: context.asAudioContext(),
    kit: BASIC_DRUM_KIT,
    loadArrayBuffer: async (url) => {
      loaded.push(url);
      return new ArrayBuffer(8);
    },
  });
  assert.deepEqual(await sampler.prepare(), {
    readySoundIds: ["kick", "snare", "hat"],
    unavailableSoundIds: [],
  });
  await sampler.prepare();
  assert.deepEqual(loaded, [
    "/demo/drums/kick.wav",
    "/demo/drums/snare.wav",
    "/demo/drums/hat.wav",
  ]);
});

test("sampler degrades one failed sample without blocking siblings", async () => {
  const context = new FakeAudioContext();
  let failSnare = true;
  const sampler = createSampler({
    context: context.asAudioContext(),
    kit: BASIC_DRUM_KIT,
    loadArrayBuffer: async (url) => {
      if (url.endsWith("snare.wav") && failSnare) {
        failSnare = false;
        throw new Error("asset missing");
      }
      return new ArrayBuffer(8);
    },
  });
  assert.deepEqual(await sampler.prepare(), {
    readySoundIds: ["kick", "hat"],
    unavailableSoundIds: ["snare"],
  });
  assert.equal(
    sampler.schedule(
      {
        key: "clip:0:snare",
        kind: "drum",
        trackId: "track",
        instrumentId: "kit.basic",
        startStep: 4,
        soundId: "snare",
      },
      2,
      new FakeAudioNode() as unknown as AudioNode,
    ),
    undefined,
  );
  assert.deepEqual(await sampler.prepare(), {
    readySoundIds: ["kick", "snare", "hat"],
    unavailableSoundIds: [],
  });
});

test("sampler reports decode failure without dropping decoded siblings", async () => {
  const context = new FakeAudioContext();
  context.decodeFailures = 1;
  const sampler = createSampler({
    context: context.asAudioContext(),
    kit: BASIC_DRUM_KIT,
    loadArrayBuffer: async () => new ArrayBuffer(8),
  });
  const result = await sampler.prepare();
  assert.equal(result.readySoundIds.length, 2);
  assert.equal(result.unavailableSoundIds.length, 1);
});

test("scheduled drum source starts, stops once, and resolves cleanup", async () => {
  const context = new FakeAudioContext();
  const destination = new FakeAudioNode();
  const sampler = createSampler({
    context: context.asAudioContext(),
    kit: BASIC_DRUM_KIT,
    loadArrayBuffer: async () => new ArrayBuffer(8),
  });
  await sampler.prepare();
  const source = sampler.schedule(
    {
      key: "clip:0:kick",
      kind: "drum",
      trackId: "track",
      instrumentId: "kit.basic",
      startStep: 0,
      soundId: "kick",
    },
    1.5,
    destination as unknown as AudioNode,
  );
  assert.ok(source);
  assert.deepEqual(context.bufferSources[0]?.startTimes, [1.5]);
  source.stop(2);
  source.stop(3);
  assert.deepEqual(context.bufferSources[0]?.stopTimes, [2]);
  context.bufferSources[0]?.finish();
  await source.ended;
  assert.equal(context.bufferSources[0]?.disconnected, true);
});
