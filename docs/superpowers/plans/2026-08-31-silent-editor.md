# Silent Editor UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing DAW prototype into a silent, undoable editor with independent reusable patterns, track-routed clips, real pattern editors, and controlled mixer interactions.

**Architecture:** Keep `ProjectService` as the owner of committed project/history state. A per-workstation Zustand store publishes service snapshots and owns selection; typed UI actions check affected musical constraints before dispatch. Gesture previews stay local and commit once.

**Tech Stack:** Strict TypeScript, React 19, Next.js 16, Tailwind 4, Zustand 5, Node's test runner, Vitest, Testing Library, pnpm 10.17.0.

**Spec:** [Silent editor UI design](../specs/2026-08-31-silent-editor-design.md). Read both documents before implementing.

## Global Constraints

- Use Node.js >=23.6 and pnpm 10.17.0; retain `pnpm-lock.yaml` as the only package-manager lockfile.
- Use the existing React, Next.js, Tailwind, Zustand, and test tooling; add no dependencies without explicit approval.
- Keep the current desktop layout and visual language; this milestone changes interactions, not the overall design.
- Route committed musical edits through `ProjectService`; do not create a second editable project or history implementation.
- Trust typed internal callers; do not add generic `isRecord`, `assertRecord`, checked-getter, or command-schema infrastructure, or repeated whole-project runtime validation.
- Check concrete musical constraints once at the UI editing boundary; decode unknown persisted data only at a persistence boundary.
- Keep this milestone silent: no playback, recording, export, or audible note preview.
- Work test-first in small functional slices, with human review before proceeding to the next slice.

## Execution Contract

This is documentation of approved scope, not a claim that these features are implemented. The existing `codex/silent-editor` worktree starts at `b3a3463`; keep the pnpm migration on `main` separate. Do not create another worktree, merge persistence, install dependencies, push, or begin implementing merely because this plan exists.

When implementation is requested, use the existing worktree and perform each slice as red test → minimal implementation → focused tests → typecheck/lint → diff review → local commit → human review. Stop after each functional slice for that review. Read applicable repository instructions and skills at execution time; do not infer permission for delegation or external changes from this document.

The audio routing update is deliberately in the first schema slice, rather than at the end: otherwise existing engine consumers and fixtures would stop compiling. This is a dependency-order adjustment, not playback scope expansion.

### Current checkpoint — 2026-08-31

Task 1 was accepted and Tasks 2–4 were grouped inline into the next user-testable UI checkpoint. Track creation, rename, preset changes, drag/Move up/Move down reordering, and deletion now use real project history and Undo/Redo. Native dialogs confirm clip-affecting deletion; patterns remain reusable. Browser checks cover actual drag capture, one-entry history, deletion warnings, and focus restoration. Track dialogs live in `TrackControls.tsx`; pointer tests were added in `Arrangement.test.tsx` ahead of Task 6.

Tasks 5–10 remain pending. Clips and pattern events currently render real project content but are not editable; mixer values are real but adjustment controls remain disabled. There is no audio or persistence, and refreshing resets this demo session. The existing desktop minimum width is unchanged. Review this checkpoint before starting Task 5.

Verification: 132 tests pass (106 domain/audio/migration, 26 UI), along with typechecking, lint, production build, and diff checks. The browser has no new errors since the clean reload. No dependencies, generic runtime validation infrastructure, or main-branch changes were added.

## File Map

Paths below are relative to the `silent-editor` worktree. Existing files stay in place; new files have concrete responsibilities, not placeholder abstractions.

| Files | Responsibility |
| --- | --- |
| `src/project/model.ts`, `commands.ts`, `reducer.ts`, `index.ts` | Schema 2, track reorder, clip routing, deletion semantics. |
| New `src/project/migration.ts` | Typed version-1-to-2 conversion only. |
| `src/audio/timeline.ts`, `test/audio-*.ts`, `test/project.test.ts` | Existing consumer compatibility and domain regression tests. |
| `src/stores/studio-store.ts`, new `studio-provider.tsx` | One service/store per mounted editor; typed UI actions, published snapshots, selection. |
| New `src/stores/studio-edits.ts`, `studio-edits.test.ts` | Shared placement, pattern-length, and drum-kit musical checks; no generic schema machinery. |
| `src/types/studio.ts`, `src/data/studio-data.ts` | UI-only types/labels/colors and explicit `EMPTY_PROJECT` / `DEMO_PROJECT`; remove duplicate song models. |
| `src/components/Studio.tsx`, `src/app/page.tsx` | Mount isolated editor state; pass initial domain project explicitly. |
| Existing `src/components/arrangement/*.tsx` | Track controls, bar geometry, clip actions and gestures. |
| Existing `src/components/editor/*.tsx` | Library, editor shell, mixer. |
| New `src/components/editor/DrumGrid.tsx`, `PianoRoll.tsx` | Kind-specific event editing and local gesture state. |
| Existing `src/components/Transport.tsx`, `ActivityPanel.tsx` | Real history, silent/session status, no simulated activity. |
| Colocated `*.test.ts(x)` | Focused store/component tests using existing tooling. |

Keep catalog IDs in `src/audio/catalog.ts` authoritative. Keep literal sixteenth/bar geometry close to the relevant surface; extract geometry helpers only when both interaction code and tests need the same calculation. No drag library, state framework, generic transaction engine, or custom form system is needed.

## Task 1: Migrate Ownership and Existing Audio Consumers

Status: Implemented inline on 2026-08-31 and accepted for continued UI work. At that checkpoint all 115 tests (104 domain/audio/migration and 11 UI), typechecking, lint, and production build passed. That slice did not change UI or persistence integration, and added no dependencies or generic runtime validators. The legacy type reuses unchanged model fields; freeze those fields separately if a future schema changes them.

