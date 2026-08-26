# Project Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete framework-free AgentDAW project model, mutation commands, atomic batches, snapshot history, undo, redo, and restore.

**Architecture:** Plain read-only TypeScript data enters one pure reducer that validates and returns a new project plus an explicit change summary. A small command-service closure owns current state, a bounded snapshot timeline, and a bounded successful-command cache; direct operations, batches, and restore all commit through that boundary.

**Tech Stack:** Node.js 23.6+, strict TypeScript, ECMAScript modules, Node's built-in test runner; no runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-25-project-domain-design.md`

## Global Constraints

- Project data and retained history must remain JSON-serializable and structured-clone-compatible.
- The reducer must not mutate its project, operation, or sound-catalog inputs.
- All IDs are caller-allocated UUID strings; duplicate-pattern operations provide fresh pattern and event IDs.
- Fixed caps: 16 tracks, 128 patterns, 512 events per pattern, 512 arrangement clips, 256 arrangement bars, 100 operations per batch, 100 history entries, and 100 successful command outcomes.
- Track deletion cascades to owned patterns and their clips; pattern deletion cascades to its clips.
- No React, WebMCP, IndexedDB, audio, Immer, Redux, Zustand, test framework, validation framework, or linter is added.
- Expected domain failures return structured error information and never mutate service state; unexpected programmer errors propagate.

---

## File map

| File | Responsibility |
|---|---|
| `package.json` | Module mode, Node floor, test and typecheck commands, development dependencies. |
| `package-lock.json` | Reproducible development dependency resolution. |
| `tsconfig.json` | Strict no-emit TypeScript checks for source and tests. |
| `src/project/model.ts` | Project entities, catalog, identifiers, caps, and project validation. |
| `src/project/errors.ts` | Stable error codes, specific error classes, and serializable error shape. |
| `src/project/commands.ts` | Operation union, command envelopes, history records, summaries, and results. |
| `src/project/reducer.ts` | Pure operation dispatch and immutable project mutation. |
| `src/project/service.ts` | Atomic dispatch, deduplication, commits, history cursor, undo, redo, and restore. |
| `src/project/index.ts` | Public exports only. |
| `test/project.test.ts` | Domain behavior tests using Node's built-in runner. |

---

### Task 1: Strict TypeScript foundation and project validation

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.json`
- Create: `src/project/model.ts`
- Create: `src/project/errors.ts`
- Create: `src/project/index.ts`
- Create: `test/project.test.ts`

**Interfaces:**
- Produces: `Project`, `Track`, `Pattern`, `DrumHit`, `SynthNote`, `ArrangementClip`, `SoundCatalog`, `PROJECT_CAPS`, and `validateProject(project, catalog): void`.
- Produces: `DomainError`, `InvalidInputError`, `NotFoundError`, `ConflictError`, `LimitExceededError`, and `DomainErrorInfo`.
- Consumed by: every later task.

- [ ] **Step 1: Add the approved development toolchain**

Create `package.json` with no runtime dependencies:

```json
{
  "name": "agent-daw",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=23.6"
  },
  "scripts": {
    "test": "node --test test/*.test.ts",
    "typecheck": "tsc --noEmit"
  }
}
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "exactOptionalPropertyTypes": true,
    "forceConsistentCasingInFileNames": true,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "noEmit": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitOverride": true,
    "noUncheckedIndexedAccess": true,
    "strict": true,
    "target": "ES2022"
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

Run: `npm install --save-dev typescript @types/node`

Expected: `package-lock.json` is created and only `typescript` plus `@types/node` are installed as direct development dependencies.

- [ ] **Step 2: Write the failing model-validation tests**

Create `test/project.test.ts` with deterministic UUID and catalog fixtures, then assert valid and invalid initial state:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  InvalidInputError,
  type Project,
  type SoundCatalog,
  validateProject,
} from "../src/project/index.ts";

