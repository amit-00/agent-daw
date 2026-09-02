# WAV Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the existing Export button to render the current project and download a 44.1 kHz, 16-bit stereo WAV without changing project state or history.

**Architecture:** Add one `src/audio/exporter.ts` module that validates and schedules a frozen project through the existing timeline, sampler, synth, and mixer rules, then encodes the rendered buffer. Keep download side effects in a browser wrapper and request state in `Transport`.

**Tech Stack:** TypeScript 6, React 19, native Web Audio, Node test runner, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-02-wav-export-design.md`

## Global Constraints

- Output is fixed at 2 channels, 44,100 Hz, signed 16-bit little-endian PCM.
- Reject total rendered duration above 600 seconds before allocating the rendering context.
- Reuse the existing timeline, sampler, synth presets, and mixer rules.
- Include the longest release tail used by scheduled synth events.
- Export a `structuredClone` of the project and never dispatch a command or create history.
- Use the user-facing name “WAV export”; `OfflineAudioContext` is an internal implementation detail.
- Add no runtime or development dependency.
- Keep live playback behavior unchanged.

---

### Task 1: PCM encoder and file naming

**Files:**
- Create: `src/audio/exporter.ts`
- Create: `test/audio-exporter.test.ts`
- Modify: `src/audio/index.ts`

**Interfaces:**
- Consumes: native `AudioBuffer` and a project name string.
- Produces: `encodeWav(buffer: AudioBuffer): Blob` and `wavFileName(projectName: string): string`.

- [ ] **Step 1: Write the failing encoder and naming tests**

The production changes these tests catch are incorrect RIFF sizes, non-stereo interleaving, asymmetric PCM scaling, unsafe file names, and a missing fallback.

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { encodeWav, wavFileName } from "../src/audio/index.ts";

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
  assert.equal(wavFileName('  Demo: Beat/One.  '), "Demo- Beat-One.wav");
  assert.equal(wavFileName(' \\ / : * ? " < > | . '), "agentdaw.wav");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --disable-warning=ExperimentalWarning --test test/audio-exporter.test.ts`

Expected: FAIL because `encodeWav` and `wavFileName` are not exported.

- [ ] **Step 3: Implement the minimal encoder and name sanitizer**

Create `src/audio/exporter.ts` with the native RIFF encoder. Reject buffers that are not stereo or not 44.1 kHz because accepting them would produce a header that violates the export contract.

```ts
const CHANNELS = 2;
const SAMPLE_RATE = 44_100;
const BYTES_PER_SAMPLE = 2;
const WAV_HEADER_BYTES = 44;

const writeAscii = (view: DataView, offset: number, value: string): void => {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
};

const pcm16 = (sample: number): number => {
  const clamped = Math.max(-1, Math.min(1, sample));
  return Math.round(clamped * (clamped < 0 ? 32_768 : 32_767));
};

export function encodeWav(buffer: AudioBuffer): Blob {
  if (buffer.numberOfChannels !== CHANNELS || buffer.sampleRate !== SAMPLE_RATE) {
    throw new RangeError("WAV export requires a 44.1 kHz stereo audio buffer");
  }
  const dataBytes = buffer.length * CHANNELS * BYTES_PER_SAMPLE;
  const output = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(output);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, output.byteLength - 8, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE, true);
  view.setUint16(32, CHANNELS * BYTES_PER_SAMPLE, true);
  view.setUint16(34, BYTES_PER_SAMPLE * 8, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
  let offset = WAV_HEADER_BYTES;
  for (let frame = 0; frame < buffer.length; frame += 1) {
    for (const channel of channels) {
      view.setInt16(offset, pcm16(channel[frame] ?? 0), true);
      offset += BYTES_PER_SAMPLE;
    }
  }
  return new Blob([output], { type: "audio/wav" });
}

export function wavFileName(projectName: string): string {
  const safeName = projectName
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "")
    .replace(/^[-. ]+$/g, "");
  return `${safeName || "agentdaw"}.wav`;
}
```

Export the module from `src/audio/index.ts`:

```ts
export * from "./exporter.ts";
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --disable-warning=ExperimentalWarning --test test/audio-exporter.test.ts`

Expected: PASS with 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/audio/exporter.ts src/audio/index.ts test/audio-exporter.test.ts
git commit -m "feat: encode WAV exports"
```

---

### Task 2: Render a valid project through the shared audio graph

**Files:**
- Modify: `src/audio/exporter.ts`
- Modify: `src/audio/sampler.ts`
- Modify: `src/audio/synth.ts`
- Modify: `test/audio-exporter.test.ts`
- Modify: `test/audio-fakes.ts`

**Interfaces:**
- Consumes: `Project`, `expandTimeline`, `Sampler`, `Synth`, `BASIC_DRUM_KIT`, `SYNTH_PRESETS`, and `WavExportPlatform`.
- Produces: `renderProjectToWav(project: Project, platform: WavExportPlatform): Promise<Blob>`.

- [ ] **Step 1: Add a rendering context fake and a failing valid-project test**

The production changes this test catches are omitted release tails, wrong event times, mixer values not applied at time zero, and a renderer that bypasses the existing audio graph.

Add to `test/audio-fakes.ts`:

```ts
export class FakeOfflineAudioContext extends FakeAudioContext {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  renderFailure: Error | undefined;

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    super();
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
  }

  async startRendering(): Promise<AudioBuffer> {
    if (this.renderFailure !== undefined) throw this.renderFailure;
    return {
      duration: this.length / this.sampleRate,
      length: this.length,
      numberOfChannels: this.numberOfChannels,
      sampleRate: this.sampleRate,
      getChannelData: (): Float32Array => new Float32Array(this.length),
    } as AudioBuffer;
  }

  asOfflineAudioContext(): OfflineAudioContext {
    return this as unknown as OfflineAudioContext;
  }
}
```

Add to `test/audio-exporter.test.ts`:

```ts
import { encodeWav, renderProjectToWav, wavFileName } from "../src/audio/index.ts";
import { audioProject } from "./audio-fixtures.ts";
import { FakeOfflineAudioContext } from "./audio-fakes.ts";

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
```

- [ ] **Step 2: Run the valid-project test and verify RED**

Run: `node --disable-warning=ExperimentalWarning --test --test-name-pattern="shared mixer graph" test/audio-exporter.test.ts`

Expected: FAIL because `renderProjectToWav` does not exist.

- [ ] **Step 3: Share the native context type**

Change only `SamplerOptions.context` and `SynthOptions.context` from
`AudioContext` to native `BaseAudioContext`. Their used methods already belong
to `BaseAudioContext`; `AudioEnginePlatform.createContext` remains
`() => AudioContext`.

```ts
export interface SamplerOptions {
  readonly context: BaseAudioContext;
  readonly kit: DrumKitDefinition;
  readonly loadArrayBuffer: LoadArrayBuffer;
}

export interface SynthOptions {
  readonly context: BaseAudioContext;
  readonly presets: Readonly<Record<SynthPresetId, SynthPreset>>;
  readonly voiceCap: number;
  readonly stopRampSeconds: number;
}
```

- [ ] **Step 4: Implement valid-project rendering**

Add these imports and contracts to `src/audio/exporter.ts`:

```ts
import type { Project, Track } from "../project/index.ts";
import {
  BASIC_DRUM_KIT,
  SYNTH_PRESETS,
  findSynthPreset,
} from "./catalog.ts";
import type { LoadArrayBuffer } from "./sampler.ts";
import { Sampler } from "./sampler.ts";
import { Synth } from "./synth.ts";
import { arrangementEndStep, expandTimeline, secondsPerStep } from "./timeline.ts";

export interface WavExportPlatform {
  readonly createContext: (
    channels: number,
    length: number,
    sampleRate: number,
  ) => OfflineAudioContext;
  readonly loadArrayBuffer: LoadArrayBuffer;
}
```

Implement `renderProjectToWav` with these exact rules:

```ts
const dbToGain = (decibels: number): number => 10 ** (decibels / 20);
const trackGain = (track: Track, hasSolo: boolean): number =>
  track.muted || (hasSolo && !track.soloed) ? 0 : dbToGain(track.volumeDb);

