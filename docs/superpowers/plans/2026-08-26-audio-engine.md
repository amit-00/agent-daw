# Audio Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build dependency-free drum sampling, fixed polyphonic synth presets, mixing, and arrangement playback for validated AgentDAW projects.

**Architecture:** A pure timeline module expands bounded project windows into deterministic drum and synth events. A sampler and synth render those events into per-track Web Audio buses owned by one audio engine, whose main-thread look-ahead scheduler uses `AudioContext.currentTime` as the authority.

**Tech Stack:** Strict TypeScript, ECMAScript modules, native Web Audio, native `fetch`, Node.js 23.6+ built-in test runner; existing `typescript` and `@types/node` development dependencies only.

**Spec:** `docs/superpowers/specs/2026-08-25-audio-engine-design.md`

## Global Constraints

- Import `Project`, `Track`, and `SoundCatalog` from `src/project/index.ts`; never duplicate project-domain types or validation.
- Add no runtime or development dependencies.
- Use one kit ID, `kit.basic`, with exactly `kick`, `snare`, and `hat`.
- Use exactly `synth.bass`, `synth.chord`, `synth.lead`, and `synth.pad` with the approved fixed parameters.
- Use native browser Web Audio on the main thread; no Tone.js, AudioWorklet, worker, plugin interface, or audio framework.
- Use a 25 ms scheduler tick, 100 ms look-ahead, 50 ms start lead, 5 ms mixer/stop ramp, and 64-voice global cap.
- Keep audio runtime state ephemeral and out of project snapshots, history, and persistence.
- Sample URLs are fixed same-origin paths; only original generated assets or CC0 assets with recorded provenance may ship.
- Expected runtime failures return specific status or diagnostic information; unexpected programmer errors propagate.
- No UI, looping, effects, recording, offline WAV export, or persistence is added in this milestone.

---

## Execution prerequisite

The project-domain work is complete and verified at `codex/project-domain` commit `1a69ac2`. Integrate that exact reviewed baseline before Task 1:

```bash
git merge --no-ff 1a69ac2 -m "merge: integrate project domain"
npm install
npm test
npm run typecheck
```

Expected: the merge succeeds, 101 project tests pass, strict typechecking passes, and `git status --short` is empty. If `codex/project-domain` advances, do not substitute a newer commit without first reviewing its diff from `1a69ac2`.

The independent browser smoke gate requires the future application shell to call this package from a user gesture. This branch must complete all Node tests and typechecking, then hand the exact browser smoke checklist from Task 6 to the UI integration task rather than claiming an unavailable browser test passed.

## File map

| File | Responsibility |
|---|---|
| `src/audio/catalog.ts` | Static kit, sample paths, synth presets, and domain `SoundCatalog` projection. |
| `src/audio/timeline.ts` | Pure timing conversion, arrangement end, playback fingerprint, and window expansion. |
| `src/audio/sampler.ts` | Concurrent sample preparation, decoded-buffer cache, and drum-source lifetime. |
| `src/audio/synth.ts` | MIDI pitch, fixed preset voices, envelopes, cap eviction, and voice cleanup. |
| `src/audio/engine.ts` | Context lifecycle, mixer buses, transport, scheduling, live project replacement, and diagnostics. |
| `src/audio/index.ts` | Public audio exports only. |
| `test/audio-fixtures.ts` | One complete validated project fixture shared by timeline and engine tests. |
| `test/audio-fakes.ts` | Small deterministic Web Audio and timer fakes shared by boundary tests. |
| `test/audio-catalog.test.ts` | Catalog contract and generated WAV artifact checks. |
| `test/audio-timeline.test.ts` | Pure musical timing, repeat, boundary, seek, and stale-reference tests. |
| `test/audio-sampler.test.ts` | Sample load, cache, degradation, trigger, stop, and cleanup tests. |
| `test/audio-synth.test.ts` | Preset voice, pitch, envelope, eviction, stop, and cleanup tests. |
| `test/audio-engine.test.ts` | Context, mixer, transport, scheduler, project replacement, and diagnostics tests. |
| `public/demo/drums/*.wav` | Deterministic bundled kick, snare, and hi-hat one-shots. |
| `public/demo/drums/LICENSE.md` | Generated-asset provenance and repository license statement. |

---

### Task 1: Runtime sound catalog and bundled drum assets

**Files:**
- Create: `src/audio/catalog.ts`
- Create: `src/audio/index.ts`
- Create temporarily, then delete: `scripts/generate-drum-samples.mjs`
- Create: `public/demo/drums/kick.wav`
- Create: `public/demo/drums/snare.wav`
- Create: `public/demo/drums/hat.wav`
- Create: `public/demo/drums/LICENSE.md`
- Create: `test/audio-catalog.test.ts`

**Interfaces:**
- Consumes: `SoundCatalog` from `src/project/index.ts`.
- Produces: `DrumSoundId`, `SynthPresetId`, `DrumSoundDefinition`, `DrumKitDefinition`, `SynthPreset`, `BASIC_DRUM_KIT`, `SYNTH_PRESETS`, `SOUND_CATALOG`, `findDrumSound(id)`, and `findSynthPreset(id)`.
- Consumed by: sampler, synth, engine, project factories, and future WebMCP sound inspection.

- [ ] **Step 1: Write the failing catalog and asset tests**