const id = (value: number): string =>
  `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;

const catalog: SoundCatalog = {
  drumKits: [{ id: "kit.basic", soundIds: ["kick", "snare", "hat"] }],
  synthPresets: [{ id: "synth.bass" }, { id: "synth.lead" }],
};

const blankProject = (): Project => ({
  schemaVersion: 1,
  id: id(1),
  name: "Untitled",
  bpm: 120,
  masterVolumeDb: 0,
  tracks: [],
  patterns: [],
  arrangement: [],
});

test("validateProject accepts a blank project", () => {
  assert.doesNotThrow(() => validateProject(blankProject(), catalog));
});

test("validateProject rejects a non-finite BPM with its field path", () => {
  const project = { ...blankProject(), bpm: Number.NaN };

  assert.throws(
    () => validateProject(project, catalog),
    (error: unknown) =>
      error instanceof InvalidInputError && error.info.path === "project.bpm",
  );
});

const invalidProjects: readonly [string, Project, string][] = [
  ["blank name", { ...blankProject(), name: "   " }, "project.name"],
  ["low BPM", { ...blankProject(), bpm: 39 }, "project.bpm"],
  ["high BPM", { ...blankProject(), bpm: 241 }, "project.bpm"],
  ["quiet master", { ...blankProject(), masterVolumeDb: -61 }, "project.masterVolumeDb"],
  ["loud master", { ...blankProject(), masterVolumeDb: 1 }, "project.masterVolumeDb"],
  ["invalid UUID", { ...blankProject(), id: "project-1" }, "project.id"],
];

for (const [name, project, path] of invalidProjects) {
  test(`validateProject rejects ${name}`, () => {
    assert.throws(
      () => validateProject(project, catalog),
      (error: unknown) =>
        error instanceof InvalidInputError && error.info.path === path,
    );
  });
}
```

- [ ] **Step 3: Run the focused tests and confirm failure**

Run: `node --test --test-name-pattern="validateProject" test/project.test.ts`

Expected: FAIL because `src/project/index.ts` does not exist.

- [ ] **Step 4: Implement model types, caps, errors, and complete-project validation**

Define these model shapes in `src/project/model.ts`:

```ts
export type EntityId = string;
export type TrackKind = "drum" | "synth";
export type PatternLengthBars = 1 | 2 | 4;

export interface DrumHit {
  readonly id: EntityId;
  readonly soundId: string;
  readonly startStep: number;
}

export interface SynthNote {
  readonly id: EntityId;
  readonly midiNote: number;
  readonly startStep: number;
  readonly lengthSteps: number;
}

export interface DrumPattern {
  readonly id: EntityId;
  readonly trackId: EntityId;
  readonly name: string;
  readonly kind: "drum";
  readonly lengthBars: PatternLengthBars;
  readonly events: readonly DrumHit[];
}

export interface SynthPattern {
  readonly id: EntityId;
  readonly trackId: EntityId;
  readonly name: string;
  readonly kind: "synth";
  readonly lengthBars: PatternLengthBars;
  readonly events: readonly SynthNote[];
}

export type Pattern = DrumPattern | SynthPattern;

export interface Track {
  readonly id: EntityId;
  readonly name: string;
  readonly kind: TrackKind;
  readonly instrumentId: string;
  readonly volumeDb: number;
  readonly pan: number;
  readonly muted: boolean;
  readonly soloed: boolean;
}

export interface ArrangementClip {
  readonly id: EntityId;
  readonly patternId: EntityId;
  readonly startBar: number;
  readonly repeatCount: number;
}

export interface Project {
  readonly schemaVersion: 1;
  readonly id: EntityId;
  readonly name: string;
  readonly bpm: number;
  readonly masterVolumeDb: number;
  readonly tracks: readonly Track[];
  readonly patterns: readonly Pattern[];
  readonly arrangement: readonly ArrangementClip[];
}

export interface SoundCatalog {
  readonly drumKits: readonly {
    readonly id: string;
    readonly soundIds: readonly string[];
  }[];
  readonly synthPresets: readonly { readonly id: string }[];
}

export const PROJECT_CAPS = {
  maxTracks: 16,
  maxPatterns: 128,
  maxEventsPerPattern: 512,
  maxArrangementClips: 512,
  maxArrangementBars: 256,
  maxOperationsPerBatch: 100,
  maxHistoryEntries: 100,
  maxSuccessfulCommands: 100,
} as const;

export function validateProject(project: Project, catalog: SoundCatalog): void;
```

Define specific errors in `src/project/errors.ts`:

```ts
export type DomainErrorCode =
  | "invalid_input"
  | "not_found"
  | "conflict"
  | "limit_exceeded";

export interface DomainErrorInfo {
  readonly code: DomainErrorCode;
  readonly message: string;
  readonly path?: string;
  readonly relatedIds?: readonly string[];
  readonly batchIndex?: number;
}

export class DomainError extends Error {
  readonly info: DomainErrorInfo;

  constructor(info: DomainErrorInfo) {
    super(info.message);
    this.name = new.target.name;
    this.info = info;
  }
}

type ErrorDetails = Omit<DomainErrorInfo, "code">;

export class InvalidInputError extends DomainError {
  constructor(details: ErrorDetails) {
    super({ ...details, code: "invalid_input" });
  }
}

export class NotFoundError extends DomainError {
  constructor(details: ErrorDetails) {
    super({ ...details, code: "not_found" });
  }
}

export class ConflictError extends DomainError {
  constructor(details: ErrorDetails) {
    super({ ...details, code: "conflict" });
  }
}

export class LimitExceededError extends DomainError {
  constructor(details: ErrorDetails) {
    super({ ...details, code: "limit_exceeded" });
  }
}
```

