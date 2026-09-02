# AgentDAW UI Service Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the existing workstation UI to project persistence and Web Audio with safe startup validation, one transport authority, live project synchronization, and truthful local status.

**Architecture:** A client bootstrap loads and decodes persistence before mounting the editor. The existing Zustand bridge remains the single project publication seam: one provider-owned subscription forwards each changed project identity to audio immediately and persistence asynchronously with newest-token-wins status. `ProjectService`, `AudioEngine`, and `ProjectPersistenceService` retain their current ownership boundaries.

**Tech Stack:** TypeScript 6, React 19, Next.js 16 App Router, Zustand 5, native Web Audio, native IndexedDB, Node test runner, Vitest, Testing Library, fake-indexeddb.

**Spec:** `docs/superpowers/specs/2026-09-02-ui-service-integration-design.md`

## Global Constraints

- Use the existing project, audio, and persistence classes; do not add a generic coordinator, event bus, repository interface, or runtime dependency.
- Load persistence before constructing the editable project session.
- Treat IndexedDB records as untrusted; validate them once in `src/persistence/` and keep `src/project/` trusted.
- Empty storage opens `DEMO_PROJECT` without immediately saving it.
- Corrupt or unsupported storage blocks editing until explicit clear succeeds.
- `AudioEngine` is the transport and playback-position authority; transport state is never added to `Project`.
- Undo, redo, and restore stop playback before installing an available history snapshot.
- Persist only the latest project. History, selection, UI state, transport, and decoded audio remain session-only.
- Keep loop, record, export, and level meters disabled.
- Keep the existing limits: 16 tracks, 128 patterns, 512 events per pattern, 512 clips, 256 arrangement bars, 100 operations per batch, and 100 history entries.
- Keep the existing 500 ms autosave debounce, 25 ms audio scheduler tick, and 100 ms audio look-ahead.
- Add no package without explicit human approval.
- Follow TDD: run each named failing test before its implementation, then run the focused file before committing.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/persistence/decode.ts` | Create | Pure validation and canonical construction of unknown schema-1/schema-2 projects. |
| `src/persistence/service.ts` | Modify | Delegate stored project decoding while preserving load/recovery/write ordering. |
| `test/persistence.test.ts` | Modify | Prove malformed nested records are rejected and valid/migrated records load. |
| `src/stores/studio-store.ts` | Modify | Add audio and persistence runtime projections plus explicit runtime actions. |
| `src/stores/studio-store.test.ts` | Modify | Prove transport controls, history-stop ordering, and save-token transitions. |
| `src/stores/studio-provider.tsx` | Modify | Own one effect-scoped engine, one project subscription for audio and persistence, animation-frame polling, visibility flush, and cleanup. |
| `src/components/Transport.tsx` | Modify | Enable play/pause/stop and render real position, audio, and persistence state. |
| `src/components/arrangement/Arrangement.tsx` | Modify | Render engine position, preview seek locally, and commit one seek on release. |
| `src/components/arrangement/Arrangement.test.tsx` | Modify | Verify engine-backed playhead bounds and gesture behavior. |
| `src/components/Studio.tsx` | Modify | Add async bootstrap, recovery UI, and separable mounted session. |
| `src/components/Studio.test.tsx` | Modify | Verify transport, persistence orchestration, status, and recovery behavior. |
| `src/components/arrangement/ArrangementGestures.test.tsx` | Modify | Mount the exported session directly so unrelated gesture tests stay synchronous. |
| `src/app/page.test.tsx` | Modify | Await the client bootstrap before asserting the workstation. |

---

### Task 1: Validate Stored Projects at the Persistence Boundary

**Files:**

- Create: `src/persistence/decode.ts`
- Modify: `src/persistence/service.ts:1-225`
- Test: `test/persistence.test.ts`

**Interfaces:**

- Consumes: `Project`, `ProjectV1`, `SoundCatalog`, `PROJECT_CAPS`, and `migrateProject` from the existing project package, plus `SOUND_CATALOG` from the existing audio catalog.
- Produces:

```ts
export type DecodeProjectResult =
  | { readonly ok: true; readonly project: Project }
  | {
      readonly ok: false;
      readonly code: "corrupt_record" | "unsupported_schema";
      readonly message: string;
      readonly cause?: unknown;
    };

export function decodeProject(
  value: unknown,
  catalog: SoundCatalog,
): DecodeProjectResult;
```

- `ProjectPersistenceService.load()` keeps its existing public result union and recovery behavior.

- [ ] **Step 1: Write failing tests for malformed schema-2 projects**

Add a table-driven group to `test/persistence.test.ts`. Each record must preserve its raw value, return `failed`, report `corrupt_record`, and block a later save with `recovery_required`.

```ts
const invalidProjects: readonly [string, unknown][] = [
  ["missing tracks", { ...blankProject(), tracks: undefined }],
  ["invalid BPM", { ...blankProject(), bpm: 241 }],
  ["duplicate track IDs", {
    ...blankProject(),
    tracks: [basicDrumTrack(), basicDrumTrack()],
  }],
  ["unknown instrument", {
    ...blankProject(),
    tracks: [{ ...basicDrumTrack(), instrumentId: "kit.missing" }],
  }],
  ["out-of-pattern hit", {
    ...projectWithBasicDrums(),
    patterns: [{ ...projectWithBasicDrums().patterns[0], events: [
      { id: "hit", soundId: "kick", startStep: 16 },
    ] }],
  }],
  ["missing clip pattern", {
    ...projectWithBasicDrums(),
    arrangement: [{ ...projectWithBasicDrums().arrangement[0], patternId: "missing" }],
  }],
  ["incompatible clip track", incompatibleClipProject()],
  ["overlapping clips", overlappingClipProject()],
];