Create `test/audio-catalog.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `node --disable-warning=ExperimentalWarning --test test/audio-catalog.test.ts`

Expected: FAIL because `src/audio/index.ts` does not exist.

- [ ] **Step 3: Implement the static catalog**

Create `src/audio/catalog.ts`:

```ts
import type { SoundCatalog } from "../project/index.ts";

export type DrumSoundId = "kick" | "snare" | "hat";
export type SynthPresetId =
  | "synth.bass"
  | "synth.chord"
  | "synth.lead"
  | "synth.pad";

export interface DrumSoundDefinition {
  readonly id: DrumSoundId;
  readonly url: string;
}

export interface DrumKitDefinition {
  readonly id: "kit.basic";
  readonly sounds: readonly DrumSoundDefinition[];
}

export interface SynthPreset {
  readonly id: SynthPresetId;
  readonly oscillator: OscillatorType;
  readonly filterCutoffHz: number;
  readonly filterQ: number;
  readonly attackSeconds: number;
  readonly decaySeconds: number;
  readonly sustainGain: number;
  readonly releaseSeconds: number;
  readonly peakGain: number;
}

export const BASIC_DRUM_KIT: DrumKitDefinition = {
  id: "kit.basic",
  sounds: [
    { id: "kick", url: "/demo/drums/kick.wav" },
    { id: "snare", url: "/demo/drums/snare.wav" },
    { id: "hat", url: "/demo/drums/hat.wav" },
  ],
};

export const SYNTH_PRESETS: Readonly<Record<SynthPresetId, SynthPreset>> = {
  "synth.bass": {
    id: "synth.bass",
    oscillator: "sawtooth",
    filterCutoffHz: 600,
    filterQ: 1,
    attackSeconds: 0.005,
    decaySeconds: 0.12,
    sustainGain: 0.55,
    releaseSeconds: 0.12,
    peakGain: 0.14,
  },
  "synth.chord": {
    id: "synth.chord",
    oscillator: "triangle",
    filterCutoffHz: 1_800,
    filterQ: 1,
    attackSeconds: 0.02,
    decaySeconds: 0.2,
    sustainGain: 0.65,
    releaseSeconds: 0.35,
    peakGain: 0.11,
  },
  "synth.lead": {
    id: "synth.lead",
    oscillator: "square",
    filterCutoffHz: 2_800,
    filterQ: 1,
    attackSeconds: 0.005,
    decaySeconds: 0.1,
    sustainGain: 0.7,
    releaseSeconds: 0.18,
    peakGain: 0.1,
  },
  "synth.pad": {
    id: "synth.pad",
    oscillator: "sine",
    filterCutoffHz: 1_400,
    filterQ: 1,
    attackSeconds: 0.35,
    decaySeconds: 0.4,
    sustainGain: 0.75,
    releaseSeconds: 0.8,
    peakGain: 0.1,
  },
};

export const SOUND_CATALOG: SoundCatalog = {
  drumKits: [{ id: BASIC_DRUM_KIT.id, soundIds: BASIC_DRUM_KIT.sounds.map(({ id }) => id) }],
  synthPresets: Object.values(SYNTH_PRESETS).map(({ id }) => ({ id })),
};

export const findDrumSound = (id: string): DrumSoundDefinition | undefined =>
  BASIC_DRUM_KIT.sounds.find((sound) => sound.id === id);

export const findSynthPreset = (id: string): SynthPreset | undefined =>
  Object.values(SYNTH_PRESETS).find((preset) => preset.id === id);
```

Create `src/audio/index.ts`:

```ts
export * from "./catalog.ts";
```

- [ ] **Step 4: Generate deterministic original WAV assets**

Create `scripts/generate-drum-samples.mjs` with this one-time generator:

```js
import { mkdir, writeFile } from "node:fs/promises";

const sampleRate = 44_100;
const outputDirectory = new URL("../public/demo/drums/", import.meta.url);

const wav = (samples) => {
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(36 + samples.length * 2, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(samples.length * 2, 40);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    bytes.writeInt16LE(Math.round(sample * 32_767), 44 + index * 2);
  }
  return bytes;
};

let noiseState = 0x1a2b3c4d;
const noise = () => {
  noiseState ^= noiseState << 13;
  noiseState ^= noiseState >>> 17;
  noiseState ^= noiseState << 5;
  return ((noiseState >>> 0) / 0xffff_ffff) * 2 - 1;
};

const render = (seconds, sampleAt) =>
  Float32Array.from(
    { length: Math.round(seconds * sampleRate) },
    (_, index) => sampleAt(index / sampleRate),
  );

let kickPhase = 0;
const kick = render(0.45, (time) => {
  const frequency = 45 + 110 * Math.exp(-time * 28);
  kickPhase += (Math.PI * 2 * frequency) / sampleRate;
  return Math.sin(kickPhase) * Math.exp(-time * 11) * 0.9;
});

let snarePhase = 0;
const snare = render(0.3, (time) => {
  snarePhase += (Math.PI * 2 * 190) / sampleRate;
  const body = Math.sin(snarePhase) * Math.exp(-time * 18) * 0.25;
  return body + noise() * Math.exp(-time * 16) * 0.65;
});

let previousNoise = 0;
const hat = render(0.14, (time) => {
  const currentNoise = noise();
  const highPassed = currentNoise - previousNoise * 0.92;
  previousNoise = currentNoise;
  return highPassed * Math.exp(-time * 38) * 0.4;
});

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(new URL("kick.wav", outputDirectory), wav(kick)),
  writeFile(new URL("snare.wav", outputDirectory), wav(snare)),
  writeFile(new URL("hat.wav", outputDirectory), wav(hat)),
]);
```

Run: `node scripts/generate-drum-samples.mjs`

Then delete `scripts/generate-drum-samples.mjs` with `apply_patch`; only the generated WAVs belong in the product.

Create `public/demo/drums/LICENSE.md`:

```markdown
# AgentDAW drum samples

