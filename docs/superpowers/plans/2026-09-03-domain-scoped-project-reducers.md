# Domain-Scoped Project Reducers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the project operation union, reducer, and tests by domain while preserving the current serialized operation shape and all behavior.

**Architecture:** Six modules under `src/project/operations/` each own one operation union and pure reducer. `commands.ts` composes the public union, while `reducer.ts` retains project-wide diffing and exhaustively routes operations to the domain reducers.

**Tech Stack:** TypeScript 6, Node.js test runner, pnpm 10.17.0.

**Spec:** `docs/superpowers/specs/2026-09-03-domain-scoped-project-reducers-design.md`

## Global Constraints

- Preserve all existing flat operation discriminants and serialized payload shapes.
- Preserve the public `Operation` import path and all `ProjectService` behavior.
- Add no dependencies and no validation framework.
- Keep reducers pure and inputs immutable.
- Use Node.js >=23.6 and pnpm 10.17.0.

---

### Task 1: Add the exhaustive routing guard

**Files:**
- Modify: `test/project.test.ts`
- Modify: `src/project/reducer.ts`

**Interfaces:**
- Consumes: `reduceOperation(project: Project, operation: Operation): Reduction`
- Produces: an exhaustive fallthrough that throws `Unsupported project operation: <type>` for invalid untyped runtime input

- [ ] **Step 1: Write the failing regression test**

```ts
test("reduceOperation rejects an unsupported operation type", () => {
  const operation = { type: "unsupported" } as unknown as Operation;

  assert.throws(
    () => reduceOperation(blankProject(), operation),
    new Error("Unsupported project operation: unsupported"),
  );
});
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
node --disable-warning=ExperimentalWarning --test --test-name-pattern='reduceOperation rejects an unsupported operation type' test/project.test.ts
```

Expected: FAIL because the current exhaustive switch returns `undefined` instead of throwing.

- [ ] **Step 3: Add the minimum exhaustive fallthrough**

Add after the switch in `reduceOperation`:

```ts
  const unreachable: never = operation;
  const type = (unreachable as { readonly type?: unknown }).type;
  throw new Error(`Unsupported project operation: ${String(type)}`);
```

- [ ] **Step 4: Run the focused test and project suite to verify GREEN**

```bash
node --disable-warning=ExperimentalWarning --test --test-name-pattern='reduceOperation rejects an unsupported operation type' test/project.test.ts
pnpm test:project
```

Expected: both commands pass.

- [ ] **Step 5: Commit**

```bash
git add src/project/reducer.ts test/project.test.ts
git commit -m "test: require exhaustive project operation routing"
```

### Task 2: Extract operation unions and reducers by domain

**Files:**
- Create: `src/project/operations/project.ts`
- Create: `src/project/operations/track.ts`
- Create: `src/project/operations/pattern.ts`
- Create: `src/project/operations/arrangement.ts`
- Create: `src/project/operations/drum-hits.ts`
- Create: `src/project/operations/synth-notes.ts`
- Create: `src/project/operations/shared.ts`
- Modify: `src/project/commands.ts`
- Modify: `src/project/reducer.ts`

**Interfaces:**
- Consumes: `Project`, `Reduction`, `ChangeSummary`, and `emptyChangeSummary()`
- Produces: `ProjectOperation`, `TrackOperation`, `PatternOperation`, `ArrangementOperation`, `DrumHitOperation`, `SynthNoteOperation`, and one reducer per union

- [ ] **Step 1: Record the green refactor baseline**

```bash
pnpm test:project
pnpm typecheck
```

Expected: both commands pass before moving code.

- [ ] **Step 2: Create the shared reducer helpers**

Move the existing implementations and export these functions:

```ts
export const isJsonEqual = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

export const withChanges = (
  changes: Partial<{
    readonly created: Partial<ChangeSummary["created"]>;
    readonly updated: Partial<ChangeSummary["updated"]>;
    readonly deleted: Partial<ChangeSummary["deleted"]>;
  }>,
): ChangeSummary => {
  const empty = emptyChangeSummary();
  return {
    created: { ...empty.created, ...changes.created },
    updated: { ...empty.updated, ...changes.updated },
    deleted: { ...empty.deleted, ...changes.deleted },
  };
};

export const replacePattern = (project: Project, updatedPattern: Pattern): Project => ({
  ...project,
  patterns: project.patterns.map((pattern) =>
    pattern.id === updatedPattern.id ? updatedPattern : pattern),
});

export const unsupportedOperation = (operation: never): never => {
  const type = (operation as { readonly type?: unknown }).type;
  throw new Error(`Unsupported project operation: ${String(type)}`);
};
```

