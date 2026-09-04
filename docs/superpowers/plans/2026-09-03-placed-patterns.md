# Placed Patterns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the project-patterns sidebar and guarantee that every committed pattern has at least one arrangement placement.

**Architecture:** Keep the existing low-level pattern and arrangement operations, then finalize each command once by pruning unreferenced patterns and computing its summary from the finalized project. Manual UI and WebMCP creation/duplication submit atomic pattern-plus-placement batches, while persistence normalizes legacy orphan patterns at load time.

**Tech Stack:** TypeScript 6, React 19, Next.js 16, Zustand 5, Node test runner, Vitest, Testing Library, pnpm 10.17.0.

**Spec:** `docs/superpowers/specs/2026-09-03-placed-patterns-design.md`

## Global Constraints

- Keep project schema version 2; no stored field shape changes.
- Add no dependencies.
- Every committed pattern must be referenced by at least one arrangement clip.
- Empty projects with no patterns and no clips remain valid.
- Preserve shared-pattern editing and atomic undo/redo.
- Work test-first and run the focused failing test before implementation.
- Do not refactor unrelated audio, gestures, persistence, or WebMCP code.

---

### Task 1: Finalize project transactions

**Files:**
- Modify: `src/project/reducer.ts`
- Modify: `src/project/service.ts`
- Modify: `src/project/validation.ts`
- Test: `test/project.test.ts`
- Test: `test/project-validation.test.ts`

**Interfaces:**
- Produces: `finalizeProject(project: Project): Project`
- Produces: `reduceOperations(project: Project, operations: readonly Operation[]): Reduction`
- Changes: `validateOperations(...)` rejects new patterns left without placement and returns a finalized result.

- [ ] **Step 1: Write failing finalization tests**

Cover last-clip deletion, one-of-many clip deletion, track deletion, clip pattern reassignment, and deletion summaries.

```ts
test("deleting the last clip finalizes its pattern in the same history entry", () => {
  const service = createTestService(projectWithBasicDrums());
  const result = service.dispatch({
    id: "delete-last", source: "manual", label: "Delete clip", kind: "operation",
    operation: { type: "arrangement.delete", clipId: id(12) },
  });
  assert.deepEqual(result.project.patterns, []);
  assert.deepEqual(result.project.arrangement, []);
  assert.deepEqual(result.changes.deleted.patternIds, [id(11)]);
  assert.deepEqual(result.changes.deleted.arrangementClipIds, [id(12)]);
});
```

- [ ] **Step 2: Run the focused project tests**

```bash
node --disable-warning=ExperimentalWarning --test --test-name-pattern="last clip|shared pattern|track deletion" test/project.test.ts
```

Expected: assertions fail because reducers currently preserve orphan patterns.

- [ ] **Step 3: Write failing transaction validation tests**

```ts
assert.throws(
  () => validateOperations(project({ tracks: [drumTrack()] }), [
    { type: "pattern.create", pattern: drumPattern() },
  ], catalog),
  (error: unknown) => error instanceof ProjectValidationError
    && error.code === "OUT_OF_RANGE" && error.field === "placement",
);
const valid = validateOperations(project({ tracks: [drumTrack()] }), [
  { type: "pattern.create", pattern: drumPattern() },
  { type: "arrangement.place", clip: {
    id: "clip", patternId: "beat", trackId: "drums", startBar: 0, repeatCount: 1,
  } },
], catalog);
assert.equal(valid.project.patterns.at(-1)?.id, "beat");
```

- [ ] **Step 4: Run the focused validation tests**

```bash
node --disable-warning=ExperimentalWarning --test --test-name-pattern="placement invariant|paired pattern" test/project-validation.test.ts
```

Expected: standalone creation is accepted instead of reporting `placement`.

- [ ] **Step 5: Implement pure finalization and multi-operation reduction**