`kick.wav`, `snare.wav`, and `hat.wav` were generated specifically for this
repository by a deterministic one-time synthesis script. They contain no
third-party recordings and are distributed under the repository's MIT License.
```

- [ ] **Step 5: Run focused tests and typechecking**

Run: `node --disable-warning=ExperimentalWarning --test test/audio-catalog.test.ts`

Expected: 4 tests PASS.

Run: `npm run typecheck`

Expected: PASS with no diagnostics.

- [ ] **Step 6: Commit the catalog and assets**

```bash
git add src/audio public/demo/drums test/audio-catalog.test.ts
git commit -m "feat: add audio sound catalog"
```

---

### Task 2: Pure musical timing and timeline expansion

**Files:**
- Create: `src/audio/timeline.ts`
- Modify: `src/audio/index.ts`
- Create: `test/audio-fixtures.ts`
- Create: `test/audio-timeline.test.ts`

**Interfaces:**
- Consumes: `Project` from `src/project/index.ts`.
- Produces: `DrumTimelineEvent`, `SynthTimelineEvent`, `TimelineEvent`, `TimelineIssue`, `TimelineExpansion`, `secondsPerStep(bpm)`, `positionAtAudioTime(...)`, `audioTimeForStep(...)`, `arrangementEndStep(project)`, `playbackFingerprint(project)`, and `expandTimeline(project, startStep, endStep)`.
- Consumed by: engine scheduler and engine project-replacement logic.

- [ ] **Step 1: Add the shared audio project fixture**

Create `test/audio-fixtures.ts` with one drum pattern repeated twice and one synth clip beginning at bar 2:

```ts
import type { Project } from "../src/project/index.ts";

export const audioProject = (): Project => ({
  schemaVersion: 1,
  id: "00000000-0000-4000-8000-000000000001",
  name: "Audio test",
  bpm: 120,
  masterVolumeDb: 0,
  tracks: [
    {
      id: "00000000-0000-4000-8000-000000000002",
      name: "Drums",
      kind: "drum",
      instrumentId: "kit.basic",
      volumeDb: 0,
      pan: 0,
      muted: false,
      soloed: false,
    },
    {
      id: "00000000-0000-4000-8000-000000000003",
      name: "Bass",
      kind: "synth",
      instrumentId: "synth.bass",
      volumeDb: -6,
      pan: 0,
      muted: false,
      soloed: false,
    },
  ],
  patterns: [
    {
      id: "00000000-0000-4000-8000-000000000004",
      trackId: "00000000-0000-4000-8000-000000000002",
      name: "Beat",
      kind: "drum",
      lengthBars: 1,
      events: [
        { id: "00000000-0000-4000-8000-000000000005", soundId: "kick", startStep: 0 },
        { id: "00000000-0000-4000-8000-000000000006", soundId: "snare", startStep: 4 },
      ],
    },
    {
      id: "00000000-0000-4000-8000-000000000007",
      trackId: "00000000-0000-4000-8000-000000000003",
      name: "Bass note",
      kind: "synth",
      lengthBars: 1,
      events: [
        {
          id: "00000000-0000-4000-8000-000000000008",
          midiNote: 48,
          startStep: 4,
          lengthSteps: 8,
        },
      ],
    },
  ],
  arrangement: [
    {
      id: "00000000-0000-4000-8000-000000000009",
      patternId: "00000000-0000-4000-8000-000000000004",
      startBar: 0,
      repeatCount: 2,
    },
    {
      id: "00000000-0000-4000-8000-000000000010",
      patternId: "00000000-0000-4000-8000-000000000007",
      startBar: 2,
      repeatCount: 1,
    },
  ],
});
```

- [ ] **Step 2: Write failing timing and expansion tests**

Create `test/audio-timeline.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  arrangementEndStep,
  audioTimeForStep,
  expandTimeline,
  playbackFingerprint,
  positionAtAudioTime,
  secondsPerStep,
} from "../src/audio/index.ts";
import { audioProject } from "./audio-fixtures.ts";

test("timing maps steps to the audio clock at the project BPM", () => {
  assert.equal(secondsPerStep(120), 0.125);
  assert.equal(audioTimeForStep(12, 4, 10, 120), 11);
  assert.equal(positionAtAudioTime(4, 10, 11, 120), 12);
  assert.equal(positionAtAudioTime(4, 10, 9, 120), 4);
  assert.throws(() => secondsPerStep(39), RangeError);
});

test("timeline expands repeats with stable half-open boundaries", () => {
  const result = expandTimeline(audioProject(), 0, 17);
  assert.deepEqual(
    result.events.map(({ key, startStep }) => [key, startStep]),
    [
      ["00000000-0000-4000-8000-000000000009:0:00000000-0000-4000-8000-000000000005", 0],
      ["00000000-0000-4000-8000-000000000009:0:00000000-0000-4000-8000-000000000006", 4],
      ["00000000-0000-4000-8000-000000000009:1:00000000-0000-4000-8000-000000000005", 16],
    ],
  );
  assert.deepEqual(result.issues, []);
  assert.equal(arrangementEndStep(audioProject()), 48);
});

