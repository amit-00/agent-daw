# AgentDAW WebMCP Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Expose AgentDAW's currently usable project inspection, editing, batching, and history capabilities through the browser WebMCP imperative API while keeping the visible UI, project state, validation, and history on one canonical path.

**Architecture:** Add pure canonical validation ahead of the trusted reducer, page-session revision and idempotent history controls to ProjectService, and a small WebMCP adapter that translates public snake_case intents into existing Operation values. A client bridge registers the completed tools against document.modelContext and executes them through the live Zustand store so agent edits immediately produce the same state and UI effects as manual edits.

**Tech Stack:** Strict TypeScript 6, React 19, Next.js 16, Zustand 5, native document.modelContext, native JSON Schema objects, Node test runner, Vitest, Testing Library.

**Spec:** docs/superpowers/specs/2026-09-02-webmcp-interface-design.md

## Global Constraints

- Do not add a dependency; define only the small draft WebMCP surface the application uses.
- Keep Project, Operation, ProjectService, existing history, and project caps authoritative.
- Write each failing test first and run its focused command before implementation.
- Keep reducer inputs trusted; validate at the manual UI and WebMCP boundaries.
- Public bars and steps are one-based; canonical bars and steps remain zero-based.
- Mutation request_id length is 1-128; batch label length is 1-80 after trimming.
- Direct event arrays contain 1-512 items; batches contain 2-100 public changes.
- Local refs match ^[A-Za-z][A-Za-z0-9_-]{0,63}$ and cannot point forward.
- Read limits default to 20 and cannot exceed 100; cursors cannot exceed 256 characters.
- Register only the 36 usable tools listed below. Do not register play, pause, stop, seek, export_wav, or any deferred candidate.
- Return structured values directly from execute; the WebMCP API stringifies them for the caller.
- Never return raw exceptions, stack traces, full history snapshots, audio, or unrelated browser data.
- Run pnpm test:project, pnpm test:ui, pnpm typecheck, pnpm lint, pnpm test, and pnpm build before completion.

---

## File Map

| File | Responsibility |
|---|---|
| src/project/validation.ts | Pure validation of canonical operations against a supplied project and sound catalog. |
| test/project-validation.test.ts | Canonical validation coverage for every Operation variant and successive batches. |
| src/project/commands.ts | Tool metadata on history entries and explicit idempotent history-control types. |
| src/project/service.ts | Page-session revision and deduplicated undo/redo/restore execution. |
| test/project.test.ts | Service revision, metadata, history-control, retention, and retry coverage. |
| src/stores/studio-store.ts | Shared validation at the manual boundary, publication, and WebMCP status state. |
| src/stores/studio-edits.ts | Delete after its rules move into project validation. |
| src/stores/studio-edits.test.ts | Delete after equivalent project validation tests exist. |
| src/stores/studio-provider.tsx | Expose the current StoreApi to the bridge. |
| src/webmcp/contracts.ts | Public tool names, JSON schemas, envelopes, public changes, and minimal WebMCP types. |
| src/webmcp/tools.ts | Runtime parsing, translation, pagination, direct handlers, history handlers, and batch resolution. |
| src/webmcp/tools.test.ts | Deterministic contract, handler, atomicity, equivalence, and inspection tests. |
| src/webmcp/register.ts | document.modelContext feature detection and one-controller registration lifecycle. |
| src/webmcp/register.test.ts | Registration, cleanup, rejection, cancellation, and exact tool-set tests. |
| src/webmcp/WebMCPBridge.tsx | Bind the live store to tool registration and publish local status. |
| src/components/Studio.tsx | Mount WebMCPBridge inside StudioProvider. |
| src/components/Transport.tsx | Render unsupported, registering, ready, or failed WebMCP status. |
| src/components/Studio.test.tsx | Prove registered agent edits update visible UI and Agent activity. |
| src/webmcp/evals/tool-selection.json | Static Chrome-style messages plus expectedCall evaluation cases. |

### Task 1: Canonical operation validation

**Files:**
- Create: src/project/validation.ts
- Create: test/project-validation.test.ts
- Modify: src/project/index.ts

**Interfaces:**
- Consumes: Project, Operation, Reduction, SoundCatalog, PROJECT_CAPS, reduceOperation.
- Produces:

~~~ts
export type ProjectValidationCode =
  | "TRACK_NOT_FOUND"
  | "PATTERN_NOT_FOUND"
  | "CLIP_NOT_FOUND"
  | "HIT_NOT_FOUND"
  | "NOTE_NOT_FOUND"
  | "OUT_OF_RANGE"
  | "KIND_MISMATCH"
  | "INCOMPATIBLE_INSTRUMENT"
  | "CLIP_OVERLAP"
  | "CAPACITY_EXCEEDED";

export class ProjectValidationError extends Error {
  readonly code: ProjectValidationCode;
  readonly field: string;
  constructor(code: ProjectValidationCode, field: string, message: string);
}

export function validateOperation(
  project: Project,
  operation: Operation,
  soundCatalog: SoundCatalog,
): Reduction;

export function validateOperations(
  project: Project,
  operations: readonly Operation[],
  soundCatalog: SoundCatalog,
): Reduction;
~~~

- validateOperation validates exactly one operation and returns reduceOperation(project, operation) only after all checks pass.
- validateOperations calls validateOperation in order, merges ChangeSummary values, and therefore validates later operations against the temporary result of earlier operations.

- [ ] **Step 1: Write failing validation tests**

Create table-driven tests that assert code and field for these exact rule groups:

| Operation | Required checks |
|---|---|
| project.update | name trimmed length 1-80; bpm finite 40-240; masterVolumeDb finite -60 to 0; at least one field. |
| track.create | unique ID; max 16 tracks; name 1-40; kind-compatible catalog instrument; finite volume -60 to 6; finite pan -1 to 1. |
| track.update | track exists; non-empty changes; name, instrument, mixer ranges; a drum instrument supports every drum pattern placed on that track. |
| track.reorder | track exists; integer toIndex from 0 through tracks.length - 1. |
| track.delete | track exists. Dependency authorization remains an intent-layer rule. |
| pattern.create | unique ID; max 128 patterns; name 1-40; length 1, 2, or 4; at most 512 events; event IDs unique in the pattern; event values valid. |
| pattern.duplicate | source exists; destination ID unique; capacity; name 1-40; duplicateEventIds count equals source event count; generated IDs unique. |
| pattern.update | pattern exists; non-empty changes; name and length constraints; shorter length cannot truncate events or invalidate clips. |
| pattern.delete | pattern exists. Dependency authorization remains an intent-layer rule. |
| arrangement.place | unique clip ID; max 512 clips; pattern and track exist; kind and drum-kit compatibility; integer startBar >= 0; repeat 1-64; end <= 256; no same-track overlap. |
| arrangement.update | clip exists; non-empty changes; validate the complete candidate placement using the same place rules. |
| arrangement.delete | clip exists. |
| drum-hits.add | drum pattern exists; 1-512 hits; unique new hit IDs; catalog sounds; integer startStep within pattern; total <= 512; placed kits support resulting sounds. |
| drum-hits.update | drum pattern exists; 1-512 unique existing hit IDs; each has a sound or step change; validate complete resulting pattern and placed kits. |
| drum-hits.delete | drum pattern exists; 1-512 unique existing hit IDs. |
| synth-notes.add | synth pattern exists; 1-512 notes; unique new IDs; MIDI 24-96; integer start >= 0; positive integer length; note end within pattern; total <= 512. |
| synth-notes.update | synth pattern exists; 1-512 unique existing note IDs; non-empty changes; validate complete candidates. |
| synth-notes.delete | synth pattern exists; 1-512 unique existing note IDs. |

Add explicit purity tests: the project and operation remain deep-equal after success and failure. Add one successive-state test where pattern.create followed by arrangement.place passes, while the same placement alone fails with PATTERN_NOT_FOUND.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

~~~bash
pnpm exec node --disable-warning=ExperimentalWarning --test test/project-validation.test.ts
~~~

Expected: FAIL because src/project/validation.ts does not exist.

- [ ] **Step 3: Implement the pure validator**

Use small private guards and one exhaustive switch. Preserve public field paths such as name, bpm, track_id, pattern_id, clip_id, hits[0].step, and notes[0].midi_note in ProjectValidationError.field. Reuse one placement validator and one synth-note validator rather than repeating those rules.

The batch function must have this shape:

~~~ts
export function validateOperations(
  project: Project,
  operations: readonly Operation[],
  soundCatalog: SoundCatalog,
): Reduction {
  let candidate = project;
  const summaries: ChangeSummary[] = [];
  for (const operation of operations) {
    const reduction = validateOperation(candidate, operation, soundCatalog);
    candidate = reduction.project;
    summaries.push(reduction.changes);
  }
  return { project: candidate, changes: mergeChangeSummaries(summaries) };
}
~~~

Export the new module from src/project/index.ts. Do not call validation from ProjectService; its typed command contract remains trusted.

- [ ] **Step 4: Run validation and project tests**

Run:

~~~bash
pnpm exec node --disable-warning=ExperimentalWarning --test test/project-validation.test.ts
pnpm run test:project
~~~

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add src/project/validation.ts src/project/index.ts test/project-validation.test.ts
git commit -m "feat: add canonical project validation"
~~~

### Task 2: Revision, tool attribution, and idempotent history controls

**Files:**
- Modify: src/project/commands.ts
- Modify: src/project/service.ts
- Modify: test/project.test.ts

**Interfaces:**
- Consumes: existing Command, DispatchResult, RestoreCommand, HistoryEntry, summarizeProjectDiff.
- Produces:

~~~ts
export interface HistoryControlCommand {
  readonly id: string;
  readonly kind: "undo" | "redo";
}

export type HistoryControlResult =
  | {
      readonly ok: true;
      readonly changed: true;
      readonly deduplicated: boolean;
      readonly project: Project;
      readonly changes: ChangeSummary;
    }
  | {
      readonly ok: false;
      readonly reason: "nothing_to_undo" | "nothing_to_redo";
      readonly project: Project;
    };

export interface ProjectServiceState {
  readonly project: Project;
  readonly history: readonly HistoryEntry[];
  readonly historyCursor: number;
  readonly revision: number;
}

ProjectService.controlHistory(command: HistoryControlCommand): HistoryControlResult;
ProjectService.replayDispatch(commandId: string): DispatchResult | null;
ProjectService.replayHistoryControl(commandId: string): HistoryControlResult | null;
~~~

- Add optional toolName to Command metadata, RestoreCommand, and HistoryEntry. Only agent WebMCP commands set it.
- Keep the existing service undo and redo wrappers only through this task if needed for a compiling intermediate commit. Task 3 moves the store to ProjectService.controlHistory and then removes obsolete service wrappers.

- [ ] **Step 1: Write failing service tests**

Add tests proving:

1. revision starts at 0;
2. changed dispatch increments once, including a multi-operation batch;
3. no-op and deduplicated dispatch do not increment;
4. successful undo, redo, and changed restore increment once;
5. unavailable undo/redo and no-op/deduplicated restore do not increment;
6. retrying the same successful HistoryControlCommand returns deduplicated true and does not move the cursor twice;
7. a failed history-control ID remains usable after history becomes available;
8. toolName is copied into history and survives JSON serialization;
9. replayDispatch returns a retained dispatch/restore result with deduplicated true and the current project, while replayHistoryControl does the same for an applied undo/redo;
10. both successful-outcome caches remain bounded at PROJECT_CAPS.maxSuccessfulCommands.

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

~~~bash
pnpm exec node --disable-warning=ExperimentalWarning --test test/project.test.ts
~~~

Expected: FAIL because revision, toolName, replay methods, and controlHistory are absent.

- [ ] **Step 3: Implement revision and idempotent controls**

Increment revision only at the statements that replace this.project after an actual change. Cache only successful history controls. A cached control returns the current project and current diff envelope without reapplying the cursor movement.

Use one private bounded insertion helper for both successful maps:

~~~ts
private rememberBounded<T>(cache: Map<string, T>, id: string, value: T): void {
  if (cache.size >= PROJECT_CAPS.maxSuccessfulCommands) {
    cache.delete(cache.keys().next().value!);
  }
  cache.set(id, value);
}
~~~

For undo, compute changes from the current project to entry.before before assigning it. For redo, compute changes from the current project to entry.after. Preserve the existing rule that undo and redo do not create HistoryEntry values.

- [ ] **Step 4: Run project tests**

Run:

~~~bash
pnpm run test:project
~~~

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add src/project/commands.ts src/project/service.ts test/project.test.ts
git commit -m "feat: add revisioned history controls"
~~~

### Task 3: Move the manual UI onto shared validation

**Files:**
- Modify: src/stores/studio-store.ts
- Modify: src/stores/studio-store.test.ts
- Modify: test/project-validation.test.ts
- Delete: src/stores/studio-edits.ts
- Delete: src/stores/studio-edits.test.ts

**Interfaces:**
- Consumes: validateOperation, validateOperations, ProjectValidationError, SOUND_CATALOG, ProjectService.controlHistory.
- Produces these StudioState methods for both UI wrappers and later WebMCP handlers:

~~~ts
readonly webMCPStatus: "unsupported" | "registering" | "ready" | "failed";
dispatch(command: Command): DispatchResult;
replayDispatch(commandId: string): DispatchResult | null;
replayHistoryControl(commandId: string): HistoryControlResult | null;
executeHistoryControl(command: HistoryControlCommand): HistoryControlResult;
executeRestore(command: RestoreCommand): DispatchResult;
undo(): void;
redo(): void;
restore(entryId: string): void;
setWebMCPStatus(status: WebMCPStatus): void;
~~~

- Manual helpers continue generating random command IDs and source manual.
- Private commit and commitBatch return boolean. They validate first, set ProjectValidationError.message on failure, and dispatch only after success.

- [ ] **Step 1: Write failing store tests**

Add tests that call raw manual actions and assert:

- invalid track, pattern, clip, drum-hit, and note changes are rejected by shared validation with no history;
- a valid manual batch is published once;
- manual undo/redo use fresh IDs and still move once;
- executeHistoryControl with a stable ID deduplicates;
- executeRestore accepts explicit metadata and keeps Agent attribution when source is agent;
- revision is visible in StudioState and follows service state;
- initial webMCPStatus is unsupported and setWebMCPStatus changes no project, revision, or history;
- rejected actions do not change selection.

- [ ] **Step 2: Run the focused store test and verify failure**

Run:

~~~bash
pnpm exec vitest run src/stores/studio-store.test.ts
~~~

Expected: FAIL because StudioState does not expose the new methods and still uses UI-only validators.

- [ ] **Step 3: Validate inside the two private commit helpers**

Implement the boundary once:

~~~ts
function validateAndDispatch(command: Command): DispatchResult | null {
  try {
    const operations = command.kind === "operation"
      ? [command.operation]
      : command.operations;
    validateOperations(get().project, operations, SOUND_CATALOG);
    return get().dispatch(command);
  } catch (error) {
    if (!(error instanceof ProjectValidationError)) throw error;
    set({ errorMessage: error.message });
    return null;
  }
}
~~~

Make commit and commitBatch return whether validateAndDispatch returned a result. Only select a newly created entity after true. Keep intent preparation in the store: names, colors, generated IDs, duplicate offsets, and concise manual labels.

- [ ] **Step 4: Remove duplicated domain rules**

Remove range, capacity, placement, drum-kit, and note validation from studio-store.ts. Keep only checks needed to construct an intent-specific operation or label, plus UI behavior such as deduplicating selected note IDs and turning drum-cell activation into add/delete operations. Delete studio-edits.ts and its test after equivalent cases pass in test/project-validation.test.ts.

Replace manual history calls with:

~~~ts
undo(): void {
  get().executeHistoryControl({ id: crypto.randomUUID(), kind: "undo" });
}

redo(): void {
  get().executeHistoryControl({ id: crypto.randomUUID(), kind: "redo" });
}
~~~

Keep the no-argument undo/redo and entry-ID restore UI wrappers used by existing components. WebMCP calls executeHistoryControl(command) and executeRestore(command), avoiding optional parameters and flag arguments.

- [ ] **Step 5: Run store and UI regressions**

Run:

~~~bash
pnpm exec vitest run src/stores/studio-store.test.ts src/components/Studio.test.tsx
pnpm run test:project
~~~

Expected: PASS.

- [ ] **Step 6: Commit**