**Files:** Modify `src/project/model.ts`, `commands.ts`, `reducer.ts`, `index.ts`, `src/audio/timeline.ts`, `test/project.test.ts`, `test/audio-fixtures.ts`, `test/audio-timeline.test.ts`, and other audio tests with inline project fixtures. Create `src/project/migration.ts` and `test/project-migration.test.ts`.

**Interfaces:** `Project.schemaVersion` becomes `2`; `Pattern` loses `trackId`; `ArrangementClip` gains `readonly trackId: string`; `arrangement.update.changes` gains optional `trackId`. Export `ProjectV1` and `migrateProject(project: ProjectV1 | Project): Project` from the project package. Existing service method signatures stay unchanged.

- [x] Write the ownership regression first in `test/project.test.ts`, using its existing fixture helpers after migrating those helpers to schema 2:

```ts
test("track deletion preserves shared patterns and other-track clips", () => {
  const original = projectWithBasicDrums();
  const project: Project = {
    ...original,
    tracks: [...original.tracks, { ...basicDrumTrack(), id: id(30) }],
    arrangement: [
      ...original.arrangement,
      { id: id(31), patternId: id(11), trackId: id(30), startBar: 0, repeatCount: 1 },
    ],
  };
  const result = reduceOperation(project, { type: "track.delete", trackId: id(10) });
  assert.deepEqual(result.project.patterns, project.patterns);
  assert.deepEqual(result.project.arrangement.map((clip) => clip.id), [id(31)]);
  assert.deepEqual(result.changes.deleted.patternIds, []);
  assert.deepEqual(result.changes.deleted.drumHitIds, []);
});
```

- [x] Run `node --disable-warning=ExperimentalWarning --test --test-name-pattern="track deletion preserves" test/project.test.ts`. Expect a failing retention assertion before changing reducer behavior.
- [x] Change the model and explicit clip field-copying paths; remove only the obsolete ownership cascade from `track.delete`. Its deleted summary contains the track and that track's clips, not patterns/events. Keep `pattern.delete` cascading through all referencing clips. Verify changing `arrangement.update.trackId` preserves the pattern ID and content.
- [x] Add migration tests for placed/unplaced drum and synth patterns, multiple clips sharing one old pattern, stable IDs/events/mix/order, input immutability, version-2 pass-through, and a dangling legacy clip reference. A representative assertion uses a literal legacy fixture, not a schema-2 cast:

```ts
const legacy: ProjectV1 = {
  schemaVersion: 1, id: "project", name: "Old song", bpm: 120, masterVolumeDb: -3,
  tracks: [{ id: "drums", name: "Drums", kind: "drum", instrumentId: "kit.basic",
    volumeDb: -6, pan: 0, muted: false, soloed: false }],
  patterns: [{ id: "beat", trackId: "drums", name: "Beat", kind: "drum",
    lengthBars: 1, events: [{ id: "kick", soundId: "kick", startStep: 0 }] }],
  arrangement: [{ id: "clip", patternId: "beat", startBar: 2, repeatCount: 3 }],
};
test("migration moves track ownership without changing the legacy project", () => {
  const before = structuredClone(legacy);
  const converted = migrateProject(legacy);
  assert.equal(converted.schemaVersion, 2);
  assert.equal(converted.arrangement[0]?.trackId, "drums");
  assert.equal("trackId" in converted.patterns[0]!, false);
  assert.deepEqual(converted.patterns[0]?.events, legacy.patterns[0]?.events);
  assert.deepEqual(legacy, before);
  assert.equal(migrateProject(converted), converted);
});
```

- [x] Run `node --disable-warning=ExperimentalWarning --test test/project-migration.test.ts` and confirm the new converter tests fail before implementation. Define `ProjectV1` with the old schema literal, old pattern ownership, and clips without `trackId`; freeze that contract when future schema changes occur. Implement only the typed conversion:

```ts
export function migrateProject(project: ProjectV1 | Project): Project {
  if (project.schemaVersion === 2) return project;
  return {
    ...project,
    schemaVersion: 2,
    patterns: project.patterns.map((pattern): Pattern => pattern.kind === "drum"
      ? { id: pattern.id, name: pattern.name, kind: "drum",
          lengthBars: pattern.lengthBars, events: pattern.events }
      : { id: pattern.id, name: pattern.name, kind: "synth",
          lengthBars: pattern.lengthBars, events: pattern.events }),
    arrangement: project.arrangement.map((clip) => {
      const pattern = project.patterns.find((candidate) => candidate.id === clip.patternId);
      if (pattern === undefined) {
        throw new RangeError(`Cannot migrate clip ${clip.id}: pattern ${clip.patternId} is missing`);
      }
      return { ...clip, trackId: pattern.trackId };
    }),
  };
}
```

Import model types at the top; do not introduce a general object-omission utility. This converter accepts typed data, not `unknown`; external decoding is a separate boundary.

- [x] Write an audio regression placing the same synth pattern on bass and lead tracks at the same bar. Assert two events with distinct clip-based keys, the respective track IDs and instrument IDs, and unchanged pitch/timing. Update the missing-track diagnostic test to reference the clip's missing track.
- [x] Run `node --disable-warning=ExperimentalWarning --test test/audio-timeline.test.ts` to observe the routing failure, then change the track lookup to `tracks.get(clip.trackId)` and the diagnostic to “Arrangement clip references a missing track.” Do not initialize an engine from the UI.
- [x] Run `pnpm test`, `pnpm typecheck`, and `pnpm lint`; search `rg -n 'pattern\.trackId|schemaVersion: 1' src test` and ensure only intentional legacy conversion/tests remain. Review `git diff --check` and `git diff`, commit as `feat: decouple patterns from tracks`, and request human review.