`validateProject` must check schema version, UUID format, trimmed name lengths, all finite numeric ranges, array caps, unique IDs within each entity collection, track instruments, pattern ownership/kind, event IDs and bounds, drum sounds, clip references, clip end bar, and same-track arrangement overlap. Use small file-local assertion helpers that throw the specific errors above.

Export the public types and functions from `src/project/index.ts`.

- [ ] **Step 5: Run tests and strict type checking**

Run: `node --test --test-name-pattern="validateProject" test/project.test.ts`

Expected: 8 tests PASS.

Run: `npm run typecheck`

Expected: PASS with no diagnostics.

- [ ] **Step 6: Commit the foundation**

```bash
git add package.json package-lock.json tsconfig.json src/project test/project.test.ts
git commit -m "feat: add project domain model"
```

---

### Task 2: Project and track operations with cascading deletion

**Files:**
- Create: `src/project/commands.ts`
- Create: `src/project/reducer.ts`
- Modify: `src/project/index.ts`
- Modify: `test/project.test.ts`

**Interfaces:**
- Consumes: `Project`, `Track`, `SoundCatalog`, `validateProject`, and domain errors from Task 1.
- Produces: `Operation`, `ChangeSummary`, `Reduction`, and `reduceOperation(project, operation, catalog): Reduction`.
- Produces operation variants: `project.update`, `track.create`, `track.update`, and `track.delete`.

- [ ] **Step 1: Write failing project and track reducer tests**

Append tests that cover project updates, track creation/update, invalid instruments, and cascade deletion. The cascade fixture must contain two tracks, a pattern on each, and clips referencing both; deleting one track must preserve the unrelated track, pattern, and clip:

```ts
const basicDrumTrack = (): Track => ({
  id: id(10),
  name: "Drums",
  kind: "drum",
  instrumentId: "kit.basic",
  volumeDb: 0,
  pan: 0,
  muted: false,
  soloed: false,
});

const projectWithBasicDrums = (): Project => ({
  ...blankProject(),
  tracks: [basicDrumTrack()],
  patterns: [{
    id: id(11),
    trackId: id(10),
    name: "Beat",
    kind: "drum",
    lengthBars: 1,
    events: [{ id: id(13), soundId: "kick", startStep: 0 }],
  }],
  arrangement: [{ id: id(12), patternId: id(11), startBar: 0, repeatCount: 1 }],
});

const projectWithBassAndDrums = (): Project => ({
  ...projectWithBasicDrums(),
  tracks: [
    basicDrumTrack(),
    {
      id: id(20),
      name: "Bass",
      kind: "synth",
      instrumentId: "synth.bass",
      volumeDb: 0,
      pan: 0,
      muted: false,
      soloed: false,
    },
  ],
  patterns: [
    ...projectWithBasicDrums().patterns,
    {
      id: id(21),
      trackId: id(20),
      name: "Bass line",
      kind: "synth",
      lengthBars: 1,
      events: [{ id: id(23), midiNote: 36, startStep: 0, lengthSteps: 4 }],
    },
  ],
  arrangement: [
    ...projectWithBasicDrums().arrangement,
    { id: id(22), patternId: id(21), startBar: 0, repeatCount: 1 },
  ],
});
```

```ts
test("track.delete removes its patterns and arrangement clips", () => {
  const project = projectWithBassAndDrums();

  const result = reduceOperation(
    project,
    { type: "track.delete", trackId: id(10) },
    catalog,
  );

  assert.deepEqual(result.project.tracks.map(({ id: trackId }) => trackId), [id(20)]);
  assert.deepEqual(result.project.patterns.map(({ id: patternId }) => patternId), [id(21)]);
  assert.deepEqual(result.project.arrangement.map(({ id: clipId }) => clipId), [id(22)]);
  assert.deepEqual(result.changes.deleted.trackIds, [id(10)]);
  assert.deepEqual(result.changes.deleted.patternIds, [id(11)]);
  assert.deepEqual(result.changes.deleted.drumHitIds, [id(13)]);
  assert.deepEqual(result.changes.deleted.arrangementClipIds, [id(12)]);
  assert.equal(project.tracks.length, 2);
});

test("track.update rejects a kit that cannot play existing hits", () => {
  const project = projectWithBasicDrums();
  const incompatibleCatalog: SoundCatalog = {
    ...catalog,
    drumKits: [...catalog.drumKits, { id: "kit.no-kick", soundIds: ["hat"] }],
  };

  assert.throws(
    () =>
      reduceOperation(
        project,
        {
          type: "track.update",
          trackId: id(10),
          changes: { instrumentId: "kit.no-kick" },
        },
        incompatibleCatalog,
      ),
    ConflictError,
  );
});
```