for (const [name, project] of invalidProjects) {
  test(`load rejects schema 2 with ${name}`, async () => {
    const indexedDB = new IDBFactory();
    const record = { project, updatedAt: 123 };
    await seedRawRecord(indexedDB, record);
    const service = createService(indexedDB);

    const result = await service.load();

    assert.equal(result.status, "failed");
    if (result.status === "failed") assert.equal(result.error.code, "corrupt_record");
    assert.deepEqual(await readRawRecord(indexedDB), record);
    const save = await service.scheduleSave(blankProject());
    assert.equal(save.status, "failed");
    if (save.status === "failed") assert.equal(save.error.code, "recovery_required");
  });
}
```

Define `basicDrumTrack`, `projectWithBasicDrums`, `incompatibleClipProject`, and `overlappingClipProject` as small fixtures in the same test file. Use stable string IDs; do not introduce a fixture module.

Extend the same table to cover each decoder rule at least once: blank/overlong names, non-finite or out-of-range numeric fields, collection caps, duplicate pattern/event/clip IDs, malformed discriminated events, invalid MIDI note bounds/duration, unknown drum sound, missing track reference, non-integer clip fields, repeat limits, arrangement end limits, and drum-kit incompatibility. Keep one representative valid value at every inclusive numeric boundary.

- [ ] **Step 2: Run the new malformed-record tests and verify failure**

Run:

```bash
pnpm exec node --disable-warning=ExperimentalWarning --test --test-name-pattern="load rejects schema 2" test/persistence.test.ts
```

Expected: FAIL because the current loader accepts at least one malformed schema-2 record as `loaded`.

- [ ] **Step 3: Write failing tests for canonical decoding and schema-1 validation**

Add these focused assertions:

```ts
test("load constructs a detached canonical schema 2 project", async () => {
  const indexedDB = new IDBFactory();
  const project = { ...projectWithBasicDrums(), ignored: "discard me" };
  await seedRawRecord(indexedDB, { project, updatedAt: 123 });

  const result = await createService(indexedDB).load();

  assert.equal(result.status, "loaded");
  if (result.status === "loaded") {
    assert.equal("ignored" in result.project, false);
    assert.notEqual(result.project, project);
  }
});

test("load rejects invalid nested schema 1 data before migration", async () => {
  const indexedDB = new IDBFactory();
  const project = { ...legacyProject(), bpm: "fast" };
  await seedRawRecord(indexedDB, { project, updatedAt: 123 });

  const result = await createService(indexedDB).load();

  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.equal(result.error.code, "corrupt_record");
});
```

Run:

```bash
pnpm exec node --disable-warning=ExperimentalWarning --test --test-name-pattern="canonical schema 2|schema 1 data" test/persistence.test.ts
```

Expected: FAIL because schema 2 passes through by reference and schema 1 is only partially checked.

- [ ] **Step 4: Implement the pure decoder**

Create `src/persistence/decode.ts`. Use local path-aware readers and direct canonical object construction; do not add a schema framework.

```ts
import {
  migrateProject,
  PROJECT_CAPS,
  type ArrangementClip,
  type Pattern,
  type Project,
  type ProjectV1,
  type SoundCatalog,
  type Track,
} from "../project/index.ts";

export type DecodeProjectResult =
  | { readonly ok: true; readonly project: Project }
  | {
      readonly ok: false;
      readonly code: "corrupt_record" | "unsupported_schema";
      readonly message: string;
      readonly cause?: unknown;
    };

class ProjectDecodeError extends RangeError {}

const fail = (path: string, expectation: string): never => {
  throw new ProjectDecodeError(`${path} ${expectation}`);
};

const objectAt = (value: unknown, path: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail(path, "must be an object");
  }
  return value as Record<string, unknown>;
};

const arrayAt = (value: unknown, path: string, maximum: number): readonly unknown[] => {
  if (!Array.isArray(value) || value.length > maximum) {
    return fail(path, `must be an array with at most ${maximum} items`);
  }
  return value;
};

const stringAt = (value: unknown, path: string): string => {
  if (typeof value !== "string" || value.length === 0) return fail(path, "must be a non-empty string");
  return value;
};

const numberAt = (value: unknown, path: string, minimum: number, maximum: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    return fail(path, `must be a finite number from ${minimum} through ${maximum}`);
  }
  return value;
};

const integerAt = (value: unknown, path: string, minimum: number, maximum: number): number => {
  const result = numberAt(value, path, minimum, maximum);
  if (!Number.isInteger(result)) return fail(path, "must be an integer");
  return result;
};

const booleanAt = (value: unknown, path: string): boolean => {
  if (typeof value !== "boolean") return fail(path, "must be a boolean");
  return value;
};

const uniqueIds = (entities: readonly { readonly id: string }[], path: string): void => {
  if (new Set(entities.map(({ id }) => id)).size !== entities.length) fail(path, "must contain unique IDs");
};
```

Implement direct readers using these exact rules:

| Value | Required rule |
|---|---|
| Project | Schema 2 after migration, non-empty ID, bounded name, valid BPM/master volume, and capped arrays. |
| Project, track, and pattern names | String containing a non-whitespace character, at most 40 characters; validate without changing the stored value. |
| BPM | Finite 40 through 240. |
| Master volume | Finite -60 through 0 dB. |
| Track | Non-empty ID/name, `drum` or `synth`, catalog-compatible instrument, volume -60 through 6, pan -1 through 1, booleans for mute/solo, optional string color. |
| Pattern | Non-empty ID/name, matching discriminated event array, length 1/2/4 bars, maximum 512 events. |
| Drum hit | Non-empty ID, catalog sound ID, integer start from 0 through pattern steps minus 1. |
| Synth note | Non-empty ID, integer MIDI note 24 through 96, integer start at least 0, integer length at least 1, end no later than pattern end. |
| Clip | Non-empty ID, existing pattern/track IDs, matching kinds, compatible drum kit, integer start at least 0, repeat 1 through 64, end no later than bar 256. |
| Arrangement | Unique IDs and no overlap between clips on the same track. |

Complete the decoder with a single conversion boundary:

```ts
export function decodeProject(value: unknown, catalog: SoundCatalog): DecodeProjectResult {
  try {
    const source = objectAt(value, "project");
    const schemaVersion = source.schemaVersion;
    if (typeof schemaVersion === "number" && Number.isInteger(schemaVersion)
      && schemaVersion !== 1 && schemaVersion !== 2) {
      return {
        ok: false,
        code: "unsupported_schema",
        message: `Project schema ${schemaVersion} is unsupported`,
      };
    }
    if (schemaVersion !== 1 && schemaVersion !== 2) fail("project.schemaVersion", "must be 1 or 2");

    const project = schemaVersion === 1
      ? migrateProject(readProjectV1(source, catalog))
      : readProjectV2(source, catalog);
    validateRelationships(project, catalog);
    return { ok: true, project };
  } catch (error: unknown) {
    if (!(error instanceof ProjectDecodeError)) throw error;
    return { ok: false, code: "corrupt_record", message: error.message, cause: error };
  }
}
```

`readProjectV1`, `readProjectV2`, and `validateRelationships` remain private. Both readers must build new objects field by field so unknown stored fields are discarded.

- [ ] **Step 5: Route persistence load through the decoder**

In `src/persistence/service.ts`, import `SOUND_CATALOG` from `../audio/catalog.ts` and `decodeProject` from `./decode.ts`. Keep envelope and `updatedAt` validation in the service, then replace the project cast/migrate block with:

```ts
const decoded = decodeProject(record.project, SOUND_CATALOG);
if (!decoded.ok) {
  this.enterRecovery();
  return {
    status: "failed",
    error: persistenceError(decoded.code, decoded.message, decoded.cause),
  };
}
return {
  status: "loaded",
  project: decoded.project,
  updatedAt: record.updatedAt as number,
};
```

Remove the old schema cast and migration `try` block. Preserve the existing load barrier and recovery gate unchanged.

- [ ] **Step 6: Run persistence tests**

Run:

```bash
pnpm exec node --disable-warning=ExperimentalWarning --test --test-name-pattern="load|schema|recovery" test/persistence.test.ts
```

Expected: PASS for all load, schema, migration, and recovery tests.

Run:

```bash
pnpm run typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 7: Commit the persistence boundary**