```ts
export function finalizeProject(project: Project): Project {
  const placedPatternIds = new Set(project.arrangement.map((clip) => clip.patternId));
  const patterns = project.patterns.filter((pattern) => placedPatternIds.has(pattern.id));
  return patterns.length === project.patterns.length ? project : { ...project, patterns };
}

export function reduceOperations(project: Project, operations: readonly Operation[]): Reduction {
  let candidate = project;
  for (const operation of operations) candidate = reduceOperation(candidate, operation).project;
  const finalized = finalizeProject(candidate);
  return { project: finalized, changes: summarizeProjectDiff(project, finalized) };
}
```

Use `reduceOperations` in `ProjectService.dispatch`; retain cloned operations for history.

- [ ] **Step 6: Validate final placement before pruning**

```ts
const createdPatternIds = new Set(operations.flatMap((operation) =>
  operation.type === "pattern.create" ? [operation.pattern.id]
    : operation.type === "pattern.duplicate" ? [operation.duplicatePatternId]
      : [],
));
const unplaced = candidate.patterns.find((pattern) => createdPatternIds.has(pattern.id)
  && !candidate.arrangement.some((clip) => clip.patternId === pattern.id));
if (unplaced) fail("OUT_OF_RANGE", "placement", `Pattern ${unplaced.id} requires a placement.`);
const finalized = finalizeProject(candidate);
return { project: finalized, changes: summarizeProjectDiff(project, finalized) };
```

- [ ] **Step 7: Verify and commit the domain slice**

```bash
node --disable-warning=ExperimentalWarning --test test/project.test.ts test/project-validation.test.ts
git add src/project/reducer.ts src/project/service.ts src/project/validation.ts test/project.test.ts test/project-validation.test.ts
git commit -m "feat: require placed patterns in project transactions"
```

---

### Task 2: Normalize saved and bundled projects

**Files:**
- Modify: `src/persistence/decode.ts`
- Modify: `src/data/studio-data.ts`
- Test: `test/persistence.test.ts`

**Interfaces:**
- Consumes: `finalizeProject(project: Project): Project`.
- Produces: decoded schema-1 and schema-2 projects with no orphan patterns.
- Preserves: source objects and stored records are not rewritten during load.

- [ ] **Step 1: Write failing load-normalization tests**

Add schema-2 and schema-1 records with a valid unplaced pattern. Assert load omits it while original and stored values still contain it.

```ts
const indexedDB = new IDBFactory();
const source = { ...projectWithBasicDrums(), patterns: [
  ...projectWithBasicDrums().patterns,
  { id: "orphan", name: "Orphan", kind: "synth", lengthBars: 1, events: [] },
] };
const record = { project: source, updatedAt: 123 };
await seedRawRecord(indexedDB, record);
const result = await createService(indexedDB).load();
assert.equal(result.status, "loaded");
if (result.status === "loaded") {
  assert.equal(result.project.patterns.some(({ id }) => id === "orphan"), false);
}
assert.equal(source.patterns.some(({ id }) => id === "orphan"), true);
assert.deepEqual(await readRawRecord(indexedDB), record);
```

- [ ] **Step 2: Run the focused persistence tests**

```bash
node --disable-warning=ExperimentalWarning --test --test-name-pattern="orphan pattern" test/persistence.test.ts
```

Expected: the loaded project still contains `orphan`.

- [ ] **Step 3: Finalize decoded values and remove the demo orphan**

```ts
const project = schemaVersion === 1
  ? migrateProject(readProjectV1(source, catalog))
  : readProjectV2(source, catalog);
validateRelationships(project, catalog);
return { ok: true, project: finalizeProject(project) };
```

Delete `unused-idea` from `DEMO_PROJECT`; do not invent a placement.

- [ ] **Step 4: Verify and commit persistence normalization**

```bash
node --disable-warning=ExperimentalWarning --test test/persistence.test.ts
git add src/persistence/decode.ts src/data/studio-data.ts test/persistence.test.ts
git commit -m "feat: discard orphan patterns when loading projects"
```

---

### Task 3: Make manual actions placement-aware

**Files:**
- Modify: `src/stores/studio-store.ts`
- Test: `src/stores/studio-store.test.ts`