Add separate assertions for a valid `project.update`, a no-op update returning the identical `Project` reference, creating a synth track, updating mixer fields, duplicate IDs, a missing delete target, and the 17th track cap.

- [ ] **Step 2: Run the focused reducer tests and confirm failure**

Run: `node --test --test-name-pattern="project.update|track" test/project.test.ts`

Expected: FAIL because `reduceOperation` and operation types are missing.

- [ ] **Step 3: Define operation and change-summary contracts**

In `src/project/commands.ts`, define exact update fields rather than open-ended partial entities:

```ts
export interface EntityIds {
  readonly projectIds: readonly string[];
  readonly trackIds: readonly string[];
  readonly patternIds: readonly string[];
  readonly drumHitIds: readonly string[];
  readonly synthNoteIds: readonly string[];
  readonly arrangementClipIds: readonly string[];
}

export interface ChangeSummary {
  readonly created: EntityIds;
  readonly updated: EntityIds;
  readonly deleted: EntityIds;
}

export type Operation =
  | {
      readonly type: "project.update";
      readonly changes: {
        readonly name?: string;
        readonly bpm?: number;
        readonly masterVolumeDb?: number;
      };
    }
  | { readonly type: "track.create"; readonly track: Track }
  | {
      readonly type: "track.update";
      readonly trackId: string;
      readonly changes: {
        readonly name?: string;
        readonly instrumentId?: string;
        readonly volumeDb?: number;
        readonly pan?: number;
        readonly muted?: boolean;
        readonly soloed?: boolean;
      };
    }
  | { readonly type: "track.delete"; readonly trackId: string };

export interface Reduction {
  readonly project: Project;
  readonly changes: ChangeSummary;
}
```

Export `emptyChangeSummary()` and `mergeChangeSummaries(summaries): ChangeSummary`, deduplicating IDs while preserving first-seen order.

- [ ] **Step 4: Implement the minimal pure reducer cases**

Implement:

```ts
export function summarizeProjectDiff(before: Project, after: Project): ChangeSummary;

export function reduceOperation(
  project: Project,
  operation: Operation,
  catalog: SoundCatalog,
): Reduction;
```

Each case creates a candidate using object spreads, `map`, and `filter`, validates it with `validateProject`, and returns an explicit summary. `track.delete` computes owned pattern IDs, their event IDs, and referencing clip IDs before removing them; it reports every cascaded ID. No-op updates return the original `Project` reference and an empty summary.

Implement `summarizeProjectDiff` for restore in Task 6. It compares IDs in project, track, pattern, event, and arrangement collections, classifying absent/present IDs as created or deleted and equal IDs with changed values as updated. Keep array ordering from the relevant `after` collection for created/updated IDs and the `before` collection for deleted IDs.

- [ ] **Step 5: Run focused and complete checks**

Run: `node --test --test-name-pattern="project.update|track" test/project.test.ts`

Expected: all focused tests PASS.

Run: `npm test && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit project and track commands**

```bash
git add src/project test/project.test.ts
git commit -m "feat: add project and track commands"
```

---

### Task 3: Pattern, drum-hit, and synth-note operations

**Files:**
- Modify: `src/project/commands.ts`
- Modify: `src/project/reducer.ts`
- Modify: `src/project/index.ts`
- Modify: `test/project.test.ts`

**Interfaces:**
- Consumes: `reduceOperation`, model unions, and change summaries from Tasks 1–2.
- Extends `Operation` with pattern create/duplicate/update/delete plus add/update/delete variants for drum hits and synth notes.
- Keeps pattern `trackId` and `kind` immutable.

- [ ] **Step 1: Write failing pattern and event tests**

Cover all ten operations in this task. Add this synth fixture and include the critical cases below:

```ts
const projectWithLead = (): Project => ({
  ...blankProject(),
  tracks: [{
    id: id(40),
    name: "Lead",
    kind: "synth",
    instrumentId: "synth.lead",
    volumeDb: 0,
    pan: 0,
    muted: false,
    soloed: false,
  }],
  patterns: [{
    id: id(41),
    trackId: id(40),
    name: "Lead phrase",
    kind: "synth",
    lengthBars: 1,
    events: [{ id: id(42), midiNote: 60, startStep: 0, lengthSteps: 4 }],
  }],
  arrangement: [],
});
```

```ts
test("pattern.duplicate copies content with supplied fresh IDs", () => {
  const project = projectWithBasicDrums();

  const result = reduceOperation(
    project,
    {
      type: "pattern.duplicate",
      patternId: id(11),
      duplicatePatternId: id(30),
      duplicateName: "Drums copy",
      duplicateEventIds: [id(31)],
    },
    catalog,
  );

  const duplicate = result.project.patterns.find(({ id: patternId }) => patternId === id(30));
  assert.equal(duplicate?.trackId, id(10));
  assert.equal(duplicate?.events[0]?.id, id(31));
  assert.equal(duplicate?.events[0]?.startStep, 0);
});