```bash
git add src/persistence/decode.ts src/persistence/service.ts test/persistence.test.ts
git commit -m "feat: validate persisted projects"
```

---

### Task 2: Add Runtime State and Control Actions to the Studio Store

**Files:**

- Modify: `src/stores/studio-store.ts:1-516`
- Modify: `src/stores/studio-store.test.ts`

**Interfaces:**

- Consumes: an explicit `getAudioEngine: () => AudioEngine | null` dependency supplied by the provider.
- Produces these store types and actions:

```ts
export interface StudioAudioState {
  readonly engineReady: boolean;
  readonly pending: boolean;
  readonly snapshot: AudioEngineSnapshot;
  readonly errorMessage: string | null;
}

export type StudioPersistenceStatus =
  | "unsaved"
  | "saving"
  | "saved"
  | "memory-only"
  | "failed";

export interface StudioPersistenceState {
  readonly status: StudioPersistenceStatus;
  readonly latestSaveToken: number;
  readonly updatedAt: number | null;
  readonly errorMessage: string | null;
}

export type PersistenceBaseline =
  | { readonly status: "unsaved"; readonly updatedAt: null; readonly errorMessage: null }
  | { readonly status: "saved"; readonly updatedAt: number; readonly errorMessage: null }
  | { readonly status: "memory-only"; readonly updatedAt: null; readonly errorMessage: string };
```

```ts
createStudioStore(
  initialProject: Project,
  getAudioEngine: () => AudioEngine | null,
  persistenceBaseline: PersistenceBaseline,
): StoreApi<StudioState>;
```

`StudioState` adds:

```ts
readonly audio: StudioAudioState;
readonly persistence: StudioPersistenceState;
playPause(): Promise<void>;
stopPlayback(): void;
seekPlayback(step: number): void;
refreshAudio(): void;
beginPersistenceSave(): number;
finishPersistenceSave(token: number, result: FlushResult): void;
failPersistenceSave(token: number, message: string): void;
```

- [ ] **Step 1: Add a store-test audio harness**

At the top of `src/stores/studio-store.test.ts`, reuse `FakeAudioContext` and `FakeTimers` from `test/audio-fakes.ts` and add:

```ts
const createAudioHarness = (): {
  readonly engine: AudioEngine;
  readonly context: FakeAudioContext;
  readonly timers: FakeTimers;
} => {
  const context = new FakeAudioContext();
  const timers = new FakeTimers();
  return {
    context,
    timers,
    engine: new AudioEngine({
      createContext: () => context.asAudioContext(),
      loadArrayBuffer: async () => new ArrayBuffer(8),
      setInterval: (callback, milliseconds) => timers.setInterval(callback, milliseconds),
      clearInterval: (handle) => timers.clearInterval(handle),
    }),
  };
};

const createTestStore = (project: Project = EMPTY_PROJECT): StoreApi<StudioState> => {
  const { engine } = createAudioHarness();
  engine.replaceProject(project);
  return createStudioStore(project, () => engine, {
    status: "unsaved", updatedAt: null, errorMessage: null,
  });
};
```

Mechanically replace existing `createStudioStore(project)` calls in this test file with `createTestStore(project)` before adding behavioral tests.

- [ ] **Step 2: Write failing tests for audio controls and history ordering**

Add focused tests:

```ts
it("plays, pauses, seeks, and stops through the audio authority", async () => {
  const harness = createAudioHarness();
  harness.engine.replaceProject(DEMO_PROJECT);
  const store = createStudioStore(DEMO_PROJECT, () => harness.engine, {
    status: "unsaved", updatedAt: null, errorMessage: null,
  });

  await store.getState().playPause();
  expect(store.getState().audio.snapshot.status).toBe("playing");
  await store.getState().playPause();
  expect(store.getState().audio.snapshot.status).toBe("paused");
  store.getState().seekPlayback(16);
  expect(store.getState().audio.snapshot.positionStep).toBe(16);
  store.getState().stopPlayback();
  expect(store.getState().audio.snapshot).toMatchObject({ status: "stopped", positionStep: 0 });
});

it("does not stop audio for unavailable history controls", async () => {
  const harness = createAudioHarness();
  harness.engine.replaceProject(DEMO_PROJECT);
  const store = createStudioStore(DEMO_PROJECT, () => harness.engine, {
    status: "unsaved", updatedAt: null, errorMessage: null,
  });
  await store.getState().playPause();

  store.getState().undo();

  expect(harness.engine.getSnapshot().status).toBe("playing");
});

it("stops audio before undo, redo, and restore publish snapshots", async () => {
  const harness = createAudioHarness();
  harness.engine.replaceProject(DEMO_PROJECT);
  const store = createStudioStore(DEMO_PROJECT, () => harness.engine, {
    status: "unsaved", updatedAt: null, errorMessage: null,
  });
  store.getState().setMasterVolume(-6);
  await store.getState().playPause();

  store.getState().undo();

  expect(harness.engine.getSnapshot()).toMatchObject({ status: "stopped", positionStep: 0 });
  expect(store.getState().project.masterVolumeDb).toBe(-3);
});
```

Repeat the final ordering assertion for redo and for restore to a retained entry. Extend the unavailable-history test with a missing restore target and assert both the engine snapshot and project identity remain unchanged.

- [ ] **Step 3: Run the audio store tests and verify failure**

Run:

```bash
pnpm exec vitest run src/stores/studio-store.test.ts -t "audio authority|history controls|stops audio"
```

Expected: FAIL because the runtime state/actions and new constructor dependency do not exist.

- [ ] **Step 4: Write failing tests for persistence status tokens**