**Interfaces:**
- Removes: `createPattern(kind: TrackKind): string | null`.
- Replaces: `duplicatePattern(...)` with `duplicatePatternAt(patternId: string, trackId: string, startBar: number): string | null`.
- Changes: `makeClipUnique(clipId: string): void` does not dispatch for a sole-placement pattern.

- [ ] **Step 1: Write failing store tests**

```ts
test("duplicates a pattern only with its first placement", () => {
  const store = createTestStore(DEMO_PROJECT);
  const clipId = store.getState().duplicatePatternAt("orbit", "bass", 8);
  const clip = store.getState().project.arrangement.find(({ id }) => id === clipId);
  expect(clipId).not.toBeNull();
  expect(store.getState().project.patterns.some(({ id }) => id === clip?.patternId)).toBe(true);
  expect(store.getState().history.at(-1)?.action.kind).toBe("batch");
});

test("make unique is a no-op for one placement", () => {
  const project: Project = {
    ...DEMO_PROJECT,
    patterns: DEMO_PROJECT.patterns.filter(({ id }) => id === "afterglow"),
    arrangement: DEMO_PROJECT.arrangement.filter(({ id }) => id === "melody-a"),
  };
  const store = createTestStore(project);
  store.getState().makeClipUnique("melody-a");
  expect(store.getState()).toMatchObject({ revision: 0, history: [] });
});
```

Also cover last-clip deletion, track deletion, selection clearing, and undo restoration.

- [ ] **Step 2: Run the store test**

```bash
pnpm exec vitest run src/stores/studio-store.test.ts
```

Expected: `duplicatePatternAt` is missing and old unplaced-pattern tests conflict.

- [ ] **Step 3: Implement atomic duplicate-with-placement**

Reuse `duplicatePatternOperation`, `getPlacementProblem`, `reduceOperation`, and `commitBatch`. Check both caps before allocating.

```ts
const duplicatePatternId = crypto.randomUUID();
const duplicate = duplicatePatternOperation(pattern, duplicatePatternId);
const clip = { id: crypto.randomUUID(), patternId: duplicatePatternId, trackId, startBar, repeatCount: 1 };
const candidate = reduceOperation(project, duplicate).project;
const problem = getPlacementProblem(candidate, clip);
if (problem) { set({ errorMessage: problem }); return null; }
if (!commitBatch(`Duplicate ${pattern.name}`, [duplicate, { type: "arrangement.place", clip }])) return null;
get().selectClip(clip.id);
return clip.id;
```

Remove `createPattern`. Return before ID allocation in `makeClipUnique` when placement count is one.

- [ ] **Step 4: Verify and commit manual actions**

```bash
pnpm exec vitest run src/stores/studio-store.test.ts
git add src/stores/studio-store.ts src/stores/studio-store.test.ts
git commit -m "feat: make manual pattern actions placement-aware"
```

---

### Task 4: Tighten the WebMCP contract

**Files:**
- Modify: `src/webmcp/contracts.ts`
- Modify: `src/webmcp/tools.ts`
- Modify: `src/webmcp/tools.test.ts`
- Modify: `src/webmcp/evals/tool-selection.json`

**Interfaces:**
- Changes: `PublicChange` and direct/batch schemas require `placement` for `create_pattern` and `duplicate_pattern`.
- Produces: both tools return `pattern_id` and `clip_id`.
- Changes: sole-placement `make_clip_unique` returns its existing pattern ID with `changed: false` and no history.

- [ ] **Step 1: Write failing contract and mutation tests**

```ts
expect(schemaOf("create_pattern")).toMatchObject({
  required: expect.arrayContaining(["request_id", "kind", "length_bars", "placement"]),
});
expect(schemaOf("duplicate_pattern")).toMatchObject({
  required: expect.arrayContaining(["request_id", "pattern_id", "placement"]),
});
```

Test missing and malformed placement, duplicate placement validation, both generated IDs, cascade results, and sole-placement Make unique.

- [ ] **Step 2: Run WebMCP tests**

```bash
pnpm exec vitest run src/webmcp/tools.test.ts
```

Expected: placement remains optional and duplicate creates no clip.

- [ ] **Step 3: Make types, schemas, parsing, and descriptions placement-aware**