## Task 2: Add Undoable Track Reordering

**Files:** Modify `src/project/commands.ts`, `reducer.ts`, and `test/project.test.ts`.

**Interfaces:** Add `{ readonly type: "track.reorder"; readonly trackId: string; readonly toIndex: number }` to `Operation`. `toIndex` is the final zero-based index. Typed internal callers supply a valid track/index; UI checks arrive with track controls.

- [x] Add the service-level test below, plus first-to-last, last-to-first, unchanged-index no-op, unchanged clip routing, and restore-after-reorder cases:

```ts
test("track reorder is one undoable project-order change", () => {
  const initial = projectWithBassAndDrums();
  const service = createTestService(initial);
  const result = service.dispatch({
    id: id(500), source: "manual", label: "Move Bass up", kind: "operation",
    operation: { type: "track.reorder", trackId: id(20), toIndex: 0 },
  });
  assert.deepEqual(result.project.tracks.map((track) => track.id), [id(20), id(10)]);
  assert.deepEqual(result.changes.updated.projectIds, [initial.id]);
  assert.deepEqual(result.project.arrangement, initial.arrangement);
  assert.equal(service.getState().history.length, 1);
  service.undo();
  assert.deepEqual(service.getState().project.tracks, initial.tracks);
  service.redo();
  assert.equal(service.getState().project.tracks[0]?.id, id(20));
});
```

- [x] Run `node --disable-warning=ExperimentalWarning --test --test-name-pattern="track reorder" test/project.test.ts`; expect the unsupported operation to fail.
- [x] Implement a local array move in the reducer, returning the original project for unchanged order. Do not mutate the input or add position fields to tracks:

```ts
const fromIndex = project.tracks.findIndex((track) => track.id === operation.trackId);
if (fromIndex === operation.toIndex) return { project, changes: emptyChangeSummary() };
const tracks = [...project.tracks];
const [moved] = tracks.splice(fromIndex, 1);
tracks.splice(operation.toIndex, 0, moved!);
const candidate: Project = { ...project, tracks };
return { project: candidate, changes: summarizeProjectDiff(project, candidate) };
```

Order is a project-level change; unchanged track objects need not be falsely reported as edited. The existing snapshot mechanism handles undo/redo/restore.

- [x] Run `pnpm run test:project`, `pnpm typecheck`, and `pnpm lint`; inspect the diff, commit as `feat: add track reordering`, and request human review.

## Task 3: Connect the UI to One Project-Service Session

**Files:** Modify `src/stores/studio-store.ts`, its test, `src/types/studio.ts`, `src/data/studio-data.ts`, `src/components/Studio.tsx`, all existing musical fixture consumers under `src/components/`, `src/app/page.tsx`, `src/app/page.test.tsx`, and `src/components/Studio.test.tsx`. Create `src/stores/studio-provider.tsx`.

**Interfaces:** Export `createStudioStore(initialProject: Project): StoreApi<StudioState>` from `studio-store.ts`, using `createStore` from `zustand/vanilla`. `StudioState` exposes `ProjectServiceState` fields, nullable `selectedTrackId`, `selectedPatternId`, `selectedClipId`, `errorMessage`, existing panel/tab state, and these actions:

```ts
dispatch(command: Command): DispatchResult;
undo(): void;
redo(): void;
restore(entryId: string): void;
selectTrack(trackId: string): void;
selectClip(clipId: string): void;
selectPattern(patternId: string): void;
```

Retain the existing panel methods `toggleActivity`, `closeActivity`, and `selectEditorTab`. In `studio-provider.tsx`, export `StudioProvider` with explicit `initialProject: Project` and `children: ReactNode` props, and `useStudioStore<T>(selector: (state: StudioState) => T): T`. `Studio` takes an explicit `initialProject: Project` prop; the page passes `DEMO_PROJECT`. The provider creates its store once per mount; tests instantiate the factory or mount their own provider, never reset a hidden shared service via `getInitialState()`.

- [x] Replace prototype store tests with a failing service-bridge regression. Import `EMPTY_PROJECT` from `src/data/studio-data.ts` (a schema-2 project with empty collections and no side effects):

```ts
it("publishes committed history without leaking between studio sessions", () => {
  const first = createStudioStore(EMPTY_PROJECT);
  const second = createStudioStore(EMPTY_PROJECT);
  first.getState().dispatch({
    id: "rename", source: "manual", label: "Rename project", kind: "operation",
    operation: { type: "project.update", changes: { name: "Changed" } },
  });
  expect(first.getState().project.name).toBe("Changed");
  expect(first.getState().history).toHaveLength(1);
  expect(second.getState().project).toEqual(EMPTY_PROJECT);
  first.getState().undo();
  expect(first.getState().project).toEqual(EMPTY_PROJECT);
  first.getState().redo();
  expect(first.getState().project.name).toBe("Changed");
});
```

- [x] Run `pnpm exec vitest run src/stores/studio-store.test.ts` and confirm the missing store factory fails. Add tests for standalone-pattern selection, clip-to-track/pattern selection, empty projects, and stale selections after a service command or restore.
- [x] Implement the bridge without changing service internals. Construct `ProjectService` in the store initializer with `crypto.randomUUID` and `Date.now`; spread its initial state into Zustand. The dispatch core is:

```ts
const result = service.dispatch(command);
set(service.getState());
return result;
```

Before returning, reconcile nullable selection IDs against the newly published project, clearing missing references and `errorMessage` on success. Undo/redo/restore publish through the same local path; guard a pruned restore target at the UI boundary. Do not validate arbitrary command shapes here: `dispatch` is a trusted typed bridge. New named UI actions in later tasks supply valid operations.