```ts
it("lets only the latest save token publish durability", () => {
  const store = createTestStore();
  const earlier = store.getState().beginPersistenceSave();
  const latest = store.getState().beginPersistenceSave();

  store.getState().failPersistenceSave(earlier, "stale failure");
  expect(store.getState().persistence.status).toBe("saving");
  store.getState().finishPersistenceSave(earlier, { status: "saved", updatedAt: 10 });
  expect(store.getState().persistence.status).toBe("saving");
  store.getState().finishPersistenceSave(latest, { status: "saved", updatedAt: 20 });

  expect(store.getState().persistence).toMatchObject({
    status: "saved", updatedAt: 20, errorMessage: null,
  });
});

it("keeps an actionable failure until a later save succeeds", () => {
  const store = createTestStore();
  const failed = store.getState().beginPersistenceSave();
  store.getState().finishPersistenceSave(failed, {
    status: "failed",
    error: { code: "quota_exceeded", message: "Browser storage is full" },
  });
  expect(store.getState().persistence).toMatchObject({
    status: "failed", errorMessage: "Browser storage is full",
  });

  const retried = store.getState().beginPersistenceSave();
  store.getState().finishPersistenceSave(retried, { status: "saved", updatedAt: 30 });
  expect(store.getState().persistence).toMatchObject({
    status: "saved", updatedAt: 30, errorMessage: null,
  });
});
```

Run:

```bash
pnpm exec vitest run src/stores/studio-store.test.ts -t "save token|later save"
```

Expected: FAIL because persistence projection actions do not exist.

- [ ] **Step 5: Implement the runtime projections and actions**

Import the existing audio/persistence types. Define the initial stopped snapshot from the initial project's arrangement end:

```ts
const initialAudioState = (project: Project): StudioAudioState => ({
  engineReady: false,
  pending: false,
  snapshot: {
    status: "stopped",
    positionStep: 0,
    arrangementEndStep: arrangementEndStep(project),
    unavailableSoundIds: [],
    activeVoices: 0,
    pendingSources: 0,
    lateWakeups: 0,
    trackBusCount: 0,
  },
  errorMessage: null,
});
```

Inside `createStudioStore`, add one local publisher:

```ts
function refreshAudio(): void {
  const engine = getAudioEngine();
  if (engine === null) return;
  set((state) => ({
    audio: {
      ...state.audio,
      engineReady: true,
      snapshot: engine.getSnapshot(),
    },
  }));
}
```

Implement transport results without throwing away the engine message:

```ts
function publishAudioResult(result: AudioControlResult): void {
  const engine = getAudioEngine();
  set((state) => ({
    audio: {
      ...state.audio,
      pending: false,
      snapshot: engine?.getSnapshot() ?? state.audio.snapshot,
      errorMessage: result.ok ? null : result.message,
    },
  }));
}
```

`playPause` pauses immediately when already playing. Otherwise it marks pending, restarts from zero at arrangement end, awaits `engine.play`, catches unexpected errors with the fixed user message `Audio playback failed. Try again or reload.`, and always refreshes the snapshot. `stopPlayback` and `seekPlayback` publish the returned result synchronously.

Before `undo`, `redo`, or `restore`, check availability using current history state. Only an available action calls `engine.stop()` before the existing project-service call and `publish()`.

Initialize persistence in the returned store state as `{ ...persistenceBaseline, latestSaveToken: 0 }`. Implement persistence transitions exactly:

```ts
beginPersistenceSave(): number {
  const token = get().persistence.latestSaveToken + 1;
  set({ persistence: {
    status: "saving", latestSaveToken: token, updatedAt: get().persistence.updatedAt,
    errorMessage: null,
  } });
  return token;
},
finishPersistenceSave(token, result): void {
  if (token !== get().persistence.latestSaveToken || result.status === "idle") return;
  if (result.status === "saved") {
    set({ persistence: {
      status: "saved", latestSaveToken: token, updatedAt: result.updatedAt,
      errorMessage: null,
    } });
    return;
  }
  if (result.status === "failed") {
    set({ persistence: {
      status: "failed", latestSaveToken: token, updatedAt: get().persistence.updatedAt,
      errorMessage: result.error.message,
    } });
    return;
  }
  set({ persistence: {
    status: "unsaved", latestSaveToken: token, updatedAt: null, errorMessage: null,
  } });
},
failPersistenceSave(token, message): void {
  if (token !== get().persistence.latestSaveToken) return;
  set({ persistence: {
    status: "failed", latestSaveToken: token, updatedAt: get().persistence.updatedAt,
    errorMessage: message,
  } });
},
```

- [ ] **Step 6: Run the complete store test file**

Run:

```bash
pnpm exec vitest run src/stores/studio-store.test.ts
```

Expected: PASS, including all pre-existing editing/history tests.

- [ ] **Step 7: Commit the store runtime contract**

```bash
git add src/stores/studio-store.ts src/stores/studio-store.test.ts
git commit -m "feat: add studio runtime state"
```

---

### Task 3: Own Audio Lifecycle and Project Synchronization in the Provider

**Files:**

- Modify: `src/stores/studio-provider.tsx:1-43`
- Modify: `src/components/Studio.test.tsx`

**Interfaces:**

- Consumes: `createStudioStore(initialProject, getAudioEngine, persistenceBaseline)` from Task 2.
- Produces: existing `StudioProvider` and `useStudioStore` APIs plus:

```ts
export function useStudioStoreApi(): StoreApi<StudioState>;
```

- The provider creates a fresh `AudioEngine` during each effect setup so React development effect cleanup never leaves a reused engine closed.

- [ ] **Step 1: Write failing provider lifecycle tests**

In `src/components/Studio.test.tsx`, add a small probe that captures the store API. Use `vi.stubGlobal` for `AudioContext`, `fetch`, `requestAnimationFrame`, and `cancelAnimationFrame`; restore globals after each test.

```tsx
function StoreApiProbe({ onStore }: Readonly<{
  onStore: (store: StoreApi<StudioState>) => void;
}>): null {
  onStore(useStudioStoreApi());
  return null;
}
```

Add tests that prove:

```tsx
it("forwards each changed project identity to the mounted audio engine", () => {
  const project = { ...DEMO_PROJECT, arrangement: [{ ...DEMO_PROJECT.arrangement[0]!, id: "only" }] };
  render(<StudioProvider initialProject={project}><StoreApiProbe onStore={(value) => { store = value; }} /></StudioProvider>);
  expect(store!.getState().audio.snapshot.arrangementEndStep).toBeGreaterThan(0);

  act(() => store!.getState().deleteClip("only"));

  expect(store!.getState().audio.snapshot.arrangementEndStep).toBe(0);
});

it("polls one animation frame while playing and cancels it after pause", async () => {
  render(<StudioProvider initialProject={DEMO_PROJECT}><StoreApiProbe onStore={(value) => { store = value; }} /></StudioProvider>);
  await act(() => store!.getState().playPause());
  expect(requestAnimationFrame).toHaveBeenCalled();

  await act(() => store!.getState().playPause());
  expect(cancelAnimationFrame).toHaveBeenCalled();
});
```