export async function renderProjectToWav(
  project: Project,
  platform: WavExportPlatform,
): Promise<Blob> {
  const endStep = arrangementEndStep(project);
  const expansion = expandTimeline(project, 0, endStep);
  const releaseSeconds = expansion.events.reduce((longest, event) =>
    event.kind === "synth"
      ? Math.max(longest, findSynthPreset(event.instrumentId)?.releaseSeconds ?? 0)
      : longest, 0);
  const durationSeconds = endStep * secondsPerStep(project.bpm) + releaseSeconds;
  const context = platform.createContext(
    CHANNELS,
    Math.ceil(durationSeconds * SAMPLE_RATE),
    SAMPLE_RATE,
  );
  const master = context.createGain();
  master.gain.setValueAtTime(dbToGain(project.masterVolumeDb), 0);
  master.connect(context.destination);
  const hasSolo = project.tracks.some(({ soloed }) => soloed);
  const buses = new Map(project.tracks.map((track) => {
    const gain = context.createGain();
    const panner = context.createStereoPanner();
    gain.gain.setValueAtTime(trackGain(track, hasSolo), 0);
    panner.pan.setValueAtTime(track.pan, 0);
    gain.connect(panner);
    panner.connect(master);
    return [track.id, gain] as const;
  }));
  const usedSoundIds = new Set(expansion.events
    .filter((event) => event.kind === "drum")
    .map(({ soundId }) => soundId));
  const sampler = new Sampler({
    context,
    kit: {
      ...BASIC_DRUM_KIT,
      sounds: BASIC_DRUM_KIT.sounds.filter(({ id }) => usedSoundIds.has(id)),
    },
    loadArrayBuffer: platform.loadArrayBuffer,
  });
  await sampler.prepare();
  const synthEvents = expansion.events.filter((event) => event.kind === "synth");
  const synth = new Synth({
    context,
    presets: SYNTH_PRESETS,
    voiceCap: Math.max(1, synthEvents.length),
    stopRampSeconds: 0.005,
  });
  for (const event of expansion.events) {
    const destination = buses.get(event.trackId);
    if (destination === undefined) continue;
    const start = event.startStep * secondsPerStep(project.bpm);
    if (event.kind === "drum") sampler.schedule(event, start, destination);
    else synth.schedule(
      event,
      start,
      event.durationSteps * secondsPerStep(project.bpm),
      destination,
    );
  }
  return encodeWav(await context.startRendering());
}
```

- [ ] **Step 5: Run focused and existing audio tests and verify GREEN**

Run:

```bash
node --disable-warning=ExperimentalWarning --test test/audio-exporter.test.ts
node --disable-warning=ExperimentalWarning --test test/audio-sampler.test.ts test/audio-synth.test.ts test/audio-engine.test.ts
```

Expected: both commands PASS.

- [ ] **Step 6: Commit**

```bash
git add src/audio/exporter.ts src/audio/sampler.ts src/audio/synth.ts test/audio-exporter.test.ts test/audio-fakes.ts
git commit -m "feat: render project WAV"
```

---

### Task 3: Reject incomplete or excessive exports

**Files:**
- Modify: `src/audio/exporter.ts`
- Modify: `test/audio-exporter.test.ts`

**Interfaces:**
- Consumes: `renderProjectToWav`, timeline issues, catalog lookups, sample preparation, and rendering failures.
- Produces: `WavExportErrorCode` and `WavExportError` with an actionable message and retained cause.

- [ ] **Step 1: Add failing table-driven validation tests**

The production changes these tests catch are allocating before duration validation, silently exporting stale references or unknown instruments, and returning a partial file when sample preparation fails.

```ts
import type { Project } from "../src/project/index.ts";
import {
  WavExportError,
  type WavExportErrorCode,
  encodeWav,
  renderProjectToWav,
  wavFileName,
} from "../src/audio/index.ts";

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
```

- [ ] **Step 2: Run validation tests and verify RED**

Run: `node --disable-warning=ExperimentalWarning --test --test-name-pattern="rejects invalid|distinguishes|decoded sample" test/audio-exporter.test.ts`

Expected: FAIL because invalid projects are not rejected with typed errors.

- [ ] **Step 3: Add typed errors and preflight validation**

Add the exact public error contract:

```ts
export type WavExportErrorCode =
  | "empty_arrangement"
  | "duration_exceeded"
  | "invalid_project_reference"
  | "unknown_preset"
  | "missing_sample"
  | "sample_load_failed"
  | "render_failed"
  | "download_failed";