test("seek into a sustained synth note keeps only its remaining duration", () => {
  const result = expandTimeline(audioProject(), 40, 42);
  assert.deepEqual(result.events, [
    {
      key: "00000000-0000-4000-8000-000000000010:0:00000000-0000-4000-8000-000000000008",
      kind: "synth",
      trackId: "00000000-0000-4000-8000-000000000003",
      instrumentId: "synth.bass",
      startStep: 40,
      durationSteps: 4,
      midiNote: 48,
    },
  ]);
});

test("mixer-only changes preserve the playback fingerprint", () => {
  const before = audioProject();
  const changedTrack = { ...before.tracks[0]!, volumeDb: -12, muted: true };
  const after = { ...before, masterVolumeDb: -6, tracks: [changedTrack, before.tracks[1]!] };
  assert.equal(playbackFingerprint(before), playbackFingerprint(after));
  assert.notEqual(playbackFingerprint(before), playbackFingerprint({ ...before, bpm: 121 }));
});

test("stale references are skipped with entity-specific diagnostics", () => {
  const value = audioProject();
  const result = expandTimeline(
    { ...value, patterns: value.patterns.slice(1) },
    0,
    16,
  );
  assert.deepEqual(result.events, []);
  assert.equal(result.issues[0]?.code, "missing_pattern");
  assert.equal(result.issues[0]?.relatedId, value.arrangement[0]?.patternId);
});
```

- [ ] **Step 3: Run the focused test and confirm failure**

Run: `node --disable-warning=ExperimentalWarning --test test/audio-timeline.test.ts`

Expected: FAIL because the timeline exports do not exist.

- [ ] **Step 4: Implement timing, fingerprints, and expansion**

Create `src/audio/timeline.ts` with these exact public shapes:

```ts
import type { Project } from "../project/index.ts";

export interface DrumTimelineEvent {
  readonly key: string;
  readonly kind: "drum";
  readonly trackId: string;
  readonly instrumentId: string;
  readonly startStep: number;
  readonly soundId: string;
}

export interface SynthTimelineEvent {
  readonly key: string;
  readonly kind: "synth";
  readonly trackId: string;
  readonly instrumentId: string;
  readonly startStep: number;
  readonly durationSteps: number;
  readonly midiNote: number;
}

export type TimelineEvent = DrumTimelineEvent | SynthTimelineEvent;
export type TimelineIssueCode = "missing_pattern" | "missing_track" | "invalid_window";

export interface TimelineIssue {
  readonly code: TimelineIssueCode;
  readonly message: string;
  readonly relatedId?: string;
}

export interface TimelineExpansion {
  readonly events: readonly TimelineEvent[];
  readonly issues: readonly TimelineIssue[];
}

export const secondsPerStep = (bpm: number): number => {
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) {
    throw new RangeError(`BPM must be a finite number from 40 through 240; received ${bpm}`);
  }
  return 60 / bpm / 4;
};

export const positionAtAudioTime = (
  anchorStep: number,
  anchorAudioTime: number,
  audioTime: number,
  bpm: number,
): number => Math.max(
  anchorStep,
  anchorStep + (audioTime - anchorAudioTime) / secondsPerStep(bpm),
);

export const audioTimeForStep = (
  step: number,
  anchorStep: number,
  anchorAudioTime: number,
  bpm: number,
): number => anchorAudioTime + (step - anchorStep) * secondsPerStep(bpm);

export const arrangementEndStep = (project: Project): number => {
  const patterns = new Map(project.patterns.map((pattern) => [pattern.id, pattern]));
  return project.arrangement.reduce((end, clip) => {
    const pattern = patterns.get(clip.patternId);
    return pattern === undefined
      ? end
      : Math.max(end, clip.startBar * 16 + pattern.lengthBars * 16 * clip.repeatCount);
  }, 0);
};

export const playbackFingerprint = (project: Project): string =>
  JSON.stringify([
    project.bpm,
    project.tracks.map(({ id, kind, instrumentId }) => ({ id, kind, instrumentId })),
    project.patterns,
    project.arrangement,
  ]);
```

Implement `expandTimeline` as a bounded linear scan:

1. Return `{ events: [], issues: [{ code: "invalid_window", message: "..." }] }` when either bound is non-finite, start is negative, or end is not greater than start.
2. Build pattern and track maps once.
3. For each clip and repeat, compute `repeatStart = clip.startBar * 16 + repeatIndex * pattern.lengthBars * 16`.
4. Emit drums only when `globalStart >= startStep && globalStart < endStep`.
5. Emit synths when `globalEnd > startStep && globalStart < endStep`, setting emitted start to `Math.max(globalStart, startStep)` and duration to `globalEnd - emittedStart`.
6. Use `${clip.id}:${repeatIndex}:${event.id}` as the key.
7. Sort by start step, then project track order, then original pattern event order. Keep the original order index local rather than adding it to public event values.
8. Add one issue per missing clip reference or missing owning track and continue sibling clips.

Extend `src/audio/index.ts`:

```ts
export * from "./catalog.ts";
export * from "./timeline.ts";
```

- [ ] **Step 5: Run focused tests and typechecking**

Run: `node --disable-warning=ExperimentalWarning --test test/audio-timeline.test.ts`

Expected: 5 tests PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the timeline**

```bash
git add src/audio test/audio-fixtures.ts test/audio-timeline.test.ts
git commit -m "feat: add audio timeline expansion"
```

---

### Task 3: Drum sampler with partial-failure recovery

**Files:**
- Create: `src/audio/sampler.ts`
- Modify: `src/audio/index.ts`
- Create: `test/audio-fakes.ts`
- Create: `test/audio-sampler.test.ts`

**Interfaces:**
- Consumes: `DrumKitDefinition` and `DrumTimelineEvent`.
- Produces: `LoadArrayBuffer`, `SamplePreparation`, `DrumSource`, `Sampler`, `SamplerOptions`, and `createSampler(options)`.
- `DrumSource` exposes `key`, idempotent `stop(audioTime)`, and `ended: Promise<void>`.
- Consumed by: audio engine.

- [ ] **Step 1: Add minimal Web Audio fakes**

Create `test/audio-fakes.ts`. The fake classes do not implement DOM interfaces; factory methods cast them only at the test boundary:

```ts
export interface AutomationEvent {
  readonly method: "set" | "linear" | "cancel";
  readonly value?: number;
  readonly time: number;
}