Add required duplicate placement with `clip_ref`, `track_id`, `start_bar`, and optional `repeat_count`. Remove optional branches from create parsing.

```ts
readonly placement: {
  readonly clip_ref?: string;
  readonly track_id: EntityReference;
  readonly start_bar: number;
  readonly repeat_count?: number;
};
```

Update descriptions for create, duplicate, delete clip, delete track, change pattern, and Make unique.

- [ ] **Step 4: Translate duplicate and placement as one batch**

```ts
return [
  { type: "pattern.duplicate", patternId, duplicatePatternId, duplicateName, duplicateEventIds },
  { type: "arrangement.place", clip: {
    id: createEntityId(declaration(change.placement.clip_ref, "placement.clip_ref"), context),
    patternId: duplicatePatternId,
    trackId: resolveReference(change.placement.track_id, "placement.track_id", context),
    startBar: change.placement.start_bar - 1,
    repeatCount: change.placement.repeat_count ?? 1,
  } },
];
```

- [ ] **Step 5: Make sole-placement Make unique idempotent**

```ts
if (project.arrangement.filter((candidate) => candidate.patternId === pattern.id).length === 1) {
  if (change.pattern_ref !== undefined) context.references.set(change.pattern_ref, pattern.id);
  return [{ type: "arrangement.update", clipId: clip.id, changes: { patternId: pattern.id } }];
}
```

Direct results use `created.patternIds[0] ?? existingPatternId` for `pattern_id`.

- [ ] **Step 6: Update WebMCP eval fixtures**

Every expected create or duplicate call includes a compatible placement.

```json
"placement": { "track_id": "drums", "start_bar": 9 }
```

- [ ] **Step 7: Verify and commit WebMCP**

```bash
pnpm exec vitest run src/webmcp/tools.test.ts
git add src/webmcp/contracts.ts src/webmcp/tools.ts src/webmcp/tools.test.ts src/webmcp/evals/tool-selection.json
git commit -m "feat: require placements in pattern tools"
```

---

### Task 5: Remove the sidebar and relocate pattern controls

**Files:**
- Delete: `src/components/editor/PatternSidebar.tsx`
- Modify: `src/components/editor/PatternEditor.tsx`
- Modify: `src/components/editor/PatternControls.tsx`
- Modify: `src/components/arrangement/TrackControls.tsx`
- Modify: `src/components/arrangement/Arrangement.tsx`
- Test: `src/components/Studio.test.tsx`
- Test: `src/components/arrangement/ArrangementGestures.test.tsx`
- Test: `src/components/editor/PianoRoll.test.tsx`
- Test: `src/components/editor/DrumGrid.test.tsx`

**Interfaces:**
- Consumes: `duplicatePatternAt(...)` from Task 3.
- Removes: `AddPattern` and `PatternSettings`.
- Expands: `ClipSettings` with pattern rename, length, duplicate-with-placement, and delete-pattern controls.
- Preserves: lane double-click and track-settings creation.

- [ ] **Step 1: Replace sidebar tests with arrangement-owned behavior tests**

```tsx
expect(screen.queryByRole("complementary", { name: "Project patterns" })).not.toBeInTheDocument();
expect(screen.getByRole("region", { name: "Pattern editor for Neon beat" })).toBeVisible();
await user.click(screen.getByRole("button", { name: "Edit clip Neon beat at bar 1" }));
expect(screen.getByRole("textbox", { name: "Pattern name" })).toHaveValue("Neon beat");
expect(screen.getByRole("combobox", { name: "Pattern length" })).toHaveValue("1");
expect(screen.getByRole("button", { name: "Delete pattern" })).toBeEnabled();
```

Add cases for lane creation, duplicate-with-placement, last-clip cascade, track cascade, Make unique state, and undo.

- [ ] **Step 2: Run focused UI tests**

```bash
pnpm exec vitest run src/components/Studio.test.tsx src/components/arrangement/ArrangementGestures.test.tsx src/components/editor/PianoRoll.test.tsx src/components/editor/DrumGrid.test.tsx
```