export class WavExportError extends Error {
  readonly code: WavExportErrorCode;

  constructor(code: WavExportErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WavExportError";
    this.code = code;
  }
}
```

Add `findDrumSound` to the existing catalog import:

```ts
import {
  BASIC_DRUM_KIT,
  SYNTH_PRESETS,
  findDrumSound,
  findSynthPreset,
} from "./catalog.ts";
```

Before creating the context, reject in this order:

```ts
if (project.arrangement.length === 0) {
  throw new WavExportError("empty_arrangement", "Add an arrangement clip before exporting WAV");
}
if (endStep === 0 || expansion.issues.length > 0) {
  const issue = expansion.issues[0];
  throw new WavExportError(
    "invalid_project_reference",
    `Cannot export because the arrangement references a missing ${issue?.code === "missing_track" ? "track" : "pattern"}${issue?.relatedId === undefined ? "" : `: ${issue.relatedId}`}`,
  );
}
const unknownPreset = expansion.events.find((event) =>
  event.kind === "synth" && findSynthPreset(event.instrumentId) === undefined);
if (unknownPreset?.kind === "synth") {
  throw new WavExportError(
    "unknown_preset",
    `Cannot export because synth preset ${unknownPreset.instrumentId} is unavailable`,
  );
}
const unknownSound = expansion.events.find((event) =>
  event.kind === "drum" && findDrumSound(event.soundId) === undefined);
if (unknownSound?.kind === "drum") {
  throw new WavExportError(
    "missing_sample",
    `Cannot export because drum sample ${unknownSound.soundId} is unavailable`,
  );
}
if (durationSeconds > 600) {
  throw new WavExportError(
    "duration_exceeded",
    "WAV export cannot exceed 10 minutes; shorten the arrangement or raise its BPM",
  );
}
```

Wrap sample loading so the sampler can keep its existing degraded-playback behavior while export remains all-or-nothing:

```ts
let sampleLoadCause: unknown;
const sampler = new Sampler({
  context,
  kit: {
    ...BASIC_DRUM_KIT,
    sounds: BASIC_DRUM_KIT.sounds.filter(({ id }) => usedSoundIds.has(id)),
  },
  loadArrayBuffer: async (url) => {
    try {
      return await platform.loadArrayBuffer(url);
    } catch (cause) {
      sampleLoadCause = cause;
      throw cause;
    }
  },
});
const preparation = await sampler.prepare();
if (preparation.unavailableSoundIds.length > 0) {
  const soundId = preparation.unavailableSoundIds[0]!;
  throw new WavExportError(
    sampleLoadCause === undefined ? "missing_sample" : "sample_load_failed",
    `Cannot export because drum sample ${soundId} could not be loaded; retry the export`,
    sampleLoadCause,
  );
}
```

Wrap only `context.startRendering()` failures as `render_failed`; allow
existing `WavExportError` instances to propagate.

```ts
let rendered: AudioBuffer;
try {
  rendered = await context.startRendering();
} catch (cause) {
  throw new WavExportError(
    "render_failed",
    "WAV rendering failed; retry the export",
    cause,
  );
}
return encodeWav(rendered);
```

- [ ] **Step 4: Run all exporter tests and verify GREEN**

Run: `node --disable-warning=ExperimentalWarning --test test/audio-exporter.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/audio/exporter.ts test/audio-exporter.test.ts
git commit -m "feat: validate WAV exports"
```

---

### Task 4: Connect Export to browser download

**Files:**
- Modify: `src/audio/exporter.ts`
- Modify: `src/components/Transport.tsx`
- Modify: `src/components/Studio.test.tsx`

**Interfaces:**
- Consumes: `downloadProjectWav(project: Project): Promise<void>`, the current project from `useStudioStore`, and browser `OfflineAudioContext`, `fetch`, object URLs, and anchors.
- Produces: an enabled Export button with frozen-snapshot download, busy state, empty-project guidance, and actionable alerts.

- [ ] **Step 1: Add failing browser-flow tests**

The production changes these tests catch are exporting a mutable project, duplicate activation, leaked object URLs, history mutation, and swallowed user-visible failures.

Add a compact valid project fixture and browser fakes to
`src/components/Studio.test.tsx`, then add these tests:

```tsx
import { audioProject } from "../../test/audio-fixtures";
import { FakeOfflineAudioContext } from "../../test/audio-fakes";