export class FakeAudioParam {
  value = 0;
  readonly events: AutomationEvent[] = [];

  setValueAtTime(value: number, time: number): FakeAudioParam {
    this.value = value;
    this.events.push({ method: "set", value, time });
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): FakeAudioParam {
    this.value = value;
    this.events.push({ method: "linear", value, time });
    return this;
  }

  cancelScheduledValues(time: number): FakeAudioParam {
    this.events.push({ method: "cancel", time });
    return this;
  }
}

export class FakeAudioNode {
  readonly connections: unknown[] = [];
  disconnected = false;

  connect(destination: unknown): unknown {
    this.connections.push(destination);
    return destination;
  }

  disconnect(): void {
    this.disconnected = true;
    this.connections.length = 0;
  }
}

export class FakeBufferSource extends FakeAudioNode {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  readonly startTimes: number[] = [];
  readonly stopTimes: number[] = [];

  start(when?: number): void {
    this.startTimes.push(when ?? 0);
  }

  stop(when?: number): void {
    this.stopTimes.push(when ?? 0);
  }

  finish(): void {
    this.onended?.();
  }
}

export class FakeGainNode extends FakeAudioNode {
  readonly gain = new FakeAudioParam();
}

export class FakeStereoPannerNode extends FakeAudioNode {
  readonly pan = new FakeAudioParam();
}

export class FakeOscillatorNode extends FakeAudioNode {
  type: OscillatorType = "sine";
  readonly frequency = new FakeAudioParam();
  onended: (() => void) | null = null;
  readonly startTimes: number[] = [];
  readonly stopTimes: number[] = [];

  start(when?: number): void {
    this.startTimes.push(when ?? 0);
  }

  stop(when?: number): void {
    this.stopTimes.splice(0, this.stopTimes.length, when ?? 0);
  }

  finish(): void {
    this.onended?.();
  }
}

export class FakeBiquadFilterNode extends FakeAudioNode {
  type: BiquadFilterType = "lowpass";
  readonly frequency = new FakeAudioParam();
  readonly Q = new FakeAudioParam();
}

export class FakeAudioContext {
  currentTime = 0;
  state: AudioContextState = "suspended";
  readonly destination = new FakeAudioNode();
  readonly bufferSources: FakeBufferSource[] = [];
  readonly gains: FakeGainNode[] = [];
  readonly panners: FakeStereoPannerNode[] = [];
  readonly oscillators: FakeOscillatorNode[] = [];
  readonly filters: FakeBiquadFilterNode[] = [];
  decodeFailures = 0;

  async resume(): Promise<void> {
    this.state = "running";
  }

  async close(): Promise<void> {
    this.state = "closed";
  }

  async decodeAudioData(_: ArrayBuffer): Promise<AudioBuffer> {
    if (this.decodeFailures > 0) {
      this.decodeFailures -= 1;
      throw new DOMException("decode failed", "EncodingError");
    }
    return { duration: 0.1 } as AudioBuffer;
  }

  createBufferSource(): AudioBufferSourceNode {
    const value = new FakeBufferSource();
    this.bufferSources.push(value);
    return value as unknown as AudioBufferSourceNode;
  }

  createGain(): GainNode {
    const value = new FakeGainNode();
    this.gains.push(value);
    return value as unknown as GainNode;
  }

  createStereoPanner(): StereoPannerNode {
    const value = new FakeStereoPannerNode();
    this.panners.push(value);
    return value as unknown as StereoPannerNode;
  }

  createOscillator(): OscillatorNode {
    const value = new FakeOscillatorNode();
    this.oscillators.push(value);
    return value as unknown as OscillatorNode;
  }

  createBiquadFilter(): BiquadFilterNode {
    const value = new FakeBiquadFilterNode();
    this.filters.push(value);
    return value as unknown as BiquadFilterNode;
  }

  asAudioContext(): AudioContext {
    return this as unknown as AudioContext;
  }
}
```

- [ ] **Step 2: Write failing sampler tests**

Create `test/audio-sampler.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the focused test and confirm failure**

Run: `node --disable-warning=ExperimentalWarning --test test/audio-sampler.test.ts`

Expected: FAIL because `createSampler` does not exist.

- [ ] **Step 4: Implement the sampler**

Create `src/audio/sampler.ts` with these exact contracts:

```ts
import type { DrumKitDefinition, DrumSoundId } from "./catalog.ts";
import type { DrumTimelineEvent } from "./timeline.ts";

export type LoadArrayBuffer = (url: string) => Promise<ArrayBuffer>;

export interface SamplePreparation {
  readonly readySoundIds: readonly DrumSoundId[];
  readonly unavailableSoundIds: readonly DrumSoundId[];
}

export interface DrumSource {
  readonly key: string;
  readonly ended: Promise<void>;
  stop(audioTime: number): void;
}

export interface SamplerOptions {
  readonly context: AudioContext;
  readonly kit: DrumKitDefinition;
  readonly loadArrayBuffer: LoadArrayBuffer;
}

export interface Sampler {
  prepare(): Promise<SamplePreparation>;
  schedule(
    event: DrumTimelineEvent,
    audioTime: number,
    destination: AudioNode,
  ): DrumSource | undefined;
  clear(): void;
}

export function createSampler(options: SamplerOptions): Sampler;
```

Implementation requirements:

- Retain one pending preparation promise so concurrent calls never duplicate loads.
- Load only sounds without decoded buffers concurrently with `Promise.allSettled`.
- Decode successful array buffers through `options.context.decodeAudioData` and retain buffers by sound ID.
- Preserve kit order in both preparation arrays.
- After complete success, later preparation returns from the buffer cache without I/O. After partial failure, later preparation retries only unavailable sounds.
- `schedule` returns `undefined` for unknown or unavailable sounds.
- Set `AudioBufferSourceNode.buffer`, connect to the destination, and call `start(audioTime)`.
- Resolve `ended` from `node.onended`, disconnect the node there, and guard both `stop` and cleanup so repeats are no-ops.
- `clear` drops decoded buffers and the retained preparation promise; it does not stop engine-owned sources.

Extend `src/audio/index.ts` with `export * from "./sampler.ts";`.

- [ ] **Step 5: Run focused tests and typechecking**

Run: `node --disable-warning=ExperimentalWarning --test test/audio-sampler.test.ts`

Expected: 4 tests PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the sampler**

```bash
git add src/audio test/audio-fakes.ts test/audio-sampler.test.ts
git commit -m "feat: add drum sampler"
```

---

### Task 4: Fixed polyphonic synth and voice cap

**Files:**
- Create: `src/audio/synth.ts`
- Modify: `src/audio/index.ts`
- Create: `test/audio-synth.test.ts`

**Interfaces:**
- Consumes: `SYNTH_PRESETS`, `SynthPreset`, and `SynthTimelineEvent`.
- Produces: `SynthVoice`, `Synth`, `SynthOptions`, `midiNoteToFrequency(note)`, and `createSynth(options)`.
- `SynthVoice` exposes `key`, `trackId`, `startedAt`, idempotent `stop(audioTime)`, and `ended: Promise<void>`.
- Consumed by: audio engine.

- [ ] **Step 1: Write failing synth tests**

Create `test/audio-synth.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `node --disable-warning=ExperimentalWarning --test test/audio-synth.test.ts`

Expected: FAIL because the synth exports do not exist.

- [ ] **Step 3: Implement the fixed preset synth**

Create `src/audio/synth.ts` with exact contracts:

```ts
import type { SynthPreset, SynthPresetId } from "./catalog.ts";
import type { SynthTimelineEvent } from "./timeline.ts";

export interface SynthVoice {
  readonly key: string;
  readonly trackId: string;
  readonly startedAt: number;
  readonly ended: Promise<void>;
  stop(audioTime: number): void;
}

export interface SynthOptions {
  readonly context: AudioContext;
  readonly presets: Readonly<Record<SynthPresetId, SynthPreset>>;
  readonly voiceCap: number;
  readonly stopRampSeconds: number;
}

export interface Synth {
  schedule(
    event: SynthTimelineEvent,
    audioTime: number,
    durationSeconds: number,
    destination: AudioNode,
  ): SynthVoice | undefined;
  stopAll(audioTime: number): void;
  stopTrack(trackId: string, audioTime: number): void;
  activeVoiceCount(): number;
}

export const midiNoteToFrequency = (note: number): number =>
  440 * 2 ** ((note - 69) / 12);

export function createSynth(options: SynthOptions): Synth;
```

For each voice:

1. Create one oscillator, low-pass filter, and gain.
2. Set oscillator type/frequency and filter cutoff/Q at `audioTime`.
3. Connect oscillator → filter → gain → destination.
4. Schedule gain at 0, linear peak at attack end, linear `peak * sustain` at decay end, hold through `audioTime + durationSeconds`, then linear 0 through release end.
5. Start at `audioTime` and stop at `audioTime + durationSeconds + releaseSeconds`.
6. Resolve `ended`, disconnect all three nodes, and remove the voice from the active registry from `oscillator.onended`.
7. Before creating at the cap, choose the oldest voice on the requesting track, otherwise the oldest globally; call its stop with `audioTime`, which ramps to zero and stops at `audioTime + stopRampSeconds`.
8. Remove a forced-stop voice from the active registry immediately; its later `onended` callback only performs guarded node cleanup.
9. Guard stop/cleanup so repeated calls do nothing.
10. Reject non-positive `voiceCap` and `stopRampSeconds` with actionable `RangeError` messages when creating the synth.

Extend `src/audio/index.ts` with `export * from "./synth.ts";`.

- [ ] **Step 4: Run focused tests and typechecking**

Run: `node --disable-warning=ExperimentalWarning --test test/audio-synth.test.ts`

Expected: 4 tests PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the synth**

```bash
git add src/audio test/audio-synth.test.ts
git commit -m "feat: add preset synth"
```

---

### Task 5: Audio context, mixer buses, and project replacement

**Files:**
- Create: `src/audio/engine.ts`
- Modify: `src/audio/index.ts`
- Modify: `test/audio-fakes.ts`
- Create: `test/audio-engine.test.ts`

**Interfaces:**
- Consumes: `Project`, `Track`, catalog, sampler, synth, arrangement-end, and playback-fingerprint APIs.
- Produces initially: `AudioEngineStatus`, `AudioIssue`, `AudioEngineSnapshot`, `PrepareResult`, `AudioEnginePlatform`, `AudioEngine`, and `createAudioEngine(platform)` with `prepare`, `replaceProject`, `getSnapshot`, and `dispose`.
- Task 6 extends `AudioEngine` with `play`, `pause`, `seek`, and `stop` without changing Task 5 method semantics.

- [ ] **Step 1: Extend fakes with deterministic timers**

Append to `test/audio-fakes.ts`:

```ts
export class FakeTimers {
  nextId = 1;
  readonly callbacks = new Map<number, () => void>();
  readonly intervals: number[] = [];