Expected: the sidebar renders and clip settings lack pattern controls.

- [ ] **Step 3: Delete the sidebar and expand the selected-clip editor**

`PatternEditor` reads `selectedClipId`, resolves its pattern and track, and renders one full-width editor. Keep the existing surface inline instead of extracting a one-use component.

```tsx
<div className="h-[calc(100%-42px)]">
  {pattern && track ? <section aria-label={`Pattern editor for ${pattern.name}`}>{editor}</section>
    : <p className="p-6 text-xs text-zinc-500">Select or create a clip to edit its pattern.</p>}
</div>
```

- [ ] **Step 4: Merge pattern actions into `ClipSettings`**

Remove `AddPattern` and `PatternSettings`. Reuse their rename, length, compatible destination, and delete confirmation controls. Use separate destination state for duplicate pattern.

```tsx
<button type="button" disabled={uses === 1} onClick={() => makeClipUnique(clip.id)}>
  {uses === 1 ? "Already unique" : "Make unique"}
</button>
```

Duplicate pattern calls `duplicatePatternAt(pattern.id, duplicateTrackId, Number(duplicateStartBar) - 1)` and closes only after success.

- [ ] **Step 5: Correct deletion copy and focus behavior**

```tsx
<p>
  Delete {track.name} and {clipCount} {clipCount === 1 ? "clip" : "clips"}?
  Patterns used elsewhere remain. You can undo this.
</p>
```

Return focus to the originating lane or Add track button; remove sidebar-button focus code.

- [ ] **Step 6: Verify and commit the UI**

```bash
pnpm exec vitest run src/components/Studio.test.tsx src/components/arrangement/ArrangementGestures.test.tsx src/components/editor/PianoRoll.test.tsx src/components/editor/DrumGrid.test.tsx
git add src/components/editor/PatternEditor.tsx src/components/editor/PatternControls.tsx src/components/arrangement/TrackControls.tsx src/components/arrangement/Arrangement.tsx src/components/Studio.test.tsx src/components/arrangement/ArrangementGestures.test.tsx src/components/editor/PianoRoll.test.tsx src/components/editor/DrumGrid.test.tsx
git rm src/components/editor/PatternSidebar.tsx
git commit -m "feat: manage patterns from arrangement clips"
```

---

### Task 6: Update current documentation and verify end to end

**Files:**
- Modify: `README.md`
- Modify: `docs/design.md`
- Modify: `src/components/WebMCPInfo.tsx`
- Verify: all changed source and test files

**Interfaces:**
- Documents: reusable patterns always have a placement.
- Documents: create/duplicate require placement and last-clip deletion removes the pattern.

- [ ] **Step 1: Update current product documentation**

```md
- Create reusable patterns directly in the arrangement; every pattern has at least one clip.
- Removing a pattern's last clip removes the pattern, while shared patterns survive with another placement.
```

Keep dated historical specs unchanged; the approved design records what it supersedes.

- [ ] **Step 2: Check the diff and stale active wording**

```bash
git diff --check
rg -n "Unplaced|unplaced pattern|patterns remain in the library|Add pattern|Project patterns" README.md docs/design.md src test
```

Expected: the diff check is silent and active code/tests contain no removed library behavior.

- [ ] **Step 3: Run complete automated verification**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Expected: every command exits 0.

- [ ] **Step 4: Run the worktree dev server and verify in browser**

Verify sidebar absence and full editor width; lane creation; shared rename/resize; duplicate clip; duplicate pattern; Make unique; last-clip deletion; track deletion; undo/redo; and WebMCP required placement schemas.

```bash
pnpm dev
```

- [ ] **Step 5: Review the final branch diff**

```bash
git status --short
git diff --stat main...HEAD
git diff main...HEAD
```

Expected: changes are limited to the approved invariant, persistence, contract, UI, tests, docs, spec, and plan.

- [ ] **Step 6: Commit documentation if changed**

```bash
git add README.md docs/design.md src/components/WebMCPInfo.tsx
git commit -m "docs: document arrangement-owned patterns"
```

If current documentation required no edits, skip the empty commit and record that in the completion summary.