Also retain the captured animation callback and prove that reaching the arrangement end stops scheduling another frame. Unmount a playing provider and assert the outstanding frame is cancelled and the fake audio context reaches `closed`. Use the existing Web Audio fakes rather than inventing an `AudioEngine` interface.

- [ ] **Step 2: Run provider tests and verify failure**

Run:

```bash
pnpm exec vitest run src/components/Studio.test.tsx -t "mounted audio engine|animation frame|arrangement end|unmount"
```

Expected: FAIL because the provider does not own audio or expose the store API.

- [ ] **Step 3: Implement the browser audio adapter**

Keep the adapter private in `studio-provider.tsx`:

```ts
const createBrowserAudioEngine = (): AudioEngine => new AudioEngine({
  createContext: () => new AudioContext(),
  loadArrayBuffer: async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Audio sample request failed with ${response.status}: ${url}`);
    return response.arrayBuffer();
  },
  setInterval: (callback, milliseconds) => window.setInterval(callback, milliseconds),
  clearInterval: (handle) => window.clearInterval(handle as number),
});
```

This constructs no `AudioContext`; the existing engine creates it lazily on preparation.

- [ ] **Step 4: Implement effect-scoped engine ownership**

Keep a provider ref and pass an explicit getter into the store initializer:

```tsx
const audioEngine = useRef<AudioEngine | null>(null);
const [store] = useState(() => createStudioStore(
  initialProject,
  () => audioEngine.current,
  { status: "unsaved", updatedAt: null, errorMessage: null },
));

useEffect(() => {
  const engine = createBrowserAudioEngine();
  audioEngine.current = engine;
  engine.replaceProject(store.getState().project);
  store.getState().refreshAudio();

  let frame: number | null = null;
  const cancelFrame = (): void => {
    if (frame === null) return;
    cancelAnimationFrame(frame);
    frame = null;
  };
  const poll = (): void => {
    frame = null;
    store.getState().refreshAudio();
    if (store.getState().audio.snapshot.status === "playing") {
      frame = requestAnimationFrame(poll);
    }
  };
  const startFrame = (): void => {
    if (frame === null) frame = requestAnimationFrame(poll);
  };

  const unsubscribe = store.subscribe((state, previous) => {
    if (state.project !== previous.project) {
      engine.replaceProject(state.project);
      state.refreshAudio();
    }
    if (state.audio.snapshot.status === "playing"
      && previous.audio.snapshot.status !== "playing") startFrame();
    if (state.audio.snapshot.status !== "playing"
      && previous.audio.snapshot.status === "playing") cancelFrame();
  });

  return () => {
    unsubscribe();
    cancelFrame();
    if (audioEngine.current === engine) audioEngine.current = null;
    void engine.dispose();
  };
}, [store]);
```

Creating the engine inside effect setup is required: React development mode may run setup, cleanup, then setup again while retaining state. Reusing a state-created engine would leave the second setup permanently closed.

- [ ] **Step 5: Export the store API hook**

```ts
export function useStudioStoreApi(): StoreApi<StudioState> {
  const store = useContext(StudioContext);
  if (store === null) throw new Error("Studio state requires a StudioProvider. Mount the component inside Studio.");
  return store;
}
```

Make `useStudioStore` call this hook so the missing-provider error remains defined once.

- [ ] **Step 6: Run provider and existing UI tests**

Run:

```bash
pnpm exec vitest run src/components/Studio.test.tsx src/components/arrangement/Arrangement.test.tsx
```

Expected: PASS. The existing “does not initialize audio” test must still prove that panel interaction calls neither `AudioContext` nor `fetch`.

- [ ] **Step 7: Commit provider orchestration**

```bash
git add src/stores/studio-provider.tsx src/components/Studio.test.tsx
git commit -m "feat: synchronize studio audio runtime"
```

---

### Task 4: Wire the Transport UI

**Files:**

- Modify: `src/components/Transport.tsx:1-47`
- Modify: `src/components/Studio.tsx:13-45`
- Modify: `src/components/Studio.test.tsx`

**Interfaces:**

- Consumes: `audio`, `persistence`, `playPause`, and `stopPlayback` from `StudioState`.
- Produces: enabled Play/Pause and Stop controls, real elapsed position, and separate service messages.

- [ ] **Step 1: Write failing transport behavior tests**

Add a `renderSession(project)` helper that mounts `StudioProvider`, `StudioSession`, and the existing store probe. Replace existing direct `Studio` mounts for synchronous editor tests in `Studio.test.tsx` and `ArrangementGestures.test.tsx`; leave `src/app/page.test.tsx` unchanged until Task 6. Then add:

```tsx
it("plays, pauses, and stops from the transport", async () => {
  const user = userEvent.setup();
  renderSession(DEMO_PROJECT);

  await user.click(screen.getByRole("button", { name: "Play" }));
  expect(screen.getByRole("button", { name: "Pause" })).toBeEnabled();

  await user.click(screen.getByRole("button", { name: "Pause" }));
  expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();

  await user.click(screen.getByRole("button", { name: "Stop" }));
  expect(screen.getByLabelText("Playback position")).toHaveTextContent("0:00.0");
});

it("keeps audio and persistence failures separate from edit errors", () => {
  renderSession(DEMO_PROJECT);
  act(() => {
    const token = store!.getState().beginPersistenceSave();
    store!.getState().failPersistenceSave(token, "Browser storage is unavailable");
  });
  expect(screen.getByText("Browser storage is unavailable")).toBeVisible();
});
```

Add a Play-at-end test by seeking to `audio.snapshot.arrangementEndStep`, pressing Play, and asserting the engine-backed position returns to zero before entering playing status.

Add focused boundary tests using the existing Web Audio fakes:

- Empty arrangement: Play remains stopped and the audio alert says to add a clip.
- Suspended context whose `resume()` does not enter `running`: transport shows the blocked retry message while editing remains enabled.
- One failed sample request: playback enters `playing`, the unavailable sound appears in a degraded warning, and other sounds continue.
- Closed context: controls become disabled and the audio alert requests a reload.
- Unexpected `resume()` rejection: the pending presentation clears and the fixed retry/reload audio message appears.

- [ ] **Step 2: Run transport tests and verify failure**

Run:

```bash
pnpm exec vitest run src/components/Studio.test.tsx -t "transport|Play-at-end|empty arrangement|blocked|degraded|closed context|unexpected resume|failures separate"
```

Expected: FAIL because transport controls remain disabled and status is static.

- [ ] **Step 3: Implement real transport presentation**

Add a local pure time formatter:

```ts
const formatPosition = (step: number, bpm: number): string => {
  const seconds = step * 60 / bpm / 4;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
};
```

Replace static controls with state-backed controls:

```tsx
<button
  type="button"
  aria-label={audio.snapshot.status === "playing" ? "Pause" : "Play"}
  disabled={!audio.engineReady || audio.pending}
  onClick={() => { void playPause(); }}