`unsupportedOperation` retains the message established in Task 1.

- [ ] **Step 3: Define the six domain unions**

Move every existing union member verbatim from `commands.ts` according to its discriminant prefix. For example, `project.ts` contains:

```ts
export type ProjectOperation = {
  readonly type: "project.update";
  readonly changes: {
    readonly name?: string;
    readonly bpm?: number;
    readonly masterVolumeDb?: number;
  };
};
```

`track.ts`, `pattern.ts`, `arrangement.ts`, `drum-hits.ts`, and `synth-notes.ts` contain the exact current members for their prefixes. Do not rename fields, alter optionality, or change discriminant strings.

- [ ] **Step 4: Move each domain switch into its module**

Each module exports one pure reducer and ends with the shared assertion. The complete project reducer demonstrates the required structure:

```ts
export function reduceProjectOperation(
  project: Project,
  operation: ProjectOperation,
): Reduction {
  switch (operation.type) {
    case "project.update": {
      const candidate: Project = {
        ...project,
        ...(operation.changes.name === undefined ? {} : { name: operation.changes.name }),
        ...(operation.changes.bpm === undefined ? {} : { bpm: operation.changes.bpm }),
        ...(operation.changes.masterVolumeDb === undefined
          ? {}
          : { masterVolumeDb: operation.changes.masterVolumeDb }),
      };
      if (isJsonEqual(project, candidate)) {
        return { project, changes: emptyChangeSummary() };
      }
      return {
        project: candidate,
        changes: withChanges({ updated: { projectIds: [project.id] } }),
      };
    }
  }
  return unsupportedOperation(operation);
}
```

The other five modules use the same switch structure with their corresponding existing case bodies moved verbatim. For `track.reorder`, replace its call to project-wide diffing with the equivalent focused result:

```ts
return {
  project: candidate,
  changes: withChanges({ updated: { projectIds: [project.id] } }),
};
```

Preserve candidate construction, no-op identity checks, change summaries, collection order, and immutable array operations.

- [ ] **Step 5: Compose the public union in `commands.ts`**

```ts
export type Operation =
  | ProjectOperation
  | TrackOperation
  | PatternOperation
  | ArrangementOperation
  | DrumHitOperation
  | SynthNoteOperation;
```

Use type-only imports and re-export all six domain union types from `commands.ts`.

- [ ] **Step 6: Replace the central implementation with exhaustive routing**

Keep `summarizeProjectDiff` and its private diff helpers in `reducer.ts`. Route every discriminant explicitly:

```ts
export function reduceOperation(project: Project, operation: Operation): Reduction {
  switch (operation.type) {
    case "project.update":
      return reduceProjectOperation(project, operation);
    case "track.create":
    case "track.update":
    case "track.delete":
    case "track.reorder":
      return reduceTrackOperation(project, operation);
    case "pattern.create":
    case "pattern.duplicate":
    case "pattern.update":
    case "pattern.delete":
      return reducePatternOperation(project, operation);
    case "arrangement.place":
    case "arrangement.update":
    case "arrangement.delete":
      return reduceArrangementOperation(project, operation);
    case "drum-hits.add":
    case "drum-hits.update":
    case "drum-hits.delete":
      return reduceDrumHitOperation(project, operation);
    case "synth-notes.add":
    case "synth-notes.update":
    case "synth-notes.delete":
      return reduceSynthNoteOperation(project, operation);
  }
  return unsupportedOperation(operation);
}
```

- [ ] **Step 7: Verify the behavior-preserving refactor**

```bash
pnpm test:project
pnpm typecheck
```

Expected: all tests pass and typecheck reports zero errors.

- [ ] **Step 8: Commit**

```bash
git add src/project/commands.ts src/project/reducer.ts src/project/operations
git commit -m "refactor: split project reducers by domain"
```

### Task 3: Split the combined project tests by responsibility