~~~bash
git add src/stores/studio-store.ts src/stores/studio-store.test.ts test/project-validation.test.ts
git rm src/stores/studio-edits.ts src/stores/studio-edits.test.ts
git commit -m "refactor: share validation with studio edits"
~~~

### Task 4: Public contracts, schemas, and safe execution

**Files:**
- Create: src/webmcp/contracts.ts
- Create: src/webmcp/tools.ts
- Create: src/webmcp/tools.test.ts

**Interfaces:**
- Produces:

~~~ts
export type WebMCPToolName =
  | "get_project" | "get_sound_catalog" | "get_history"
  | "rename_project" | "set_tempo" | "set_master_volume"
  | "create_track" | "rename_track" | "set_track_instrument"
  | "reorder_track" | "set_track_mix" | "set_track_mute"
  | "set_track_solo" | "delete_track"
  | "create_pattern" | "rename_pattern" | "resize_pattern"
  | "duplicate_pattern" | "delete_pattern"
  | "place_pattern" | "move_clip" | "change_clip_pattern"
  | "set_clip_repeats" | "duplicate_clip" | "make_clip_unique"
  | "delete_clip" | "add_drum_hits" | "delete_drum_hits"
  | "add_notes" | "edit_notes" | "duplicate_notes" | "delete_notes"
  | "undo" | "redo" | "restore_history" | "apply_project_changes";

export interface ToolAnnotations {
  readonly readOnlyHint: boolean;
  readonly untrustedContentHint: boolean;
}

export interface WebMCPTool {
  readonly name: WebMCPToolName;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly annotations: ToolAnnotations;
  execute(
    input: Readonly<Record<string, unknown>>,
    options: { readonly signal: AbortSignal },
  ): Promise<unknown>;
}

export type ToolResult<T> =
  | { readonly success: true; readonly result: T }
  | { readonly success: false; readonly error: ToolError };

export const TOOL_CONTRACTS: readonly ToolContract[];

export function defineWebMCPTool<T>(
  contract: ToolContract,
  parse: (input: Readonly<Record<string, unknown>>) => T,
  run: (input: T, signal: AbortSignal) => unknown | Promise<unknown>,
): WebMCPTool;
~~~

- Define ToolError with the approved codes, message, retryable, and optional field, change_index, current_revision.
- Define EntityReference as exactly one of { id: string } or { ref: string }.
- Define the complete PublicChange discriminated union for the 29 project mutations in Sections 10.3-10.7 of the spec.

- [ ] **Step 1: Write failing contract tests**

Assert:

1. the WebMCPToolName list contains exactly 36 unique names;
2. every contract has a non-empty title and intent-based description;
3. every root object schema has additionalProperties false;
4. request_id is required on every mutation and bounded to 1-128;
5. base_revision is optional on direct mutations and required on apply_project_changes;
6. read annotations are true/true for get_project and get_history, true/false for get_sound_catalog, and false for both flags on mutations;
7. future and deferred names are absent;
8. a synthetic tool bound with defineWebMCPTool maps malformed root input and an already-aborted signal to INVALID_INPUT or EXECUTION_CANCELLED without throwing;
9. an unexpected executor exception returns INTERNAL_ERROR and never exposes its message.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

~~~bash
pnpm exec vitest run src/webmcp/tools.test.ts
~~~

Expected: FAIL because the WebMCP modules do not exist.

- [ ] **Step 3: Define schemas without a schema dependency**

Use shared constants for common request metadata, entity references, one-based positions, event arrays, and additionalProperties false. Keep every nested object closed too. Export one readonly TOOL_CONTRACTS array in WebMCPToolName order.

Titles use short user-facing verbs, for example Rename project, Create track, Place pattern, Add notes, Undo, and Apply project changes. Descriptions must state observable effects, dependency deletion behavior where relevant, one-based positions, and when to prefer apply_project_changes.

- [ ] **Step 4: Add strict runtime parsing and error serialization**

In tools.ts, add reusable guards for object, allowed keys, string, boolean, finite number, integer, array, enum, and EntityReference. Guards throw one private InputError containing a public field path. Do not cast unvalidated unknown values into public input types.

Have defineWebMCPTool wrap every execute callback with one safe executor:

~~~ts
async function executeSafely<T>(
  toolName: WebMCPToolName,
  signal: AbortSignal,
  run: () => T | Promise<T>,
): Promise<ToolResult<T>> {
  const startedAt = performance.now();
  try {
    if (signal.aborted) {
      return failure("EXECUTION_CANCELLED", "The tool call was cancelled.", true);
    }
    const result = await run();
    console.debug("WebMCP tool", {
      toolName,
      outcome: "success",
      elapsedMs: Math.round(performance.now() - startedAt),
    });
    return { success: true, result };
  } catch (error) {
    const result = mapKnownError(error);
    console.debug("WebMCP tool", {
      toolName,
      outcome: result.error.code,
      elapsedMs: Math.round(performance.now() - startedAt),
    });
    return result;
  }
}
~~~

For an unknown error, call console.error once with toolName and the Error object, then return INTERNAL_ERROR without its message. Never log input arguments.

- [ ] **Step 5: Run contract tests**

Run:

~~~bash
pnpm exec vitest run src/webmcp/tools.test.ts
pnpm run typecheck
~~~

Expected: PASS.

- [ ] **Step 6: Commit**

~~~bash
git add src/webmcp/contracts.ts src/webmcp/tools.ts src/webmcp/tools.test.ts
git commit -m "feat: define WebMCP tool contracts"
~~~

### Task 5: Inspection tools

**Files:**
- Modify: src/webmcp/tools.ts
- Modify: src/webmcp/tools.test.ts