>
  <TransportIcon name={audio.snapshot.status === "playing" ? "pause" : "play"} />
</button>
<button
  type="button"
  aria-label="Stop"
  disabled={!audio.engineReady
    || (audio.snapshot.status === "stopped" && audio.snapshot.positionStep === 0)}
  onClick={stopPlayback}
>
  <TransportIcon name="stop" />
</button>
```

Label the position `Playback position`, render `formatPosition`, and derive concise subtitle text from the audio and persistence projections. Keep Record, Loop, Export, and visual meter spans disabled/static.

- [ ] **Step 4: Render independent service alerts**

Export `StudioSession` for direct test mounting. In its shell, retain the edit alert and add separate alerts only when their messages are non-null:

```tsx
{errorMessage && <p role="alert">{errorMessage}</p>}
{audio.errorMessage && <p role="alert">Audio: {audio.errorMessage}</p>}
{persistence.errorMessage && <p role="alert">Storage: {persistence.errorMessage}</p>}
```

Use the existing alert classes so integration does not redesign the workstation.

- [ ] **Step 5: Run the complete Studio test file**

Run:

```bash
pnpm exec vitest run src/components/Studio.test.tsx
```

Expected: PASS, including history, mixer, editor, and audio-laziness regressions.

- [ ] **Step 6: Commit transport wiring**

```bash
git add src/components/Transport.tsx src/components/Studio.tsx src/components/Studio.test.tsx
git commit -m "feat: connect studio transport"
```

---

### Task 5: Make the Audio Engine the Playhead Authority

**Files:**

- Modify: `src/components/arrangement/Arrangement.tsx:28-163`
- Modify: `src/components/arrangement/Arrangement.test.tsx`

**Interfaces:**

- Consumes: `audio.snapshot.positionStep`, `audio.snapshot.arrangementEndStep`, and `seekPlayback(step)`.
- Produces: fractional playback rendering, integer seek previews, one release-time seek, and whole-step keyboard seeks.

- [ ] **Step 1: Replace local-authority tests with failing engine-authority tests**

Capture the store API in the arrangement test harness, then add:

```tsx
it("renders the engine position and clamps seeking to arrangement content", () => {
  const playhead = screen.getByRole("slider", { name: "Playhead" });
  const arrangement = screen.getByRole("region", { name: "Song arrangement" });
  vi.spyOn(arrangement, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1754, 650));

  act(() => store.getState().seekPlayback(32));
  expect(playhead).toHaveAttribute("aria-valuenow", "32");

  fireEvent.pointerDown(playhead, { pointerId: 2, button: 0, clientX: 354 });
  fireEvent.pointerMove(playhead, { pointerId: 2, clientX: 5000 });
  fireEvent.pointerUp(playhead, { pointerId: 2, clientX: 5000 });
  expect(playhead).toHaveAttribute(
    "aria-valuenow",
    String(store.getState().audio.snapshot.arrangementEndStep),
  );
});

it("previews pointer movement but seeks the engine once on release", () => {
  const playhead = screen.getByRole("slider", { name: "Playhead" });
  const arrangement = screen.getByRole("region", { name: "Song arrangement" });
  vi.spyOn(arrangement, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1754, 650));
  const committedBeforeDrag = store.getState().audio.snapshot.positionStep;
  fireEvent.pointerDown(playhead, { pointerId: 3, button: 0, clientX: 154 });
  fireEvent.pointerMove(playhead, { pointerId: 3, clientX: 254 });
  fireEvent.pointerMove(playhead, { pointerId: 3, clientX: 354 });
  const previewStep = Number(playhead.getAttribute("aria-valuenow"));
  expect(previewStep).not.toBe(committedBeforeDrag);
  expect(store.getState().audio.snapshot.positionStep).toBe(committedBeforeDrag);
  fireEvent.pointerUp(playhead, { pointerId: 3, clientX: 354 });
  expect(store.getState().audio.snapshot.positionStep).toBe(previewStep);
});
```

Retain existing scroll-coordinate and keyboard accessibility coverage, but change their expected authority from local component state to the store action.

- [ ] **Step 2: Run arrangement tests and verify failure**

Run:

```bash
pnpm exec vitest run src/components/arrangement/Arrangement.test.tsx
```

Expected: FAIL because the playhead is still component-local and clamps to visible buffer bars.

- [ ] **Step 3: Implement engine position plus local preview**

Replace local `playheadStep` with:

```ts
const audio = useStudioStore((state) => state.audio);
const seekPlayback = useStudioStore((state) => state.seekPlayback);
const [seekPreviewStep, setSeekPreviewStep] = useState<number | null>(null);
const transportEndStep = audio.snapshot.arrangementEndStep;
const displayedStep = Math.min(
  seekPreviewStep ?? audio.snapshot.positionStep,
  transportEndStep,
);
```

Keep arrangement width based on clips plus editing buffer. Change playhead target clamping and accessibility maximum to `transportEndStep`. Floor the step passed to `playheadLabel` so continuous playback never announces a fractional sixteenth label.

During pointer movement, update only `seekPreviewStep`. On pointer release, compute the final target from the release coordinates, clear preview, and call `seekPlayback(target)` once. On cancellation or lost capture, clear preview without seeking. Arrow keys call `seekPlayback` with a clamped whole-step target.

- [ ] **Step 4: Run arrangement and gesture regression tests**

Run:

```bash
pnpm exec vitest run src/components/arrangement/Arrangement.test.tsx src/components/arrangement/ArrangementGestures.test.tsx
```

Expected: PASS. Clip and track gestures remain independent from transport seeking.

- [ ] **Step 5: Commit playhead ownership**

```bash
git add src/components/arrangement/Arrangement.tsx src/components/arrangement/Arrangement.test.tsx
git commit -m "feat: synchronize arrangement playhead"
```

---

### Task 6: Bootstrap Persistence and Autosave the Mounted Session

**Files:**

- Modify: `src/components/Studio.tsx:1-50`
- Modify: `src/stores/studio-provider.tsx`
- Modify: `src/components/Studio.test.tsx`
- Modify: `src/components/arrangement/ArrangementGestures.test.tsx`
- Modify: `src/app/page.test.tsx`

**Interfaces:**

- Consumes: `ProjectPersistenceService`, `DEMO_PROJECT` passed as `initialProject`, the provider's existing audio lifecycle, and Task 2 persistence actions.
- Produces this provider input and internal startup states:

```ts
export interface StudioPersistenceSession {
  readonly service: ProjectPersistenceService | null;
  readonly baseline: PersistenceBaseline;
}