**Files:**
- Create: `test/project-fixtures.ts`
- Create: `test/project-operation.test.ts`
- Create: `test/track-operation.test.ts`
- Create: `test/pattern-operation.test.ts`
- Create: `test/arrangement-operation.test.ts`
- Create: `test/drum-hit-operation.test.ts`
- Create: `test/synth-note-operation.test.ts`
- Create: `test/project-reducer.test.ts`
- Create: `test/project-service.test.ts`
- Delete: `test/project.test.ts`

**Interfaces:**
- Consumes: the unchanged exports from `src/project/index.ts`
- Produces: focused test files containing all 61 existing tests plus the routing regression

- [ ] **Step 1: Extract shared fixtures without changing values**

Move and export the existing implementations from lines 13–141:

```ts
export const id: (value: number) => string;
export const blankProject: () => Project;
export const basicDrumTrack: () => Track;
export const bassTrack: () => Track;
export const createBassTrackCommand: (commandId: string) => Command;
export const updateProjectNameCommand: (commandId: string, name: string) => Command;
export const createTestService: (initialProject: Project) => ProjectService;
export const projectWithBasicDrums: () => Project;
export const projectWithBassAndDrums: () => Project;
export const projectWithLead: () => Project;
```

Use named imports in each test file. Do not add a fixture class, barrel file, or new test framework.

- [ ] **Step 2: Move reducer tests into domain files**

Move test bodies verbatim using this ownership map:

| Test file | Existing tests |
| --- | --- |
| `project-operation.test.ts` | the two `project.update` tests |
| `track-operation.test.ts` | `track.create`, `track.update`, both reorder tests, and both delete tests |
| `pattern-operation.test.ts` | the five `pattern.*` tests plus embedded-event source-order coverage |
| `arrangement-operation.test.ts` | the four `arrangement.*` tests |
| `drum-hit-operation.test.ts` | drum add/update/delete and empty-add identity coverage |
| `synth-note-operation.test.ts` | synth add/update/delete and empty-delete identity coverage |
| `project-reducer.test.ts` | unsupported routing, shared event immutability/update-field protection, `mergeChangeSummaries`, and both `summarizeProjectDiff` tests |

Split any test that asserts both drum-hit and synth-note behavior into two domain tests, preserving all assertions.

- [ ] **Step 3: Move service and cross-domain behavior tests**

Move all remaining tests to `project-service.test.ts`: trusted inputs, callback binding, direct and batch dispatch, failure atomicity, deduplication, detached/serializable history, undo/redo, restore, retention, revision, replay, mixed-domain batches, and agent metadata.

- [ ] **Step 4: Verify test inventory and behavior**

```bash
rg '^test\(' test/project*.test.ts test/*-operation.test.ts | wc -l
pnpm test:project
pnpm typecheck
```

Expected: at least 62 tests, zero test failures, and zero type errors. Compare test names before and after; only intentional mixed-domain splits may add names.

- [ ] **Step 5: Commit**

```bash
git add test
git commit -m "test: organize project coverage by domain"
```

### Task 4: Verify the complete change and prepare the PR

**Files:**
- Modify only files required by failures found during verification

**Interfaces:**
- Consumes: the completed branch and issue #7 acceptance criteria
- Produces: a clean, reviewed branch ready to push

- [ ] **Step 1: Inspect the final diff and serialized shapes**

```bash
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git diff origin/main...HEAD -- src/project test
```

Confirm every original discriminant and payload field remains present and `ProjectService` is unchanged.

- [ ] **Step 2: Run all required verification**

```bash
pnpm test:project
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

Expected: every command exits 0 with no test failures, type errors, lint errors, or build errors.

- [ ] **Step 3: Request code review and address findings**

Review `origin/main..HEAD` against issue #7 and this plan. Fix Critical and Important findings, repeat the relevant tests, and commit only necessary corrections.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin codex/issue-7-domain-reducers
gh pr create --base main --head codex/issue-7-domain-reducers --title "Refactor project operations into domain reducers" --body $'## Summary\n\n- split serialized project operations and reducers into six domain modules\n- keep the public operation shape and service behavior unchanged\n- organize reducer coverage into focused domain test files\n\n## Verification\n\n- pnpm test:project\n- pnpm typecheck\n- pnpm test\n- pnpm lint\n- pnpm build\n\nCloses #7'
```

Use a complete PR body summarizing the domain split, test organization, and exact verification commands.