test("pattern.delete removes referencing clips but preserves the track", () => {
  const project = projectWithBasicDrums();
  const result = reduceOperation(
    project,
    { type: "pattern.delete", patternId: id(11) },
    catalog,
  );

  assert.equal(result.project.tracks.length, 1);
  assert.equal(result.project.patterns.length, 0);
  assert.equal(result.project.arrangement.length, 0);
  assert.deepEqual(result.changes.deleted.arrangementClipIds, [id(12)]);
});

test("synth-note update rejects a note ending beyond its pattern", () => {
  const project = projectWithLead();

  assert.throws(
    () =>
      reduceOperation(
        project,
        {
          type: "synth-notes.update",
          patternId: id(41),
          updates: [{ noteId: id(42), changes: { startStep: 15, lengthSteps: 2 } }],
        },
        catalog,
      ),
    InvalidInputError,
  );
});
```

Also assert: create pattern kind matches track; duplicate ID count equals copied event count; update changes only name/length; drum hits add/update/delete; synth notes add/update/delete; event commands reject the wrong pattern kind; multi-event operations are atomic; event cap 512; all no-op and input immutability behavior.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `node --test --test-name-pattern="pattern|drum-hit|synth-note" test/project.test.ts`

Expected: FAIL because the operation variants are not in `Operation`.

- [ ] **Step 3: Add exact operation variants**

Extend `Operation` with:

```ts
| { readonly type: "pattern.create"; readonly pattern: Pattern }
| {
    readonly type: "pattern.duplicate";
    readonly patternId: string;
    readonly duplicatePatternId: string;
    readonly duplicateName: string;
    readonly duplicateEventIds: readonly string[];
  }
| {
    readonly type: "pattern.update";
    readonly patternId: string;
    readonly changes: { readonly name?: string; readonly lengthBars?: PatternLengthBars };
  }
| { readonly type: "pattern.delete"; readonly patternId: string }
| { readonly type: "drum-hits.add"; readonly patternId: string; readonly hits: readonly DrumHit[] }
| {
    readonly type: "drum-hits.update";
    readonly patternId: string;
    readonly updates: readonly {
      readonly hitId: string;
      readonly changes: { readonly soundId?: string; readonly startStep?: number };
    }[];
  }
| { readonly type: "drum-hits.delete"; readonly patternId: string; readonly hitIds: readonly string[] }
| { readonly type: "synth-notes.add"; readonly patternId: string; readonly notes: readonly SynthNote[] }
| {
    readonly type: "synth-notes.update";
    readonly patternId: string;
    readonly updates: readonly {
      readonly noteId: string;
      readonly changes: {
        readonly midiNote?: number;
        readonly startStep?: number;
        readonly lengthSteps?: number;
      };
    }[];
  }
| { readonly type: "synth-notes.delete"; readonly patternId: string; readonly noteIds: readonly string[] }
```

- [ ] **Step 4: Implement pattern and event reducer cases**

Add file-local typed lookup helpers that throw `NotFoundError`, construct complete candidate patterns, and then call `validateProject`. Reject duplicate IDs in update/delete lists rather than applying them twice. Pattern deletion collects its event and referencing-clip IDs before filtering them all. Duplicate-pattern constructs copied events by array position using the supplied fresh IDs and never copies arrangement clips.

- [ ] **Step 5: Run focused and complete checks**

Run: `node --test --test-name-pattern="pattern|drum-hit|synth-note" test/project.test.ts`

Expected: focused tests PASS.

Run: `npm test && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit pattern and event commands**

```bash
git add src/project test/project.test.ts
git commit -m "feat: add pattern and event commands"
```

---

### Task 4: Arrangement operations and duration-dependent validation

**Files:**
- Modify: `src/project/commands.ts`
- Modify: `src/project/reducer.ts`
- Modify: `src/project/index.ts`
- Modify: `test/project.test.ts`

**Interfaces:**
- Consumes: complete model and reducer behavior from Tasks 1–3.
- Extends `Operation` with `arrangement.place`, `arrangement.update`, and `arrangement.delete`.
- Enforces clip duration as referenced pattern bars multiplied by repeat count.

- [ ] **Step 1: Write failing arrangement tests**