it("downloads one WAV from a frozen project without creating history", async () => {
  let state: StudioState | undefined;
  function Probe(): null {
    state = useStudioStore((value) => value);
    return null;
  }
  let resolveRender: (() => void) | undefined;
  vi.stubGlobal("OfflineAudioContext", class extends FakeOfflineAudioContext {
    constructor(channels: number, length: number, sampleRate: number) {
      super(channels, length, sampleRate);
    }
    override startRendering(): Promise<AudioBuffer> {
      return new Promise((resolve) => {
        resolveRender = () => resolve({
          duration: this.length / this.sampleRate,
          length: this.length,
          numberOfChannels: 2,
          sampleRate: this.sampleRate,
          getChannelData: () => new Float32Array(this.length),
        } as AudioBuffer);
      });
    }
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new ArrayBuffer(8))));
  const createObjectURL = vi.fn(() => "blob:wav");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  let downloadedName = "";
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
    downloadedName = this.download;
  });
  const user = userEvent.setup();
  render(
    <StudioProvider initialProject={{ ...audioProject(), name: "Demo/Beat" }}>
      <Transport />
      <Probe />
    </StudioProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Export" }));
  expect(screen.getByRole("button", { name: "Exporting…" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Exporting…" }));
  await vi.waitFor(() => expect(resolveRender).toBeTypeOf("function"));
  act(() => state!.dispatch({
    id: "rename-during-export",
    source: "manual",
    label: "Rename during export",
    kind: "operation",
    operation: { type: "project.update", changes: { name: "Changed" } },
  }));
  resolveRender?.();
  await screen.findByRole("button", { name: "Export" });

  expect(click).toHaveBeenCalledOnce();
  expect(downloadedName).toBe("Demo-Beat.wav");
  expect(createObjectURL).toHaveBeenCalledOnce();
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:wav");
  expect(state?.history).toHaveLength(1);
});

it("keeps empty export disabled and reports a rendering failure", async () => {
  const user = userEvent.setup();
  const empty = render(
    <StudioProvider initialProject={EMPTY_PROJECT}><Transport /></StudioProvider>,
  );
  expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Export" })).toHaveAttribute(
    "title",
    "Add an arrangement clip before exporting WAV",
  );
  empty.unmount();

  vi.stubGlobal("OfflineAudioContext", class extends FakeOfflineAudioContext {
    override startRendering(): Promise<AudioBuffer> {
      return Promise.reject(new Error("render stopped"));
    }
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new ArrayBuffer(8))));
  render(
    <StudioProvider initialProject={audioProject()}><Transport /></StudioProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Export" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "WAV rendering failed; retry the export",
  );
});