type StartupState =
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly project: Project;
      readonly persistenceSession: StudioPersistenceSession;
    }
  | {
      readonly kind: "recovery";
      readonly service: ProjectPersistenceService;
      readonly errorMessage: string;
      readonly clearing: boolean;
    };
```

- `Studio({ initialProject })` retains its existing external prop; `initialProject` becomes the empty/failure fallback.
- `StudioSession` is exported for synchronous component/gesture tests.
- `StudioProvider` gains a required `persistenceSession` prop. Direct unit mounts pass a null service with an unsaved baseline; production passes the live service and resolved baseline.

- [ ] **Step 1: Update direct provider mounts with an explicit test persistence session**

Task 4 already moved synchronous editor tests to a direct session harness. Add this local constant to each test file that mounts `StudioProvider`:

```ts
const TEST_PERSISTENCE_SESSION: StudioPersistenceSession = {
  service: null,
  baseline: { status: "unsaved", updatedAt: null, errorMessage: null },
};
```

Pass it explicitly to every direct provider mount. Bootstrap tests continue to render `Studio` itself.

- [ ] **Step 2: Write failing bootstrap and recovery tests**

Use a fresh `IDBFactory` for each test. Add local `indexedDBWithProject` and `indexedDBWithRawRecord` helpers beside these Vitest tests, copying only the small open/put/transaction-completion sequence from `test/persistence.test.ts`. Cover:

```tsx
it("shows loading before mounting a loaded project", async () => {
  const indexedDB = await indexedDBWithProject(savedProject);
  vi.stubGlobal("indexedDB", indexedDB);
  render(<Studio initialProject={DEMO_PROJECT} />);
  expect(screen.getByRole("status", { name: "Loading project" })).toBeVisible();
  expect(await screen.findByText(savedProject.name)).toBeVisible();
});

it("opens the unsaved demo when storage is empty", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  render(<Studio initialProject={DEMO_PROJECT} />);
  expect(await screen.findByText(DEMO_PROJECT.name)).toBeVisible();
  expect(screen.getByText(/Not saved yet/)).toBeVisible();
});