Add success tests for place, move/repeat/pattern update, and delete. Add failure tests for missing pattern, same-track overlap, bar 256 overflow, and a pattern-length update that makes existing clips overlap:

```ts
const projectWithAdjacentOneBarClips = (): Project => ({
  ...projectWithBasicDrums(),
  arrangement: [
    { id: id(12), patternId: id(11), startBar: 0, repeatCount: 1 },
    { id: id(51), patternId: id(11), startBar: 1, repeatCount: 1 },
  ],
});
```

```ts
test("arrangement rejects overlap on the same track", () => {
  const project = projectWithBasicDrums();

  assert.throws(
    () =>
      reduceOperation(
        project,
        {
          type: "arrangement.place",
          clip: { id: id(50), patternId: id(11), startBar: 0, repeatCount: 1 },
        },
        catalog,
      ),
    ConflictError,
  );
});

test("pattern length update rejects newly overlapping arrangement clips", () => {
  const project = projectWithAdjacentOneBarClips();

  assert.throws(
    () =>
      reduceOperation(
        project,
        { type: "pattern.update", patternId: id(11), changes: { lengthBars: 2 } },
        catalog,
      ),
    (error: unknown) =>
      error instanceof ConflictError && error.info.relatedIds?.length === 2,
  );
});
```

Assert that different tracks may overlap, adjacent clip boundaries are valid, update ignores the clip being updated, and deleting an arrangement clip has no cascade.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `node --test --test-name-pattern="arrangement|pattern length" test/project.test.ts`

Expected: FAIL because arrangement operations are missing.

- [ ] **Step 3: Add arrangement operation types**

```ts
| { readonly type: "arrangement.place"; readonly clip: ArrangementClip }
| {
    readonly type: "arrangement.update";
    readonly clipId: string;
    readonly changes: {
      readonly patternId?: string;
      readonly startBar?: number;
      readonly repeatCount?: number;
    };
  }
| { readonly type: "arrangement.delete"; readonly clipId: string }
```

- [ ] **Step 4: Implement arrangement reduction through shared project validation**

Use immutable array operations to create candidates. Keep all overlap and duration rules in `validateProject` so placement, clip updates, pattern-length changes, initial loads, and later restore validation share one source of truth. Report the clip ID under the correct created, updated, or deleted summary.

- [ ] **Step 5: Run focused and complete checks**

Run: `node --test --test-name-pattern="arrangement|pattern length" test/project.test.ts`

Expected: focused tests PASS.

Run: `npm test && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit arrangement behavior**

```bash
git add src/project test/project.test.ts
git commit -m "feat: add arrangement commands"
```

---

### Task 5: Atomic command dispatch and idempotency

**Files:**
- Modify: `src/project/commands.ts`
- Create: `src/project/service.ts`
- Modify: `src/project/index.ts`
- Modify: `test/project.test.ts`

**Interfaces:**
- Consumes: `reduceOperation`, `mergeChangeSummaries`, and all operation types.
- Produces: `Command`, `HistoryEntry`, `DispatchResult`, `ProjectService`, and `createProjectService(options): ProjectService`.
- Later Task 6 extends the same service with history controls and restore.

- [ ] **Step 1: Write failing service tests**

Test direct dispatch, an atomic mixed batch, indexed rollback, duplicate successful IDs, no-op deduplication, rejected-command retry, and the 100-operation cap:

```ts
const bassTrack = (): Track => ({
  id: id(20),
  name: "Bass",
  kind: "synth",
  instrumentId: "synth.bass",
  volumeDb: 0,
  pan: 0,
  muted: false,
  soloed: false,
});

const patternForMissingTrack = (): Pattern => ({
  id: id(31),
  trackId: id(999),
  name: "Orphan",
  kind: "synth",
  lengthBars: 1,
  events: [],
});

const createBassTrackCommand = (commandId: string): Command => ({
  kind: "operation",
  id: commandId,
  source: "manual",
  label: "Create bass",
  operation: { type: "track.create", track: bassTrack() },
});