it("reports a browser download failure without creating history", async () => {
  vi.stubGlobal("OfflineAudioContext", FakeOfflineAudioContext);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new ArrayBuffer(8))));
  vi.stubGlobal("URL", {
    createObjectURL: () => { throw new Error("downloads blocked"); },
    revokeObjectURL: vi.fn(),
  });
  const user = userEvent.setup();
  render(
    <StudioProvider initialProject={audioProject()}><Transport /></StudioProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Export" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "WAV download failed; retry the export",
  );
  expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
});
```

- [ ] **Step 2: Run the Studio tests and verify RED**

Run: `../../node_modules/.bin/vitest run src/components/Studio.test.tsx -t "downloads one WAV|keeps empty export|reports a browser download"`

Expected: FAIL because Export remains permanently disabled and no download wrapper exists.

- [ ] **Step 3: Implement the browser download wrapper**

Add to `src/audio/exporter.ts`:

```ts
const loadArrayBuffer = async (url: string): Promise<ArrayBuffer> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Drum sample request failed with HTTP ${response.status}`);
  }
  return response.arrayBuffer();
};

export async function downloadProjectWav(project: Project): Promise<void> {
  const blob = await renderProjectToWav(project, {
    createContext: (channels, length, sampleRate) =>
      new OfflineAudioContext(channels, length, sampleRate),
    loadArrayBuffer,
  });
  let url: string | undefined;
  let anchor: HTMLAnchorElement | undefined;
  try {
    url = URL.createObjectURL(blob);
    anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = wavFileName(project.name);
    document.body.append(anchor);
    anchor.click();
  } catch (cause) {
    throw new WavExportError(
      "download_failed",
      "WAV download failed; retry the export",
      cause,
    );
  } finally {
    anchor?.remove();
    if (url !== undefined) URL.revokeObjectURL(url);
  }
}
```

- [ ] **Step 4: Enable the Transport flow**

Import `useState`, `downloadProjectWav`, and `WavExportError`. Add local state
and this handler inside `Transport`:

```tsx
const [exporting, setExporting] = useState(false);
const [exportError, setExportError] = useState<string | null>(null);

async function handleExport(): Promise<void> {
  if (exporting || project.arrangement.length === 0) return;
  setExporting(true);
  setExportError(null);
  try {
    await downloadProjectWav(structuredClone(project));
  } catch (error) {
    setExportError(error instanceof WavExportError
      ? error.message
      : "WAV export failed; retry the export");
  } finally {
    setExporting(false);
  }
}
```

Replace the disabled placeholder button with:

```tsx
<button
  type="button"
  disabled={exporting || project.arrangement.length === 0}
  aria-busy={exporting}
  title={project.arrangement.length === 0
    ? "Add an arrangement clip before exporting WAV"
    : "Download WAV"}
  onClick={() => void handleExport()}
  className="flex items-center gap-[7px] rounded-[7px] border border-white/15 bg-white/[0.055] px-3 py-2 text-xs text-zinc-200 enabled:hover:border-white/25 enabled:hover:bg-white/[0.09] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300 disabled:text-zinc-600"
>
  <Icon name="download" /> {exporting ? "Exporting…" : "Export"}
</button>
{exporting && <span className="sr-only" role="status">Exporting WAV</span>}
{exportError && <p className="absolute right-3 top-full mt-2 rounded-md border border-rose-400/20 bg-rose-950/95 px-3 py-2 text-xs text-rose-200" role="alert">{exportError}</p>}
```

- [ ] **Step 5: Run focused UI and exporter tests and verify GREEN**

Run:

```bash
node --disable-warning=ExperimentalWarning --test test/audio-exporter.test.ts
../../node_modules/.bin/vitest run src/components/Studio.test.tsx
```

Expected: both commands PASS.

- [ ] **Step 6: Run complete verification**

Run:

```bash
pnpm run test:project
../../node_modules/.bin/vitest run
../../node_modules/.bin/tsc --noEmit
../../node_modules/.bin/tsc --project tsconfig.project.json
../../node_modules/.bin/eslint .
../../node_modules/.bin/next build
git diff --check
git status --short
```

Expected: all tests, both typechecks, lint, build, and diff checks PASS. The
working tree contains only the planned Task 4 code and test changes.

- [ ] **Step 7: Commit**

```bash
git add src/audio/exporter.ts src/components/Transport.tsx src/components/Studio.test.tsx
git commit -m "feat: download project WAV"
```