- [x] Replace `TRACKS`, `CLIPS`, `PROJECT_PATTERNS`, `sequenceSteps`, mute/solo sets, and the inverted `Pattern.clipId` model with selectors over `state.project`. Keep a hand-authored schema-2 demo project with real events and catalog IDs; do not try to infer music from the prototype's percentages or decorative marks. Keep colors/display labels UI-only and stable when tracks reorder.
- [x] Render variable track/mixer counts, bar-derived clip geometry and event-derived thumbnails. Make pattern names and usage counts real; standalone patterns show no invented track. Keep existing tab/panel behaviors and connect the Undo/Redo buttons now so subsequent slices are independently undoable. Remove fake playback state, time, meters, and activity; disable incomplete controls during this integration slice rather than retaining disconnected mutations. Replace fixed snap/zoom buttons with labels if not interactive.
- [x] Add a page test asserting the arrangement, pattern editor, empty activity, disabled Play/Record/Loop/Export, and a visible silent/unsaved explanation. Run `pnpm run test:ui`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`; inspect for lingering fixture imports, commit as `feat: connect studio to project service`, and request human review.

## Task 4: Implement Track Management

**Files:** Modify `src/stores/studio-store.ts`, `studio-store.test.ts`, `src/components/arrangement/Arrangement.tsx`, `TrackHeader.tsx`, and `src/components/Studio.test.tsx`.

**Interfaces:** Add store actions `createTrack(kind: TrackKind, instrumentId: string): string | null`, `renameTrack(trackId: string, name: string): void`, `setTrackPreset(trackId: string, instrumentId: string): void`, `reorderTrack(trackId: string, toIndex: number): void`, and `deleteTrack(trackId: string): void`. Creation returns the new ID, or `null` with `errorMessage`; other rejected actions set `errorMessage` without dispatch.

UI refinement approved after review: Add track now exposes only an instrument selector listing all catalog kits/presets. Infer kind from the chosen instrument before calling the existing typed action. Track settings hide the internal type and continue to offer compatible instruments only; no model or service API changes are needed.

- [x] Write a failing end-to-end component test for an empty session:

```tsx
it("creates a synth track from the add-track controls", async () => {
  const user = userEvent.setup();
  render(<Studio initialProject={EMPTY_PROJECT} />);
  await user.click(screen.getByRole("button", { name: "Add track" }));
  await user.selectOptions(screen.getByLabelText("Instrument"), "synth.bass");
  await user.click(screen.getByRole("button", { name: "Create track" }));
  expect(screen.getByRole("button", { name: "Mute Bass" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Undo" }));
  expect(screen.queryByRole("button", { name: "Mute Bass" })).not.toBeInTheDocument();
});
```

- [x] Run `pnpm exec vitest run src/components/Studio.test.tsx -t "creates a synth track"`; expect missing creation controls. Add store cases for the 16-track cap, invalid/blank names, wrong-kind preset, invalid/stale reorder targets, and deletion retaining patterns. Test track/mixer order together.
- [x] Add native labeled controls and catalog-driven choices. Construct new tracks with fresh IDs, a readable instrument-based name, `volumeDb: 0`, `pan: 0`, `muted: false`, and `soloed: false`; emit the existing `track.create` operation. Rename validates the trimmed 1–40-character input. Keep kind immutable and check instrument membership by kind.
- [x] Wire Move up/Move down and pointer reorder to the same action. Preview drag order locally; dispatch once on drop. Reject out-of-range `toIndex`; a same-index move is a no-op. For kit changes, inspect all drum patterns placed on that track and reject a kit that lacks any used sound.
- [x] Confirm track deletion when it will remove clips, showing the affected count and that patterns remain. Confirmation cancellation leaves both project and history unchanged. Restore focus to a surviving header or Add track after deletion.
- [x] Run `pnpm exec vitest run src/stores/studio-store.test.ts src/components/Studio.test.tsx`, `pnpm typecheck`, and `pnpm lint`; review diff, commit as `feat: add track management controls`, and request human review.

## Task 5: Implement Reusable Pattern and Clip Actions

**Files:** Create `src/stores/studio-edits.ts`, `studio-edits.test.ts`. Modify `src/stores/studio-store.ts`, its test, `src/components/editor/PatternSidebar.tsx`, `PatternEditor.tsx`, `src/components/arrangement/TrackLane.tsx`, `Clip.tsx`, and `src/components/Studio.test.tsx`.

**Interfaces:** Add these named store actions; creation methods return a new entity ID or `null`, rejected edits set `errorMessage`:

```ts
createPattern(kind: TrackKind): string | null;
createPatternAt(trackId: string, startBar: number): string | null;
placePattern(patternId: string, trackId: string, startBar: number): string | null;
renamePattern(patternId: string, name: string): void;
setPatternLength(patternId: string, lengthBars: PatternLengthBars): void;
duplicatePattern(patternId: string): string | null;
deletePattern(patternId: string): void;
updateClip(clipId: string, changes: Extract<Operation, { type: "arrangement.update" }>["changes"]): void;
duplicateClip(clipId: string): string | null;
deleteClip(clipId: string): void;
makeClipUnique(clipId: string): void;
```

`createPatternAt` returns the new clip ID. Export `getPlacementProblem(project: Project, clip: ArrangementClip): string | null`, `getPatternLengthProblem(project: Project, patternId: string, lengthBars: PatternLengthBars): string | null`, and `getDrumKitProblem(track: Track, soundIds: readonly string[]): string | null` from `studio-edits.ts`. These check affected musical rules, not runtime shapes. The kit check resolves the track's kit from `SOUND_CATALOG` and reports the first requested sound it does not provide; reuse it for preset changes, placement, and drum edits. Count caps belong in the relevant create/duplicate action, including combined batches.

- [ ] Write the shared/unique regression using the store created in Task 3:

```ts
it("makes only the chosen clip unique in one undoable entry", () => {
  const store = createStudioStore(EMPTY_PROJECT);
  const trackId = store.getState().createTrack("drum", "kit.basic")!;
  const clipId = store.getState().createPatternAt(trackId, 0)!;
  const secondId = store.getState().duplicateClip(clipId)!;
  const originalPatternId = store.getState().project.arrangement[0]!.patternId;
  const historyCount = store.getState().history.length;
  store.getState().makeClipUnique(secondId);
  const clips = store.getState().project.arrangement;
  expect(clips.find((clip) => clip.id === clipId)?.patternId).toBe(originalPatternId);
  expect(clips.find((clip) => clip.id === secondId)?.patternId).not.toBe(originalPatternId);
  expect(store.getState().history).toHaveLength(historyCount + 1);
  store.getState().undo();
  expect(store.getState().project.arrangement.every((clip) => clip.patternId === originalPatternId)).toBe(true);
});
```

- [ ] Run `pnpm exec vitest run src/stores/studio-store.test.ts -t "makes only the chosen clip unique"`; expect missing actions. Add focused cases for one-entry create-and-place, standalone patterns, duplication with fresh event IDs, cross-track shared edits, delete cascades, no-op updates, cap refusals without orphan patterns, and kit compatibility.
- [ ] Test placement boundaries: adjacency accepted; same-track overlap rejected; different-track overlap accepted; wrong kind/missing kit sound rejected; start/repeat integers and end cap enforced; a moving clip excludes its own old placement. Use half-open interval overlap:

```ts
const overlaps = candidate.startBar < otherEndBar && other.startBar < candidateEndBar;
```

Resolve lengths from the referenced patterns, not a cached clip width. For a pattern-length edit, build a candidate project with the proposed pattern length and check every referencing clip in that candidate project. Reject event truncation and new overlap, including two clips sharing the resized pattern.

- [ ] Implement atomic create-and-place and Make unique with existing batches. The Make unique operation payload is:

```ts
const operations: readonly Operation[] = [
  { type: "pattern.duplicate", patternId: pattern.id,
    duplicatePatternId: newPatternId, duplicateName: `${pattern.name.slice(0, 35)} copy`,
    duplicateEventIds: pattern.events.map(() => crypto.randomUUID()) },
  { type: "arrangement.update", clipId: clip.id, changes: { patternId: newPatternId } },
];
```

Here `pattern` and `clip` are resolved current targets and `newPatternId` is generated once before dispatch. Check caps first, then send one manual command. Clip duplication places a shared reference immediately after the source; reject collision/end overflow instead of searching a new location. Pattern duplication creates an unplaced item.

- [ ] Wire the pattern library, named length/rename controls, deletion confirmation with cross-track placement count, clip menus, and empty-lane double-click. Add the equivalent Create pattern here / Place controls using labeled track/bar fields. Display one-based bars; convert to zero-based numbers at the action boundary. New patterns default to one bar and no events.
- [ ] Run `pnpm exec vitest run src/stores/studio-edits.test.ts src/stores/studio-store.test.ts src/components/Studio.test.tsx`, `pnpm typecheck`, and `pnpm lint`; review diff, commit as `feat: add reusable pattern and clip workflows`, and request human review.

## Task 6: Add Arrangement Drag, Drop, and Repeat Resizing

**Files:** Modify `src/components/arrangement/Arrangement.tsx`, `TrackLane.tsx`, `Clip.tsx`, and `src/components/editor/PatternSidebar.tsx`. Create `src/components/arrangement/Arrangement.test.tsx`.

**Interfaces:** Reuse `placePattern`, `updateClip`, and `reorderTrack`; do not add project mutation paths. Clip movement supplies `{ startBar, trackId }`; right-edge resize supplies `{ repeatCount }`. Local React state holds gesture origin and preview.

- [ ] Write a failing pointer test with a deterministic mocked lane rectangle. Import `act`, `fireEvent`, `render`, and `screen` from Testing Library; `it`, `expect`, and `vi` from Vitest; the provider/hook, `StudioState`, `Arrangement`, and `EMPTY_PROJECT` from their mapped files. Use a local probe instead of exposing a production store-injection API:

```tsx
it("commits a bar-snapped clip drag only on release", () => {
  let latestState: StudioState | undefined;
  function Probe(): null {
    latestState = useStudioStore((state) => state);
    return null;
  }
  render(<StudioProvider initialProject={EMPTY_PROJECT}><Arrangement /><Probe /></StudioProvider>);
  act(() => {
    const trackId = latestState!.createTrack("drum", "kit.basic")!;
    latestState!.createPatternAt(trackId, 0);
  });
  const lane = screen.getByRole("region", { name: "Drums lane" });
  vi.spyOn(lane, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 800, 112));
  const clipElement = screen.getByRole("button", {
    name: `Select ${latestState!.project.patterns[0]!.name}`,
  });
  Object.defineProperty(clipElement, "setPointerCapture", { value: vi.fn(), configurable: true });
  Object.defineProperty(clipElement, "releasePointerCapture", { value: vi.fn(), configurable: true });
  const before = latestState!.history.length;
  fireEvent.pointerDown(clipElement, { pointerId: 1, button: 0, clientX: 20, clientY: 30 });
  fireEvent.pointerMove(clipElement, { pointerId: 1, clientX: 120, clientY: 30 });
  expect(latestState!.history).toHaveLength(before);
  fireEvent.pointerUp(clipElement, { pointerId: 1, clientX: 120, clientY: 30 });
  expect(latestState!.history).toHaveLength(before + 1);
  expect(latestState!.project.arrangement[0]?.startBar).toBe(1);
});
```

Give each lane its track-name region label. Eight displayed bars across this 800-pixel lane make 100 pixels per bar. Read the lane geometry when the gesture starts so the mocked rectangle is authoritative. Restore test spies after each test. Test-only capture stubs do not replace the later real-browser capture check.

- [ ] Run `pnpm exec vitest run src/components/arrangement/Arrangement.test.tsx`; expect no movement/commit before handlers exist. Add cases for scrolled coordinates and grab offsets, compatible cross-track moves, pattern sidebar placement, repeat changes, pointercancel/Escape/lost capture, invalid drop, no movement, and a target deleted during a drag.
- [ ] Implement pointer capture and local previews. Calculate snapped moves from the original start plus `Math.round(deltaX / pixelsPerBar)`. Compute repeat count from the proposed total width divided by `pixelsPerBar * pattern.lengthBars`, bounded to 1–64. Use current grid geometry and scroll deltas; do not dispatch on pointermove or allow negative starts.
- [ ] Recheck current-project validity through the existing actions on release, commit once, clear preview, and prevent the subsequent click/lost-capture event from duplicating an action. Offer start-bar, target-track, and repeat-count fields alongside drag. Sidebar placement and empty-lane creation use the same bar mapping and current-project checks.
- [ ] Ensure the timeline displays at least eight bars and grows/scrolls with actual clip extent up to 256; allow users to place at later bars through the explicit placement control. Do not introduce zoom or auto-scroll infrastructure unless needed to make those documented placements reachable.
- [ ] Run `pnpm exec vitest run src/components/arrangement/Arrangement.test.tsx src/stores/studio-edits.test.ts`, `pnpm typecheck`, and `pnpm lint`; inspect in a browser for real pointer capture/scrolling, review diff, commit as `feat: add arrangement gestures`, and request human review.

## Task 7: Implement the Drum Editor

**Files:** Create `src/components/editor/DrumGrid.tsx`, `DrumGrid.test.tsx`. Modify `PatternEditor.tsx`, `src/stores/studio-store.ts`, its test, and `studio-edits.ts` / its test.

**Interfaces:** Add `setDrumCells(patternId: string, cells: readonly { readonly soundId: string; readonly startStep: number; readonly active: boolean }[]): void` to the store. A stroke resolves repeated visits to one intended value per cell before calling this action. Use `DrumGrid` props `{ readonly pattern: DrumPattern }`; it reads actions through the existing provider.

- [ ] Write this regression and cases for erase, repeated cell visits, last valid step of four bars, event cap, unavailable sound, all referencing kits, and stale pattern deletion:

```ts
it("commits a drum paint stroke once and retains edits across selection", () => {
  const store = createStudioStore(EMPTY_PROJECT);
  const patternId = store.getState().createPattern("drum")!;
  const before = store.getState().history.length;
  store.getState().setDrumCells(patternId, [
    { soundId: "kick", startStep: 0, active: true },
    { soundId: "kick", startStep: 4, active: true },
  ]);
  const otherId = store.getState().createPattern("drum")!;
  store.getState().selectPattern(otherId);
  store.getState().selectPattern(patternId);
  expect(store.getState().project.patterns.find((pattern) => pattern.id === patternId)?.events).toHaveLength(2);
  expect(store.getState().history).toHaveLength(before + 2);
  store.getState().undo();
  store.getState().undo();
  expect(store.getState().project.patterns.find((pattern) => pattern.id === patternId)?.events).toHaveLength(0);
});
```

- [ ] Run `pnpm exec vitest run src/stores/studio-store.test.ts -t "drum paint stroke"`; expect the missing action to fail. Add a component test clicking `Add Kick at step 1`, then cancelling a multi-cell pointer stroke and asserting unchanged events/history.
- [ ] Implement named rows from the catalog and 16/32/64-step columns. The first cell's state chooses paint versus erase for the stroke; a visited-cell set prevents toggle-back. Keep preview cells local; commit one command on release. A single click or keyboard cell activation uses the same action.
- [ ] Resolve additions/deletions against current events, assign IDs only to new hits, and aggregate the work into at most one `drum-hits.add` and one `drum-hits.delete` operation in one command. Reject out-of-range steps, over-cap events, unsupported sounds, or a sound absent from any referencing track's kit, reusing `getDrumKitProblem`. Empty diffs create no command. Do not audition sounds or create an audio context.
- [ ] Run `pnpm exec vitest run src/components/editor/DrumGrid.test.tsx src/stores/studio-store.test.ts src/stores/studio-edits.test.ts`, `pnpm typecheck`, and `pnpm lint`; review diff, commit as `feat: add drum pattern editing`, and request human review.

## Task 8: Implement the Piano Roll

**Files:** Create `src/components/editor/PianoRoll.tsx`, `PianoRoll.test.tsx`. Modify `PatternEditor.tsx`, `src/stores/studio-store.ts`, and its test.

**Interfaces:** Add `addSynthNote(patternId: string, midiNote: number, startStep: number, lengthSteps: number): string | null`, `updateSynthNotes(patternId: string, updates: Extract<Operation, { type: "synth-notes.update" }>["updates"]): void`, `duplicateSynthNotes(patternId: string, noteIds: readonly string[], offsetSteps: number): void`, and `deleteSynthNotes(patternId: string, noteIds: readonly string[]): void`. `PianoRoll` takes `{ readonly pattern: SynthPattern }`; selected note IDs and drag previews remain editor-local.

- [ ] Write a failing chord/boundary regression:

```ts
it("allows chords but rejects a note extending past its pattern", () => {
  const store = createStudioStore(EMPTY_PROJECT);
  const patternId = store.getState().createPattern("synth")!;
  store.getState().addSynthNote(patternId, 60, 0, 4);
  store.getState().addSynthNote(patternId, 64, 0, 4);
  store.getState().addSynthNote(patternId, 67, 0, 4);
  const before = store.getState().history.length;
  expect(store.getState().addSynthNote(patternId, 72, 15, 2)).toBeNull();
  expect(store.getState().project.patterns[0]?.events).toHaveLength(3);
  expect(store.getState().history).toHaveLength(before);
  expect(store.getState().errorMessage).toBeTruthy();
});
```

- [ ] Run `pnpm exec vitest run src/stores/studio-store.test.ts -t "allows chords"`; expect missing note actions. Add cases for MIDI 24/96 limits, non-integer/zero duration, multi-note atomic move/resize, duplicate IDs, event cap, out-of-bounds duplication, stale selection, undo, and editing a pattern shared across tracks.
- [ ] Render a scrollable chromatic MIDI 24–96 grid and sixteenth-step columns for the pattern length. Clicking an empty cell creates a one-step note. Clicking a note selects it; Shift-click toggles membership. Drag moves the selection by a shared snapped step/pitch delta; right-edge drag resizes the targeted note. Cancel does not alter project data.
- [ ] For a whole-note movement, compute candidate values from the gesture origin rather than accumulating rounded movement:

```ts
const changes = {
  startStep: original.startStep + Math.round(deltaX / pixelsPerStep),
  midiNote: original.midiNote - Math.round(deltaY / pixelsPerPitch),
};
```

The action rejects the whole update if any selected note leaves the valid range. Dispatch existing multi-note operations once; do not silently shorten notes. Duplicate selection offsets by one step by default, with an explicit offset control; reject overflow. Provide labeled pitch/start/length controls and Delete/Duplicate actions so drag is not required.
- [ ] Add component tests covering visual note position/duration, selection changes, cancelled drag, one-entry commit, and keyboard behavior outside versus inside text fields. Remove the prototype four-pitch grid. No note audition handlers.
- [ ] Run `pnpm exec vitest run src/components/editor/PianoRoll.test.tsx src/stores/studio-store.test.ts`, `pnpm typecheck`, and `pnpm lint`; inspect scrolling/resize in the browser, review diff, commit as `feat: add piano roll editing`, and request human review.

## Task 9: Connect Mixer Controls and Gesture History

**Files:** Modify `src/components/editor/Mixer.tsx`, `ChannelStrip.tsx`, `src/components/arrangement/TrackHeader.tsx`, `src/stores/studio-store.ts`, its test, and `src/components/Studio.test.tsx`.

**Interfaces:** Add `setTrackVolume(trackId: string, volumeDb: number): void`, `setTrackPan(trackId: string, pan: number): void`, `toggleMute(trackId: string): void`, `toggleSolo(trackId: string): void`, and `setMasterVolume(volumeDb: number): void`. Use the existing `track.update` / `project.update` operations. These values are musical state, not presentation percentages.

- [ ] Write a failing controlled-value/undo test, plus a component test that track-header mute and mixer mute immediately agree:

```ts
it("stores mixer values in the project and restores them with undo", () => {
  const store = createStudioStore(EMPTY_PROJECT);
  const trackId = store.getState().createTrack("synth", "synth.bass")!;
  store.getState().setTrackVolume(trackId, -12);
  store.getState().setTrackPan(trackId, 0.5);
  store.getState().setMasterVolume(-3);
  expect(store.getState().project.tracks[0]).toMatchObject({ volumeDb: -12, pan: 0.5 });
  expect(store.getState().project.masterVolumeDb).toBe(-3);
  store.getState().undo();
  expect(store.getState().project.masterVolumeDb).toBe(0);
});
```

- [ ] Run `pnpm exec vitest run src/stores/studio-store.test.ts -t "stores mixer values"`; expect missing actions. Add finite numeric input and bounds tests, unchanged-value no-ops, multiple solos, and a slider gesture with many input events but one history entry.
- [ ] Replace `defaultValue` controls with controlled native range/number inputs and visible dB/pan values. Use local draft state during adjustment; show the committed value after undo or cancellation. A pointer gesture commits on release, a keyboard adjustment on key release, and text entry on Enter/blur; prevent duplicate commits across overlapping events.
- [ ] Dispatch only finite in-range values (-60..6 track dB, -60..0 master dB, -1..1 pan). Toggle mute/solo from the current track. Keep mixer channels in project track order. Remove the prototype master pan and all simulated level meters rather than adding unsupported model fields.
- [ ] Run `pnpm exec vitest run src/stores/studio-store.test.ts src/components/Studio.test.tsx`, `pnpm typecheck`, and `pnpm lint`; review diff, commit as `feat: wire mixer controls to project history`, and request human review.

## Task 10: Finish History, Keyboard, and Failure UX

**Files:** Modify `src/components/ActivityPanel.tsx`, `Transport.tsx`, `Studio.tsx`, `src/stores/studio-store.ts`, its test, `src/components/Studio.test.tsx`, and `src/app/page.test.tsx`.

**Interfaces:** Reuse `dispatch`, `undo`, `redo`, and `restore` from Task 3; display `history`, `historyCursor`, and `errorMessage`. Command source stays the existing `"manual" | "agent"` union. Keyboard handlers call existing named actions, never reduce state themselves.

- [ ] Add a failing real-history UI test and a store restore test. For source attribution, supply an actual typed agent command through the trusted bridge, rather than hardcoding an activity row:

```ts
it("retains command attribution and makes restore undoable", () => {
  const store = createStudioStore(EMPTY_PROJECT);
  store.getState().dispatch({
    id: "agent-rename", source: "agent", label: "Agent renamed project", kind: "operation",
    operation: { type: "project.update", changes: { name: "Agent song" } },
  });
  const entryId = store.getState().history[0]!.id;
  store.getState().createTrack("drum", "kit.basic");
  store.getState().restore(entryId);
  expect(store.getState().project.tracks).toHaveLength(0);
  expect(store.getState().history[0]?.source).toBe("agent");
  expect(store.getState().history.at(-1)?.action.kind).toBe("restore");
  store.getState().undo();
  expect(store.getState().project.tracks).toHaveLength(1);
});
```

- [ ] Run `pnpm exec vitest run src/stores/studio-store.test.ts -t "retains command attribution"` and the new activity component test before changing the UI. Add tests for cursor styling, disabled undo/redo, restore confirmation, pruned targets, selection clearing, and new edits discarding redo history.
- [ ] Render actual labels/source/time from retained history; indicate undone entries and the current cursor. Confirm Restore before replacing current work. Extend the existing Undo/Redo buttons with Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, plus Ctrl+Y where appropriate. Selection-only activity never creates history.
- [ ] Restrict destructive/edit shortcuts to the focused editing surface. A target in `input`, `textarea`, `select`, a contenteditable region, or an active dialog keeps native behavior. Escape cancels the current preview/dialog; Delete/Backspace applies only to the focused clip/note selection. Stop duplicate event propagation between nested surfaces.
- [ ] Finish accessible status messages for overlap, missing/stale targets, limits, kit incompatibility, and note bounds. Verify each refused action preserves both project and history. Keep visible silent/in-memory status, disabled playback/record/loop/export, and truthful project name/BPM. No saved badge, fake time, or sample-loading side effects.
- [ ] Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`; review diff, commit as `feat: finish silent editor history and keyboard UX`, and request human review.

## Task 11: Verify the Complete Silent Workflow and Record Compatibility Gates

**Files:** Extend existing store/component tests for any newly found regression before fixing it. Update `README.md` and these design/plan documents to reflect actual completed scope. Do not edit the separate persistence worktree.

- [ ] Run the focused regression for any discovered defect first, observe the failure, fix only that behavior, and rerun it. The final workflow must cover: empty session → two synth tracks plus drums → standalone and placed patterns → notes/hits → shared cross-track placement → Make unique → clip/track movement → repeats → mixer → undo/redo/restore.
- [ ] Perform browser checks at the existing desktop size: preserve layout; test pointer release outside targets, timeline/piano scrolling, cancellation, invalid drops, keyboard-only alternatives, focus in text fields, and deletion confirmation. Check that shared edits appear in every referring clip and that switching editor tabs/selections loses no edits.
- [ ] Exercise limits with programmatically constructed test projects: 16 tracks, 128 patterns, 512 clips/events, final valid bar, and four-bar patterns with 64 repeats. Verify refusals are explained and non-mutating. Native browser interactions, not jsdom alone, must verify pointer capture and range behavior.
- [ ] Confirm no audio context is constructed or samples fetched during initial render or editing; Play/Record/Loop/Export remain unavailable. Reload behavior matches the visible warning: edits are not persisted in this milestone.
- [ ] Run the final verification commands from the worktree:

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
git diff --check
git status --short --branch
```

- [ ] Review changed application code for accidental new generic validators, duplicate musical state, new dependencies, and silent data loss. Check all acceptance items in spec section 11 against the actual tests/browser evidence, not just a successful build.
- [ ] Record the persistence integration gate explicitly: `codex/project-persistence` must be updated to the trusted domain and schema 2; its loader must decode external input once, use `migrateProject`, retain old/corrupt/unsupported records, and preserve a recoverable old record before upgrade writes. Its current project-only storage does not include history. Do not claim this gate was implemented or that autosave works.
- [ ] Update completion checkboxes only for implemented and verified work, inspect the diff, and make the final local documentation/test commit as `test: verify silent editor workflows`. Present the remaining persistence/playback/WebMCP boundaries and stop for human review; integration into `main` is a separate decision.

## Acceptance Traceability

| Spec requirement | Implementation / verification |
| --- | --- |
| Independent pattern ownership, migration, deletion, audio routing | Task 1; regression suite in Task 11. |
| Ordered tracks / UI-1 | Tasks 2 and 4; arrangement/mixer order checks. |
| Single state owner, selection, honest silent UI | Task 3; final checks in Tasks 10–11. |
| Pattern library and empty-lane creation / UI-2–3 | Task 5; atomic history and cap tests. |
| Clips, sharing, Make unique, repeat resizing / UI-4 | Tasks 5–6; shared-pattern length/overlap regressions. |
| Drum/piano editing / UI-5–6 | Tasks 7–8; event bounds, chords, compatibility, and cancelled gestures. |
| Controlled mixer / UI-7 | Task 9; one-entry adjustments and undo. |
| History, restore, silence / UI-8 | Tasks 3 and 10; source attribution, pruning, no audio side effects. |
| Empty/failure/focus/accessibility/session behavior / UI-9 | Tasks 3–10 at each surface; browser acceptance in Task 11. |
| Persistence boundary and rollback contract | Converter in Task 1; explicit external integration gate in Task 11. |

## Planning Review

The design's ownership rules, interaction matrix, limits, and compatibility requirements are mapped above. New interfaces are introduced in the slice that implements them; later slices reuse them. Documentation alone does not satisfy an implementation checkbox, and the storage integration gate is intentionally not represented as completed UI work.