const createTestService = (initialProject: Project): ProjectService => {
  let nextHistoryId = 700;
  let timestamp = 1_700_000_000_000;
  return createProjectService({
    initialProject,
    catalog,
    createHistoryId: () => id(nextHistoryId++),
    now: () => timestamp++,
  });
};
```

```ts
test("a failing batch leaves project and history unchanged", () => {
  const service = createTestService(blankProject());
  const result = service.dispatch({
    kind: "batch",
    id: id(100),
    source: "agent",
    label: "Build rhythm section",
    operations: [
      { type: "track.create", track: bassTrack() },
      { type: "pattern.create", pattern: patternForMissingTrack() },
    ],
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.batchIndex, 1);
  assert.deepEqual(service.getState().project, blankProject());
  assert.equal(service.getState().history.length, 0);
});

test("repeating a successful command ID returns its outcome without another commit", () => {
  const service = createTestService(blankProject());
  const command = createBassTrackCommand(id(101));
  const first = service.dispatch(command);
  const second = service.dispatch(command);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (second.ok) assert.equal(second.deduplicated, true);
  assert.equal(service.getState().project.tracks.length, 1);
  assert.equal(service.getState().history.length, 1);
});
```

The successful batch test must create a track, create its pattern, add notes, and place the pattern by referencing caller-allocated IDs from earlier batch members. Assert one history entry and one merged change summary.

- [ ] **Step 2: Run focused service tests and confirm failure**

Run: `node --test --test-name-pattern="batch|command ID|dispatch" test/project.test.ts`

Expected: FAIL because the service API is missing.

- [ ] **Step 3: Define command, history, and result contracts**

In `commands.ts`, add:

```ts
export type CommandSource = "manual" | "agent";

interface CommandMetadata {
  readonly id: string;
  readonly source: CommandSource;
  readonly label: string;
}

export type Command = CommandMetadata &
  (
    | { readonly kind: "operation"; readonly operation: Operation }
    | { readonly kind: "batch"; readonly operations: readonly Operation[] }
  );

export type HistoryAction =
  | { readonly kind: "operation"; readonly operation: Operation }
  | { readonly kind: "batch"; readonly operations: readonly Operation[] }
  | { readonly kind: "restore"; readonly targetEntryId: string };

export interface HistoryEntry {
  readonly id: string;
  readonly commandId: string;
  readonly source: CommandSource;
  readonly label: string;
  readonly createdAt: number;
  readonly action: HistoryAction;
  readonly before: Project;
  readonly after: Project;
  readonly changes: ChangeSummary;
}

export interface DispatchSuccess {
  readonly ok: true;
  readonly changed: boolean;
  readonly deduplicated: boolean;
  readonly project: Project;
  readonly historyEntry?: HistoryEntry;
  readonly changes: ChangeSummary;
}

export interface DispatchFailure {
  readonly ok: false;
  readonly project: Project;
  readonly error: DomainErrorInfo;
}

export type DispatchResult = DispatchSuccess | DispatchFailure;
```

Add `ProjectServiceState`, `ProjectService`, and explicit platform inputs:

```ts
export interface ProjectServiceState {
  readonly project: Project;
  readonly history: readonly HistoryEntry[];
  readonly historyCursor: number;
}

export interface ProjectService {
  getState(): ProjectServiceState;
  dispatch(command: Command): DispatchResult;
}

export interface ProjectServiceOptions {
  readonly initialProject: Project;
  readonly catalog: SoundCatalog;
  readonly createHistoryId: () => string;
  readonly now: () => number;
}

export function createProjectService(options: ProjectServiceOptions): ProjectService;
```

- [ ] **Step 4: Implement service dispatch with bounded deduplication**

Validate command metadata before reduction. Normalize a direct command to one operation. For a batch, reject zero operations and more than 100 operations, reduce sequentially against a local project, and annotate caught `DomainError` information with the current batch index. Do not catch non-domain errors.

On change, truncate redo entries after the current cursor, append one history entry, prune to 100, and set the cursor to the new final index. Cache the successful outcome metadata under the command ID whether it changed state or was a no-op. Keep the cache as a 100-entry insertion-ordered `Map`; remove the oldest key before adding entry 101.

On duplicate, return cached `changed`, `historyEntry`, and `changes`, set `deduplicated: true`, and pair them with the service's current project.

- [ ] **Step 5: Run focused and complete checks**

Run: `node --test --test-name-pattern="batch|command ID|dispatch" test/project.test.ts`

Expected: focused tests PASS.

Run: `npm test && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit command dispatch**

```bash
git add src/project test/project.test.ts
git commit -m "feat: add atomic command service"
```

---

### Task 6: Undo, redo, restore, and bounded history

**Files:**
- Modify: `src/project/commands.ts`
- Modify: `src/project/service.ts`
- Modify: `src/project/index.ts`
- Modify: `README.md`
- Modify: `test/project.test.ts`

**Interfaces:**
- Consumes: command service and history entry behavior from Task 5.
- Extends `ProjectService` with `undo()`, `redo()`, and `restore(command)`.
- Produces final public domain-package API.

- [ ] **Step 1: Write failing history-control tests**

Test undo, redo, both boundaries, redo invalidation, restore as a new entry, restore after undo, missing restore targets, no-op restore, and 100-entry pruning:

```ts
const updateProjectNameCommand = (commandId: string, name: string): Command => ({
  kind: "operation",
  id: commandId,
  source: "manual",
  label: `Rename project to ${name}`,
  operation: { type: "project.update", changes: { name } },
});
```

```ts
test("undo and redo replace the project from snapshots", () => {
  const service = createTestService(blankProject());
  service.dispatch(createBassTrackCommand(id(200)));

  const undone = service.undo();
  assert.equal(undone.ok, true);
  assert.equal(service.getState().project.tracks.length, 0);
  assert.equal(service.getState().historyCursor, -1);

  const redone = service.redo();
  assert.equal(redone.ok, true);
  assert.equal(service.getState().project.tracks.length, 1);
  assert.equal(service.getState().historyCursor, 0);
});

test("a new commit after undo discards the redo branch", () => {
  const service = createTestService(blankProject());
  service.dispatch(createBassTrackCommand(id(201)));
  service.dispatch(updateProjectNameCommand(id(202), "First branch"));
  service.undo();
  service.dispatch(updateProjectNameCommand(id(203), "Second branch"));

  assert.equal(service.getState().history.length, 2);
  assert.equal(service.getState().history[1]?.commandId, id(203));
  assert.equal(service.redo().ok, false);
});

test("restore commits a retained after-snapshot as a new action", () => {
  const service = createTestService(blankProject());
  const created = service.dispatch(createBassTrackCommand(id(204)));
  assert.equal(created.ok, true);
  if (!created.ok || !created.historyEntry) assert.fail("expected history entry");
  const targetEntryId = created.historyEntry.id;
  service.dispatch(updateProjectNameCommand(id(205), "Changed"));

  const restored = service.restore({
    id: id(206),
    source: "manual",
    label: "Restore bass version",
    targetEntryId,
  });

  assert.equal(restored.ok, true);
  assert.equal(service.getState().project.name, "Untitled");
  assert.equal(service.getState().history.at(-1)?.action.kind, "restore");
});
```

For retention, dispatch 101 distinct state-changing name updates and assert 100 entries remain, the cursor is 99, and the current project has the final name. Add a test that 101 successful no-op command IDs evict only the oldest deduplication outcome without affecting history.

- [ ] **Step 2: Run focused history tests and confirm failure**

Run: `node --test --test-name-pattern="undo|redo|restore|retention" test/project.test.ts`

Expected: FAIL because history controls are missing.

- [ ] **Step 3: Add history-control contracts**

```ts
export interface HistoryControlSuccess {
  readonly ok: true;
  readonly project: Project;
}

export interface HistoryControlUnavailable {
  readonly ok: false;
  readonly reason: "nothing_to_undo" | "nothing_to_redo";
  readonly project: Project;
}

export type HistoryControlResult =
  | HistoryControlSuccess
  | HistoryControlUnavailable;

export interface RestoreCommand {
  readonly id: string;
  readonly source: CommandSource;
  readonly label: string;
  readonly targetEntryId: string;
}

export interface ProjectService {
  getState(): ProjectServiceState;
  dispatch(command: Command): DispatchResult;
  undo(): HistoryControlResult;
  redo(): HistoryControlResult;
  restore(command: RestoreCommand): DispatchResult;
}
```

- [ ] **Step 4: Implement cursor movement and restore through the commit path**

Undo installs `history[historyCursor].before` then decrements the cursor. Redo reads `history[historyCursor + 1]`, installs its `after`, then increments. Boundaries return their explicit unavailable result without changing state.

Restore resolves the target before truncating a redo branch and validates its snapshot against the service catalog. A missing target returns `NotFoundError` information. If `JSON.stringify(target.after) === JSON.stringify(currentProject)`, cache and return a no-op. Otherwise compute its complete created/updated/deleted summary with `summarizeProjectDiff`, then commit it using `HistoryAction` `{ kind: "restore", targetEntryId }`, the standard history cap, and the standard successful-command cache.

- [ ] **Step 5: Update the README status**

Replace the current implementation-status paragraph with:

```markdown
## Status

Project-domain foundation implemented: strict model validation, complete command
surface, atomic batches, attributed snapshot history, undo, redo, and restore.
Audio and editor implementation are next.
```

- [ ] **Step 6: Run final verification**

Run: `npm test`

Expected: all tests PASS.

Run: `npm run typecheck`

Expected: PASS with no diagnostics.

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only Task 6 files are uncommitted.

- [ ] **Step 7: Commit completed domain package**

```bash
git add src/project test/project.test.ts README.md
git commit -m "feat: add project history controls"
```

- [ ] **Step 8: Inspect the complete milestone diff**

Run: `git diff 909640d..HEAD --stat && git log --oneline 909640d..HEAD`

Expected: the implementation plan, package/toolchain files, `src/project`, `test/project.test.ts`, and the README status changed; one plan commit plus six focused implementation commits are present.