**Interfaces:**
- Consumes: fresh StudioState from store.getState, SOUND_CATALOG, ToolResult.
- Produces handlers for get_project, get_sound_catalog, and get_history, plus the registry factory that later tasks extend:

~~~ts
export function createWebMCPTools(
  store: Pick<StoreApi<StudioState>, "getState">,
  createId: () => string,
): readonly WebMCPTool[];
~~~

- [ ] **Step 1: Write failing inspection tests**

Cover the following exact behavior:

| Tool/view | Assertions |
|---|---|
| get_project overview | Project ID/name/BPM/master volume, caps, revision, history cursor, counts; no complete arrays. |
| get_project tracks | Project order, optional track_ids filter in project order, cursor and default/max limit. |
| get_project patterns | Project order, optional kind filter, event count and placement count only. |
| get_project pattern | One pattern, one-based event positions, paginated events, PATTERN_NOT_FOUND. |
| get_project arrangement | Track order then startBar then original order; optional inclusive one-based bar range and track_ids; pattern name/kind/length; one-based start_bar. |
| get_sound_catalog | all, drum, and synth filters with stable source order. |
| get_history list | Newest first; ID/source/tool/label/time/state/changes; no before/after snapshots. |
| get_history entry | Normalized action plus only affected before/after project metadata and entities; HISTORY_ENTRY_NOT_FOUND. |
| cursors | Opaque cursor resumes the same view; changed revision gives INVALID_CURSOR; malformed or >256 chars gives INVALID_CURSOR. |
| reads | Revision, project identity, selection, history, and status remain unchanged. |

- [ ] **Step 2: Run focused tests and verify failure**

Run:

~~~bash
pnpm exec vitest run src/webmcp/tools.test.ts -t "inspection"
~~~

Expected: FAIL because inspection handlers are not bound.

- [ ] **Step 3: Implement revision-bound pagination**

Use a cursor containing only revision, view, and offset. Encode JSON with btoa and decode with atob; reject parse failures, wrong fields, negative offsets, mismatched views, mismatched revisions, and lengths over 256 as INVALID_CURSOR.

Use this result shape for every page:

~~~ts
{
  project_revision: number;
  items: readonly unknown[];
  next_cursor?: string;
}
~~~

Do not include cursor when the page reaches the end.

- [ ] **Step 4: Implement affected history projection**

Select created and updated entities from entry.after, deleted entities from entry.before, and project metadata from the relevant snapshot only when changes include the project ID. For event IDs, retain the owning pattern_id in each returned record. Never return entry.before or entry.after directly.

- [ ] **Step 5: Run inspection tests**

Run:

~~~bash
pnpm exec vitest run src/webmcp/tools.test.ts -t "inspection"
~~~

Expected: PASS.

- [ ] **Step 6: Commit**

~~~bash
git add src/webmcp/tools.ts src/webmcp/tools.test.ts
git commit -m "feat: add WebMCP inspection tools"
~~~

### Task 6: Project and track mutation tools

**Files:**
- Modify: src/webmcp/tools.ts
- Modify: src/webmcp/tools.test.ts

**Interfaces:**
- Consumes: StudioState.replayDispatch, StudioState.dispatch, validateOperations, ProjectValidationError.
- Produces handlers for rename_project, set_tempo, set_master_volume, create_track, rename_track, set_track_instrument, reorder_track, set_track_mix, set_track_mute, set_track_solo, and delete_track.

- [ ] **Step 1: Write failing project and track tests**

For every tool, test valid translation, generated history label, source agent, toolName, optional base_revision, stale conflict, same request retry, changed false no-op, domain error mapping, and stable ChangeSummary serialization.

Also prove:

- create_track appends with a generated ID, optional trimmed name, zeroed mixer values, and the next existing track color;
- reorder_track translates one-based position to zero-based toIndex;
- set_track_mix rejects an input with neither field;
- mute and solo are explicit setters and are safe no-ops when already equal;
- delete_track returns DEPENDENCIES_EXIST with clip IDs unless delete_clips is true;
- an already successful request is deduplicated before checking its now-stale base_revision.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

~~~bash
pnpm exec vitest run src/webmcp/tools.test.ts -t "project and track mutations"
~~~

Expected: FAIL because the mutation handlers are not bound.

- [ ] **Step 3: Add one direct mutation runner**

Use namespaced IDs in the exact form webmcp:<tool_name>:<request_id>. The runner order is:

1. parse request_id and optional base_revision;
2. check signal;
3. if store.getState().replayDispatch(commandId) returns a result, serialize it immediately without checking revision, generating IDs, or dispatching;
4. otherwise compare supplied base_revision to current revision;
5. construct operations and validate them against the fresh project;
6. dispatch once;
7. read the fresh state and serialize changed, deduplicated, project_revision, history_entry_id when present, history_cursor, and snake_case ChangeSummary.

Do not retain a second request cache in WebMCP.

- [ ] **Step 4: Implement the 11 handlers**

Keep each handler limited to parsing, intent-specific dependency checks, ID generation, Operation construction, and direct runner invocation. Use current catalog data and existing INSTRUMENT_NAMES/track color helpers for create_track. Error messages must not echo user-authored names.

- [ ] **Step 5: Run focused tests**

Run:

~~~bash
pnpm exec vitest run src/webmcp/tools.test.ts -t "project and track mutations"
pnpm exec vitest run src/stores/studio-store.test.ts
~~~

Expected: PASS.

- [ ] **Step 6: Commit**

~~~bash
git add src/webmcp/tools.ts src/webmcp/tools.test.ts
git commit -m "feat: add WebMCP project and track tools"
~~~