  setInterval(callback: () => void, milliseconds: number): unknown {
    const id = this.nextId;
    this.nextId += 1;
    this.callbacks.set(id, callback);
    this.intervals.push(milliseconds);
    return id;
  }

  clearInterval(handle: unknown): void {
    if (typeof handle === "number") this.callbacks.delete(handle);
  }

  tick(): void {
    for (const callback of [...this.callbacks.values()]) callback();
  }
}
```

- [ ] **Step 2: Write failing preparation, mixer, and replacement tests**

Create `test/audio-engine.test.ts` using the shared `audioProject()` fixture:

```ts
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
```

- [ ] **Step 3: Run the focused test and confirm failure**

Run: `node --disable-warning=ExperimentalWarning --test test/audio-engine.test.ts`

Expected: FAIL because `createAudioEngine` does not exist.

- [ ] **Step 4: Implement engine preparation, mixer, replacement, and disposal**

Create `src/audio/engine.ts` with these types:

```ts
import type { Project } from "../project/index.ts";
import { BASIC_DRUM_KIT, SYNTH_PRESETS } from "./catalog.ts";
import type { LoadArrayBuffer, Sampler } from "./sampler.ts";
import { createSampler } from "./sampler.ts";
import type { Synth } from "./synth.ts";
import { createSynth } from "./synth.ts";
import { arrangementEndStep, playbackFingerprint } from "./timeline.ts";

export type AudioEngineStatus = "stopped" | "playing" | "paused" | "blocked" | "closed";
export type AudioIssueCode =
  | "missing_sample"
  | "missing_pattern"
  | "missing_track"
  | "unknown_preset"
  | "late_scheduler"
  | "source_failed";

export interface AudioIssue {
  readonly code: AudioIssueCode;
  readonly message: string;
  readonly relatedId?: string;
}

export interface AudioEngineSnapshot {
  readonly status: AudioEngineStatus;
  readonly positionStep: number;
  readonly arrangementEndStep: number;
  readonly unavailableSoundIds: readonly string[];
  readonly activeVoices: number;
  readonly pendingSources: number;
  readonly lateWakeups: number;
  readonly trackBusCount: number;
  readonly lastIssue?: AudioIssue;
}

export type PrepareResult =
  | { readonly ok: true; readonly status: "ready" | "degraded"; readonly unavailableSoundIds: readonly string[] }
  | { readonly ok: false; readonly code: "blocked" | "closed"; readonly message: string };