it("blocks editing until corrupt storage is explicitly cleared", async () => {
  const indexedDB = await indexedDBWithRawRecord({ project: { broken: true }, updatedAt: 1 });
  vi.stubGlobal("indexedDB", indexedDB);
  const user = userEvent.setup();
  render(<Studio initialProject={DEMO_PROJECT} />);

  expect(await screen.findByRole("alert")).toHaveTextContent(/cannot be loaded/i);
  expect(screen.queryByRole("region", { name: "Song arrangement" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Clear stored project" }));
  expect(await screen.findByRole("region", { name: "Song arrangement" })).toBeVisible();
});
```

Also cover unsupported schema, clear failure, and a non-recovery storage failure that mounts the demo with a memory-only warning.

- [ ] **Step 3: Run bootstrap tests and verify failure**

Run:

```bash
pnpm exec vitest run src/components/Studio.test.tsx -t "loading|unsaved demo|corrupt storage|unsupported schema|memory-only"
```

Expected: FAIL because `Studio` still constructs the provider synchronously and has no recovery UI.

- [ ] **Step 4: Implement client startup**

Create one persistence service in `Studio` state only when `globalThis.indexedDB` exists, using `debounceMs: 500`. If IndexedDB is absent, mount the fallback immediately with a null service and a memory-only warning. Otherwise, call `load()` in an effect and map results with the same service:

```ts
const startupFor = (
  result: LoadResult,
  fallback: Project,
  service: ProjectPersistenceService,
): StartupState => {
  if (result.status === "loaded") {
    return {
      kind: "ready",
      project: result.project,
      persistenceSession: {
        service,
        baseline: { status: "saved", updatedAt: result.updatedAt, errorMessage: null },
      },
    };
  }
  if (result.status === "empty") {
    return {
      kind: "ready",
      project: fallback,
      persistenceSession: {
        service,
        baseline: { status: "unsaved", updatedAt: null, errorMessage: null },
      },
    };
  }
  if (result.error.code === "corrupt_record" || result.error.code === "unsupported_schema") {
    return { kind: "recovery", service, errorMessage: result.error.message, clearing: false };
  }
  return {
    kind: "ready",
    project: fallback,
    persistenceSession: {
      service,
      baseline: {
        status: "memory-only", updatedAt: null, errorMessage: result.error.message,
      },
    },
  };
};
```

Use an effect-local active flag so a late load cannot update an unmounted component. Loading renders an accessible status. Recovery renders the sanitized message and one Clear button. A successful clear reuses the service and mounts the fallback with an `unsaved` baseline; failed clear remains blocking and displays the returned error.

- [ ] **Step 5: Write failing autosave and visibility tests**

Add production-path tests that await the bootstrapped editor, perform a project edit, and inspect stored data after flush:

```tsx
it("autosaves every changed project identity and ignores no-op publication", async () => {
  const indexedDB = new IDBFactory();
  vi.stubGlobal("indexedDB", indexedDB);
  const user = userEvent.setup();
  render(<Studio initialProject={DEMO_PROJECT} />);
  await screen.findByRole("region", { name: "Song arrangement" });

  await user.click(screen.getByRole("button", { name: "Mixer" }));
  const masterVolume = screen.getByRole("spinbutton", { name: "Master volume value" });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");

  fireEvent.change(masterVolume, { target: { value: String(DEMO_PROJECT.masterVolumeDb) } });
  fireEvent.keyDown(masterVolume, { key: "Enter" });
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  const afterNoOp = await new ProjectPersistenceService({ indexedDB, debounceMs: 0 }).load();
  expect(afterNoOp.status).toBe("empty");

  fireEvent.change(masterVolume, {
    target: { value: "-6" },
  });
  fireEvent.keyDown(masterVolume, { key: "Enter" });

  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(await screen.findByText(/Saved locally/)).toBeVisible();
  const loaded = await new ProjectPersistenceService({ indexedDB, debounceMs: 0 }).load();
  expect(loaded.status === "loaded" ? loaded.project.masterVolumeDb : null).toBe(-6);
});
```

Stub `document.visibilityState` as `hidden` before dispatching the event. Before the real `-6` edit, submit the existing master value and flush once; assert storage remains empty to prove a no-op project publication is ignored. Task 2 already covers out-of-order completion with save tokens.

- [ ] **Step 6: Extend the provider's single project subscription with persistence**

Change `StudioProvider` to require `persistenceSession` and pass its baseline into `createStudioStore` instead of the Task 3 hard-coded unsaved baseline. Extend the existing provider effect and its existing subscription; do not add a second project subscriber or a bridge component:

```tsx
const { service } = persistenceSession;
const failUnexpectedSave = (token: number, error: unknown): void => {
  console.error("Project persistence failed unexpectedly", error);
  store.getState().failPersistenceSave(
    token,
    "Project could not be saved in browser storage. Keep this page open and try another edit.",
  );
};

const scheduleSave = (state: StudioState): void => {
  if (service === null) return;
  const token = state.beginPersistenceSave();
  let scheduled: Promise<SaveResult>;
  try {
    scheduled = service.scheduleSave(state.project);
  } catch (error: unknown) {
    failUnexpectedSave(token, error);
    return;
  }
  void scheduled.then(
    (result) => store.getState().finishPersistenceSave(token, result),
    (error: unknown) => failUnexpectedSave(token, error),
  );
};

const unsubscribe = store.subscribe((state, previous) => {
  if (state.project !== previous.project) {
    engine.replaceProject(state.project);
    state.refreshAudio();
    scheduleSave(state);
  }

  if (state.audio.snapshot.status === "playing"
    && previous.audio.snapshot.status !== "playing") startFrame();
  if (state.audio.snapshot.status !== "playing"
    && previous.audio.snapshot.status === "playing") cancelFrame();
});

const flushWhenHidden = (): void => {
  if (service === null || document.visibilityState !== "hidden") return;
  const token = store.getState().persistence.latestSaveToken;
  void service.flush().then(
    (result) => store.getState().finishPersistenceSave(token, result),
    (error: unknown) => failUnexpectedSave(token, error),
  );
};
document.addEventListener("visibilitychange", flushWhenHidden);
```

Preserve the Task 3 cleanup and add removal of the visibility listener:

```tsx
return () => {
  unsubscribe();
  document.removeEventListener("visibilitychange", flushWhenHidden);
  cancelFrame();
  if (audioEngine.current === engine) audioEngine.current = null;
  void engine.dispose();
};
```

The completed effect has exactly one `store.subscribe` call. Audio replacement remains synchronous; saves remain asynchronous and never roll back the in-memory project. Render `StudioProvider` with the ready state's persistence session and `StudioSession` as its child. Do not schedule the initial fallback or loaded project.

- [ ] **Step 7: Update page and bootstrap tests**

Make `src/app/page.test.tsx` asynchronous and await the workstation after the empty IndexedDB load. Give each bootstrap test a fresh `IDBFactory` so the fixed database name cannot leak projects between tests.

Run:

```bash
pnpm exec vitest run src/components/Studio.test.tsx src/app/page.test.tsx src/components/arrangement/ArrangementGestures.test.tsx
```

Expected: PASS for startup, autosave, recovery, page rendering, and all existing editor gestures.

- [ ] **Step 8: Commit persistence integration**

```bash
git add src/components/Studio.tsx src/stores/studio-provider.tsx src/components/Studio.test.tsx src/components/arrangement/ArrangementGestures.test.tsx src/app/page.test.tsx
git commit -m "feat: bootstrap and persist studio projects"
```

---

### Task 7: Complete Cross-System Verification

**Files:**

- Modify only files required by failures found in this task.

**Interfaces:**

- Consumes: the complete integration from Tasks 1-6.
- Produces: a clean, tested, production-buildable branch with no unrelated diff.

- [ ] **Step 1: Run the full automated suite**

```bash
pnpm test
```

Expected: all Node and Vitest tests PASS.

- [ ] **Step 2: Run static verification**

```bash
pnpm run typecheck
pnpm run lint
pnpm run build
```

Expected: all commands exit 0 with no new warning attributable to the integration.

- [ ] **Step 3: Inspect the complete diff**

```bash
git status --short
git diff --check
git log --oneline -6
git diff HEAD~6..HEAD -- src test
```

Expected: the six task commits are present, only source/test files named in this plan changed, no whitespace errors exist, and no package dependency changed.

- [ ] **Step 4: Run a real-browser playback check**

```bash
pnpm dev
```

Verify in the browser:

1. Loading resolves to the demo on clean storage.
2. Opening panels does not create `AudioContext` or fetch samples.
3. First Play produces audible drums and synths; Pause retains position; Stop resets to zero.
4. Dragging the playhead previews silently and seeks once on release.
5. Mixer changes affect current audio without restarting playback.
6. A composition edit reschedules from the current position.
7. Undo stops playback and restores project state.
8. Record, Loop, Export, and meters remain inactive.

Expected: all eight behaviors match the approved spec with no uncaught console error.

- [ ] **Step 5: Run browser persistence and recovery checks**

1. Edit the project and wait for `Saved locally`.
2. Reload and verify project content returns while Activity history is empty.
3. Edit, hide the document before 500 ms, return, and verify the latest snapshot loads after reload.
4. Insert a malformed record through browser developer tools, reload, and verify the editor is blocked.
5. Clear the stored project through recovery UI and verify the unsaved demo opens.

Expected: the last durable record is preserved on failure, and no corrupt record is overwritten before explicit clear.

- [ ] **Step 6: Commit only if verification required a fix**

If Step 1-5 required code changes, repeat the focused failing test first, then the full checks, and commit the minimal fix:

```bash
git add src/persistence/decode.ts src/persistence/service.ts test/persistence.test.ts \
  src/stores/studio-store.ts src/stores/studio-store.test.ts src/stores/studio-provider.tsx \
  src/components/Transport.tsx src/components/Studio.tsx src/components/Studio.test.tsx \
  src/components/arrangement/Arrangement.tsx src/components/arrangement/Arrangement.test.tsx \
  src/components/arrangement/ArrangementGestures.test.tsx src/app/page.test.tsx
git commit -m "fix: complete studio service integration"
```

If no fix was required, leave the worktree clean and create no empty commit.