### Task 7: Pattern and arrangement mutation tools

**Files:**
- Modify: src/webmcp/tools.ts
- Modify: src/webmcp/tools.test.ts

**Interfaces:**
- Produces handlers for create_pattern, rename_pattern, resize_pattern, duplicate_pattern, delete_pattern, place_pattern, move_clip, change_clip_pattern, set_clip_repeats, duplicate_clip, make_clip_unique, and delete_clip.

- [ ] **Step 1: Write failing pattern and arrangement tests**

For every tool, cover canonical translation, one-based conversion, generated IDs, history attribution, validation error, idempotent retry, and no-op behavior.

Add these cases:

- create_pattern without placement creates one empty unplaced pattern;
- create_pattern with placement dispatches one two-operation batch and returns pattern_id plus clip_id;
- duplicate_pattern creates fresh IDs for every copied event;
- delete_pattern returns DEPENDENCIES_EXIST and referencing clip IDs unless delete_clips is true;
- place_pattern converts start_bar 1 to startBar 0;
- move_clip requires track_id or start_bar;
- change_clip_pattern leaves track, start, and repeats unchanged;
- duplicate_clip starts immediately after the source duration and returns CLIP_OVERLAP if occupied;
- make_clip_unique dispatches pattern.duplicate plus arrangement.update in one command and returns the new pattern ID;
- delete_clip preserves the pattern.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

~~~bash
pnpm exec vitest run src/webmcp/tools.test.ts -t "pattern and arrangement mutations"
~~~

Expected: FAIL because the handlers are not bound.

- [ ] **Step 3: Implement the 12 handlers**

Use the same Operation shapes already used by studio-store.ts. Generate all IDs before validation, but publish only after the complete operation or tightly coupled batch validates. Optional pattern names are trimmed; omitted names use New beat, New melody, or source-name copy with the existing 40-character limit.

- [ ] **Step 4: Run focused tests**

Run:

~~~bash
pnpm exec vitest run src/webmcp/tools.test.ts -t "pattern and arrangement mutations"
pnpm exec vitest run src/components/arrangement/Arrangement.test.tsx
~~~

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add src/webmcp/tools.ts src/webmcp/tools.test.ts
git commit -m "feat: add WebMCP pattern and arrangement tools"
~~~

### Task 8: Drum-hit and note mutation tools

**Files:**
- Modify: src/webmcp/tools.ts
- Modify: src/webmcp/tools.test.ts

**Interfaces:**
- Produces handlers for add_drum_hits, delete_drum_hits, add_notes, edit_notes, duplicate_notes, and delete_notes.

- [ ] **Step 1: Write failing event tests**

Test:

- add_drum_hits converts one-based step to zero-based, deduplicates identical sound/step inputs, omits hits already present, returns generated hit_ids, and returns changed false when every requested cell already exists;
- delete_drum_hits rejects duplicates and IDs outside the named drum pattern;
- add_notes converts start_step, preserves positive length_steps, and returns IDs in request order;
- edit_notes requires at least one changed field per item and rejects duplicate note IDs;
- duplicate_notes applies signed integer step_offset and pitch_offset, preserves duration, validates all candidates, and returns IDs in source note_ids order;
- delete_notes rejects duplicates and IDs outside the named synth pattern;
- every event tool enforces 1-512 input items and the 512-event result cap;
- all failures leave project, revision, history, and selection unchanged.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

~~~bash
pnpm exec vitest run src/webmcp/tools.test.ts -t "event mutations"
~~~

Expected: FAIL because the event handlers are not bound.

- [ ] **Step 3: Implement the six handlers**

Construct only canonical drum-hits.* and synth-notes.* operations. Do not add a generic drum edit operation. For duplicate_notes, resolve every source before generating any IDs so a missing note consumes no IDs and causes no mutation.

- [ ] **Step 4: Run focused tests**

Run:

~~~bash
pnpm exec vitest run src/webmcp/tools.test.ts -t "event mutations"
pnpm exec vitest run src/components/editor/DrumGrid.test.tsx src/components/editor/PianoRoll.test.tsx
~~~

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add src/webmcp/tools.ts src/webmcp/tools.test.ts
git commit -m "feat: add WebMCP event tools"
~~~

### Task 9: Atomic apply_project_changes

**Files:**
- Modify: src/webmcp/contracts.ts
- Modify: src/webmcp/tools.ts
- Modify: src/webmcp/tools.test.ts

**Interfaces:**
- Consumes: PublicChange, EntityReference, validateOperation, reduceOperation, StudioState.dispatch.
- Produces:

~~~ts
interface ResolvedBatch {
  readonly operations: readonly Operation[];
  readonly references: Readonly<Record<string, string>>;
}

function resolveBatch(
  project: Project,
  changes: readonly PublicChange[],
  createId: () => string,
): ResolvedBatch;
~~~

- Creation refs are optional but, when present, must be unique and declared before use.
- Support refs for created tracks, patterns, and clips. create_pattern placement accepts clip_ref; make_clip_unique accepts pattern_ref. add_drum_hits and add_notes items accept optional ref. duplicate_notes accepts optional note_refs whose count must equal note_ids.
- Stable IDs remain strings because existing projects contain stable non-UUID IDs.

- [ ] **Step 1: Write failing batch tests**

Cover:

1. 1 change returns BATCH_TOO_SMALL and 101 returns BATCH_TOO_LARGE;
2. base_revision is mandatory and stale values return REVISION_CONFLICT;
3. a create track -> create pattern -> add notes -> place pattern chain resolves refs in order;
4. duplicate refs, invalid syntax, both id/ref, neither id/ref, missing refs, and forward refs return their exact error and zero-based change_index;
5. nested event refs and note_refs map to generated IDs;
6. each public action translates to the same canonical operations as its direct tool;
7. validation uses each preceding temporary state;
8. a middle failure leaves project object, revision, history, cursor, selection, and reference output unchanged;
9. success dispatches one batch, creates one Agent history entry using the trimmed label, increments revision once, and returns applied_changes plus the complete ref map;
10. retry returns the retained result without generating or applying IDs again;
11. delete_track/delete_pattern with delete_clips false succeeds when prior changes removed or reassigned every dependency, and otherwise returns DEPENDENCIES_EXIST.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

~~~bash
pnpm exec vitest run src/webmcp/tools.test.ts -t "apply_project_changes"
~~~

Expected: FAIL because batch resolution is absent.

- [ ] **Step 3: Implement ordered resolution**

For each public change:

1. validate its closed runtime shape;
2. resolve every EntityReference from an existing stable ID or the current ref map;
3. generate IDs for that change and add declared refs;
4. translate into one or more canonical operations;
5. call validateOperation for each operation against the temporary project;
6. replace the temporary project with each returned project;
7. append operations only after that change validates.

Catch known failures at the loop boundary and add change_index. Do not call StudioState.dispatch until all changes resolve and validate.

- [ ] **Step 4: Add direct-versus-batch equivalence tests**

For all 29 public project mutations, start two stores from the same fixture, use deterministic generated IDs, execute the direct tool on one and a two-change batch containing the target change plus an explicit no-op setter on the other, then compare resulting Project values after normalizing history-only metadata. Also compare ProjectValidationError code and field for one invalid case per mutation family.

- [ ] **Step 5: Run batch and full WebMCP tool tests**

Run:

~~~bash
pnpm exec vitest run src/webmcp/tools.test.ts
~~~

Expected: PASS.

- [ ] **Step 6: Commit**

~~~bash
git add src/webmcp/contracts.ts src/webmcp/tools.ts src/webmcp/tools.test.ts
git commit -m "feat: add atomic WebMCP project changes"
~~~

### Task 10: WebMCP history controls

**Files:**
- Modify: src/webmcp/tools.ts
- Modify: src/webmcp/tools.test.ts

**Interfaces:**
- Produces handlers for undo, redo, and restore_history.

- [ ] **Step 1: Write failing history-control tests**

Assert:

- undo and redo require request_id, accept optional base_revision, change revision once, return the new history cursor and ChangeSummary, and create no history entry;
- retries with the same request ID do not move twice, even when the supplied base_revision is now stale;
- unavailable controls return NOTHING_TO_UNDO or NOTHING_TO_REDO and are not cached;
- restore_history returns HISTORY_ENTRY_NOT_FOUND for an unretained ID;
- changed restore creates one Agent entry with toolName restore_history and can itself be undone;
- no-op restore is successful, cached, and does not change revision or truncate redo history.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

~~~bash
pnpm exec vitest run src/webmcp/tools.test.ts -t "history controls"
~~~

Expected: FAIL because the history handlers are not bound.

- [ ] **Step 3: Implement history handlers**

Use webmcp:undo:<request_id>, webmcp:redo:<request_id>, and webmcp:restore_history:<request_id>. Check replayHistoryControl or replayDispatch before revision. Map unavailable service results to the two public errors. Restore through the explicit low-level store restore command with source agent, toolName restore_history, and label Restore history.

- [ ] **Step 4: Run history and full tool tests**

Run:

~~~bash
pnpm exec vitest run src/webmcp/tools.test.ts
pnpm run test:project
~~~

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add src/webmcp/tools.ts src/webmcp/tools.test.ts
git commit -m "feat: add WebMCP history controls"
~~~

### Task 11: Browser registration and visible bridge status

**Files:**
- Create: src/webmcp/register.ts
- Create: src/webmcp/register.test.ts
- Create: src/webmcp/WebMCPBridge.tsx
- Modify: src/stores/studio-provider.tsx
- Modify: src/components/Studio.tsx
- Modify: src/components/Transport.tsx
- Modify: src/components/Studio.test.tsx

**Interfaces:**
- Produces:

~~~ts
export interface ModelContext {
  registerTool(
    tool: WebMCPTool,
    options: { readonly signal: AbortSignal },
  ): Promise<void>;
}

export function getModelContext(source: Document): ModelContext | null;

export function registerWebMCPTools(
  context: ModelContext,
  tools: readonly WebMCPTool[],
): {
  readonly ready: Promise<void>;
  unregister(): void;
};

export function useStudioStoreApi(): StoreApi<StudioState>;
~~~

- [ ] **Step 1: Write failing registration tests**

Test:

- getModelContext returns null when unsupported and the exact object when supported;
- all 36 tools register with the same AbortSignal;
- registration passes no exposedTo origins;
- unregister aborts once and removes tools;
- a registration rejection aborts the controller and rejects ready;
- play, pause, stop, seek, export_wav, and every deferred candidate are absent;
- a tool called through the captured fake definition reads current store state at execution time;
- an aborted execution returns EXECUTION_CANCELLED before mutation.

- [ ] **Step 2: Run registration tests and verify failure**

Run:

~~~bash
pnpm exec vitest run src/webmcp/register.test.ts
~~~

Expected: FAIL because register.ts does not exist.

- [ ] **Step 3: Implement the minimal draft API adapter**

Feature-detect with a local intersection type instead of changing global DOM declarations:

~~~ts
export function getModelContext(source: Document): ModelContext | null {
  const candidate = source as Document & { readonly modelContext?: ModelContext };
  return candidate.modelContext ?? null;
}
~~~

Create one AbortController synchronously. Start all registerTool promises with { signal: controller.signal }. If ready rejects, abort before rethrowing. unregister calls controller.abort().

- [ ] **Step 4: Write failing bridge integration tests**

In Studio.test.tsx, install a configurable document.modelContext fake before render and remove it after each test. Assert:

1. status text moves from Registering to Ready;
2. unsupported renders Unsupported;
3. rejection renders Failed while manual buttons still work;
4. unmount aborts registrations;
5. invoking captured rename_track changes visible arrangement/mixer labels immediately and adds one Agent row in Activity;
6. invoking a batch that creates a pattern and clip makes both visible;
7. no tool changes selected entities unless deletion invalidates the current selection.

- [ ] **Step 5: Implement and mount WebMCPBridge**

Expose the StoreApi from studio-provider.tsx. WebMCPBridge returns null, creates tools once for that store, registers them in an effect, and writes status through setWebMCPStatus. Guard asynchronous completion with an active boolean so an unmounted bridge never publishes status.

Mount it as the first child inside StudioSession. In Transport render a small span with aria-label WebMCP status and one of WebMCP: Unsupported, WebMCP: Registering, WebMCP: Ready, or WebMCP: Failed. Do not add controls, dialogs, or retries.

- [ ] **Step 6: Run browser-facing tests**

Run:

~~~bash
pnpm exec vitest run src/webmcp/register.test.ts src/components/Studio.test.tsx
pnpm run typecheck
~~~

Expected: PASS.

- [ ] **Step 7: Commit**

~~~bash
git add src/webmcp/register.ts src/webmcp/register.test.ts src/webmcp/WebMCPBridge.tsx src/stores/studio-provider.tsx src/components/Studio.tsx src/components/Transport.tsx src/components/Studio.test.tsx
git commit -m "feat: register WebMCP tools in the studio"
~~~

### Task 12: Selection evals and release verification

**Files:**
- Create: src/webmcp/evals/tool-selection.json
- Modify: src/webmcp/tools.test.ts

**Interfaces:**
- Produces a static array whose cases contain id, messages, and expectedCall with name and arguments.

- [ ] **Step 1: Write a failing fixture-shape test**

Load tool-selection.json and assert every case has:

~~~ts
{
  id: string;
  messages: readonly {
    role: "user" | "assistant";
    content: string;
  }[];
  expectedCall: {
    name: WebMCPToolName;
    arguments: Readonly<Record<string, unknown>>;
  };
}
~~~

Assert IDs are unique and expected names exist in TOOL_CONTRACTS.

- [ ] **Step 2: Run the fixture test and verify failure**

Run:

~~~bash
pnpm exec vitest run src/webmcp/tools.test.ts -t "tool-selection fixture"
~~~

Expected: FAIL because the fixture does not exist.

- [ ] **Step 3: Add the evaluation corpus**

Add at least these 16 distinct cases with concrete IDs and arguments:

1. inspect overview before editing;
2. inspect one pattern's notes;
3. inspect history;
4. rename one track with rename_track;
5. set mute explicitly with set_track_mute;
6. create an unplaced drum pattern;
7. place an existing pattern;
8. add several notes;
9. edit several existing notes;
10. duplicate notes;
11. delete a track while explicitly deleting its clips;
12. create track, pattern, notes, and placement with apply_project_changes refs;
13. move and repeat a clip atomically;
14. avoid apply_project_changes for one setter;
15. undo a mistaken edit;
16. restore a named retained history entry by ID.

Use realistic stable IDs from DEMO_PROJECT and one-based public positions. Keep prompts free of secrets and external content.

- [ ] **Step 4: Run deterministic verification**

Run:

~~~bash
pnpm run test:project
pnpm run test:ui
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build
git diff --check
git status --short
~~~

Expected: every command exits 0; status shows only the intended eval/test changes before commit.

- [ ] **Step 5: Perform supported-browser acceptance**

In a WebMCP-capable secure-context browser:

1. inspect document.modelContext.getTools() and confirm exactly the 36 usable names;
2. execute rename_track and verify the visible label plus one Agent activity row;
3. execute a create pattern -> add notes -> place pattern batch using refs;
4. force a middle-batch validation error and verify no project/history/revision change;
5. retry a successful request ID and verify no repeated mutation;
6. make a manual edit between inspection and a guarded batch and verify REVISION_CONFLICT;
7. execute undo, redo, and restore_history and compare them with manual controls;
8. load in an unsupported browser and verify all manual editing remains usable.

Record any unavailable browser support as an explicit verification limitation; do not install a polyfill or browser package.

- [ ] **Step 6: Commit**

~~~bash
git add src/webmcp/evals/tool-selection.json src/webmcp/tools.test.ts
git commit -m "test: add WebMCP selection evals"
~~~

---

## Completion Criteria

- The browser advertises exactly the approved 36 currently usable tools.
- Every direct edit and apply_project_changes uses the shared canonical validator and existing ProjectService.
- Agent changes immediately update the visible studio and create correctly attributed history.
- Batches are atomic, revision guarded, and support ordered local refs.
- Successful retries are idempotent across direct edits, batching, undo, redo, and restore.
- Inspection is paginated, revision-bound, and never returns full retained snapshots.
- Unsupported or failed registration leaves manual UI behavior intact and visibly reports status.
- Future playback/export tools and all documented deferred candidates remain unregistered.
- All deterministic checks pass, and browser acceptance is either passed or explicitly recorded as unavailable.