export interface AudioEnginePlatform {
  readonly createContext: () => AudioContext;
  readonly loadArrayBuffer: LoadArrayBuffer;
  readonly setInterval: (callback: () => void, milliseconds: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
}

export interface AudioEngine {
  prepare(): Promise<PrepareResult>;
  replaceProject(project: Project): void;
  getSnapshot(): AudioEngineSnapshot;
  dispose(): Promise<void>;
}

export function createAudioEngine(platform: AudioEnginePlatform): AudioEngine;
```

Implementation requirements:

- Create the `AudioContext`, sampler, synth, master gain, and track buses lazily in `prepare`.
- Call `resume` before awaiting sample loading; return blocked if state remains non-running.
- Create one track `GainNode → StereoPannerNode → master GainNode` bus keyed by track ID.
- Use `10 ** (decibels / 20)` for unmuted gain, exactly 0 for muted or excluded-by-solo tracks, and ramp gain/pan/master values over 0.005 seconds.
- `replaceProject` stores snapshots before preparation, synchronizes buses after preparation, stops/deletes removed track sources, and stores the playback fingerprint and arrangement end.
- Return degraded preparation when one or more samples are unavailable and set `lastIssue` to the first missing sound.
- `dispose` is idempotent: stop sampler/synth runtime state, disconnect buses/master, clear buffers, close context, and permanently set closed status.
- `getSnapshot` returns a fresh read-only value and never exposes runtime nodes.

Extend `src/audio/index.ts` with `export * from "./engine.ts";`.

- [ ] **Step 5: Run focused tests and typechecking**

Run: `node --disable-warning=ExperimentalWarning --test test/audio-engine.test.ts`

Expected: 4 tests PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit engine preparation and mixing**

```bash
git add src/audio test/audio-fakes.ts test/audio-engine.test.ts
git commit -m "feat: add audio engine mixer"
```

---

### Task 6: Transport, look-ahead scheduling, live edits, and final verification

**Files:**
- Modify: `src/audio/engine.ts`
- Modify: `test/audio-engine.test.ts`

**Interfaces:**
- Extends `AudioEngine` with `play(startStep): Promise<AudioControlResult>`, `pause(): AudioControlResult`, `seek(step): AudioControlResult`, and `stop(): AudioControlResult`.
- Produces: `AudioControlResult` and the complete public engine contract.
- Consumes all earlier audio modules.

- [ ] **Step 1: Add failing transport and scheduling tests**

Extend `test/audio-engine.test.ts` with explicit tests using `FakeAudioContext`, `FakeTimers`, and the complete project fixture:

```ts
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
```

- [ ] **Step 2: Run transport tests and confirm failure**

Run: `node --disable-warning=ExperimentalWarning --test --test-name-pattern="play|pause|mixer-only|late|empty" test/audio-engine.test.ts`

Expected: FAIL because transport methods and `AudioControlResult` do not exist.

- [ ] **Step 3: Implement the complete transport contract**

Add to `src/audio/engine.ts`:

```ts
export type AudioControlResult =
  | {
      readonly ok: true;
      readonly status: "playing" | "paused" | "stopped";
      readonly positionStep: number;
    }
  | {
      readonly ok: false;
      readonly code: "blocked" | "closed" | "nothing_to_play" | "no_project";
      readonly message: string;
    };

export interface AudioEngine {
  prepare(): Promise<PrepareResult>;
  replaceProject(project: Project): void;
  play(startStep: number): Promise<AudioControlResult>;
  pause(): AudioControlResult;
  seek(step: number): AudioControlResult;
  stop(): AudioControlResult;
  getSnapshot(): AudioEngineSnapshot;
  dispose(): Promise<void>;
}
```

Implement these exact rules:

1. `play` prepares the engine, rejects missing/empty projects, clamps the requested step, sets the anchor audio time to `context.currentTime + 0.05`, increments generation, immediately schedules `[startStep, startStep + 0.1 / secondsPerStep(bpm))`, then starts a 25 ms interval.
2. A scheduling tick derives current step only from the anchor and audio clock, expands through `context.currentTime + 0.1`, and suppresses event keys already pending in the current generation.
3. Convert each event step through `audioTimeForStep`; pass drums to sampler and synths to synth with `durationSteps * secondsPerStep(bpm)`.
4. Retain every source by event key and generation. On `ended`, delete it only if the retained source is still the same object.
5. If current audio time is later than the previously scheduled horizon, increment `lateWakeups`, record `late_scheduler`, clear pending future sources with the 5 ms stop ramp, increment generation, and schedule from the actual current step. Timeline semantics skip elapsed drums and emit remaining synth duration.
6. At arrangement end, clear the interval and set stopped while already-started release tails finish naturally.
7. `pause` captures current step, cancels interval/sources, and retains the clamped position. Pausing a non-playing engine is a successful no-op.
8. `seek` clamps the target. When playing, cancel and restart from that target; otherwise retain paused/stopped status without scheduling.
9. `stop` cancels interval/sources and resets position to step 0. Repeated stop is a successful no-op.
10. A composition-changing `replaceProject` while playing captures the old-BPM step, cancels, installs/clamps the new project, and restarts automatically. Mixer-only fingerprints retain generation and scheduled sources.
11. Removed tracks call `synth.stopTrack`; all their pending source keys are stopped and deleted.
12. `dispose` reuses cancellation, closes the context, and makes every later control return the exact closed failure.

- [ ] **Step 4: Run all audio tests and strict typechecking**

Run: `node --disable-warning=ExperimentalWarning --test test/audio-*.test.ts`

Expected: all audio tests PASS with no warnings or unhandled rejections.

Run: `npm test`

Expected: all 101 project tests plus all audio tests PASS.

Run: `npm run typecheck`

Expected: PASS with no diagnostics.

- [ ] **Step 5: Perform non-browser artifact and diff verification**

Run:

```bash
test -s public/demo/drums/kick.wav
test -s public/demo/drums/snare.wav
test -s public/demo/drums/hat.wav
git diff --check 6c6faa4..HEAD
git status --short
git diff --stat 6c6faa4..HEAD
```

Expected: all assets are non-empty, whitespace check passes, and status contains only intended Task 6 changes before commit.

Record this browser integration checklist in the execution handoff; do not mark it passed on this branch:

1. Start playback from a real click and confirm autoplay recovery.
2. Hear kick, snare, and hi-hat distinctly.
3. Hear bass, chord, lead, and pad presets including simultaneous chord notes.
4. Pause and resume without duplicate hits.
5. Seek into a held synth note and hear only its remaining duration.
6. Change BPM while playing and retain the same musical step.
7. Change volume, pan, mute, and solo without restarting the phrase.
8. Edit notes or arrangement and continue from the current step.
9. Remove one sample asset and confirm degraded playback names only that sound.
10. Dispose and confirm all sound and scheduling stop.

- [ ] **Step 6: Commit playback**

```bash
git add src/audio/engine.ts test/audio-engine.test.ts
git commit -m "feat: add audio playback transport"
```

---

## Final branch verification

After Task 6 commits, run on the exact branch head:

```bash
npm test
npm run typecheck
git diff --check 6c6faa4..HEAD
git status --short --branch
git log --oneline --decorate 6c6faa4..HEAD
```

Expected: complete tests and typechecking pass, diff check is clean, and the worktree has no uncommitted files. Report the browser smoke checklist as an explicit UI-integration dependency, along with any unavailable sample or calibration findings; do not add a test framework, bundler, or temporary UI merely to close that gate.
