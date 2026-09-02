# AgentDAW WebMCP Interface Design

## 1) Goals

### 1.1 Outcomes

1. A WebMCP-aware agent can inspect the current project, sound catalog, and retained history through focused read tools.
2. An agent can perform every meaningful supported project edit through an explicit, user-intent-oriented tool.
3. Multiple coordinated edits can be validated and committed atomically through apply_project_changes.
4. Manual UI edits and WebMCP edits share canonical operations, validation rules, project state, history, undo, redo, and restore behavior.
5. A successful WebMCP edit updates the visible studio immediately and creates one Agent-attributed activity entry.
6. Retries are idempotent, stale batches cannot overwrite a newer revision, and failures never partially commit.
7. Playback and export tools join the registry only when their backing services are usable.

### 1.2 Non-goals

- Embedded chat, model calls, composition logic, or prompt orchestration.
- Literal UI automation such as selecting panels, opening menus, or clicking controls.
- A generic edit_project tool as the primary mutation interface.
- A second project model, reducer, validation policy, transaction engine, or history format for WebMCP.
- Recording, looping, velocity, quantization, track duplication, audio import, effects, automation, cloud sync, or collaboration.
- Cross-origin exposure, a WebMCP polyfill, or an application backend.
- Treating deferred tool candidates as roadmap commitments.

### 1.3 Assumptions and constraints

- AgentDAW remains a browser-only Next.js application using strict TypeScript, React, Zustand, native Web APIs, and IndexedDB.
- The existing Project, Operation, ProjectService, history, and product caps remain authoritative.
- Reducer inputs remain trusted. UI and WebMCP boundaries validate before dispatch.
- Public musical positions use one-based bars and steps; canonical operations remain zero-based.
- The target WebMCP surface is the draft document.modelContext imperative API.
- Registration truthfully reflects current capability. Unavailable future tools are omitted.
- No new runtime or development dependency is needed.
- Project revision is page-session state and resets when a new studio session is constructed.

## 2) Glossary

| Term | Meaning |
|---|---|
| Agent | An external assistant invoking AgentDAW tools through browser-mediated WebMCP. |
| Canonical operation | The existing internal Operation representation consumed by ProjectService. |
| Direct tool | A focused WebMCP tool representing one recognizable user intent. |
| Local reference | A batch-scoped name for an entity whose UUID is generated while resolving the batch. |
| Project revision | A monotonic page-session counter incremented whenever the current project changes. |
| Public change | A snake_case, user-intent representation accepted by apply_project_changes. |
| Request ID | A caller-supplied identifier used to deduplicate retries of one mutation tool. |
| Tool registry | The currently registered set of usable tools on document.modelContext. |

## 3) Technical stack

### 3.1 Runtime

| Area | Choice | Purpose |
|---|---|---|
| Language | Strict TypeScript | Share contracts with existing project and UI code. |
| Browser API | document.modelContext | Use the current imperative WebMCP producer surface. |
| Schemas | Plain JSON Schema objects | Describe tool input without a schema dependency. |
| IDs | crypto.randomUUID() | Match existing entity and history identifiers. |
| State | Existing Zustand store and ProjectService | Keep manual and agent edits on one path. |
| Tests | Existing Node test runner and Vitest | Add no testing dependency. |

### 3.2 Proposed project structure

~~~text
src/
  project/
    validation.ts          # Pure canonical operation validation
  webmcp/
    contracts.ts           # Names, descriptions, schemas, and result types
    tools.ts               # Parsing, translation, and local-reference resolution
    register.ts            # document.modelContext lifecycle
    WebMCPBridge.tsx       # Connects tools to the live studio store
    tools.test.ts
    register.test.ts
    evals/
      tool-selection.json
~~~

Existing files change only where shared validation, revision tracking, idempotent history controls, and bridge mounting require it.

## 4) Architecture overview

~~~mermaid
flowchart LR
    A[WebMCP agent] --> M[document.modelContext]
    M --> D[Direct user-intent tools]
    M --> B[apply_project_changes]
    U[Manual UI] --> V[Shared canonical validation]
    D --> V
    B --> R[Local-reference resolver]
    R --> V
    V --> S[ProjectService]
    S --> P[(Project state)]
    S --> H[History]
    P --> Z[Zustand publication]
    H --> Z
    Z --> UI[Visible studio]
~~~

### 4.1 Direct mutation

A direct tool parses one focused input, generates any required IDs, translates the intent into one canonical operation or one tightly coupled canonical batch, and invokes shared validation. ProjectService commits the action with source Agent and optional tool metadata. The store publishes the new service snapshot once, causing the existing UI to rerender.

### 4.2 Atomic mutation

apply_project_changes accepts 2–100 public changes. It resolves local references and generates UUIDs in order, validates each normalized operation against the preceding temporary project, and dispatches the completed canonical batch once. Any resolution, validation, or execution failure publishes nothing and creates no history.

### 4.3 Inspection

Read tools obtain a fresh store snapshot at execution time. They return a selected, paginated view instead of copying the entire project or history. Reads have no effect on revision, selection, history, persistence, or playback.

### 4.4 Registration lifecycle

WebMCPBridge feature-detects document.modelContext after the studio store exists. It registers currently usable tools with one AbortController and aborts it on unmount. Unsupported browsers and registration failures leave manual editing intact and expose a visible local status.

## 5) WebMCP integration

AgentDAW uses imperative tools because project editing is client-side application logic rather than form submission. Each tool definition supplies a snake_case name, user-facing title, concise intent-based description, JSON Schema input, current annotations, and an execution callback.

No exposedTo origins are configured. The browser's default same-origin and built-in-agent scope applies. Tool execution receives an AbortSignal. Synchronous mutations check it before dispatch; future asynchronous playback preparation and export pass it to their underlying work.

The implementation targets the current draft API documented at:

- https://webmachinelearning.github.io/webmcp/
- https://developer.chrome.com/docs/ai/webmcp/imperative-api
- https://developer.chrome.com/docs/ai/webmcp/best-practices

## 6) Components

### 6.1 Shared validation

**Responsibility:** Validate canonical operations against a supplied project and sound catalog before ProjectService receives them. UI and WebMCP callers use the same pure rules.

**Inputs:**

- Current Project snapshot.
- Canonical Operation.
- Sound catalog and project caps.

**Outputs:**

- A successful validated operation, or one structured domain error with a field path and context.

**Error handling and failure modes:**

| Failure | Behavior | Recovery |
|---|---|---|
| Missing entity | Return an entity-specific not-found error. | Re-inspect and retry with a current ID. |
| Invalid range or relationship | Return the failing field and rule. | Correct the input. |
| Capacity exceeded | Return the relevant cap. | Remove entities or reduce the request. |
| Programmer error | Throw without dispatch. | Fix the caller; no project state changed. |

**Non-functional requirements:**

- Pure and deterministic for the same project, catalog, and operation.
- Does not mutate its inputs.
- Contains project rules only; UI messages and WebMCP serialization remain outside it.

### 6.2 WebMCP tool adapter

**Responsibility:** Define public tools, validate input shapes, translate user-intent inputs to canonical operations, invoke shared validation and ProjectService, and serialize concise results.

**Inputs:**

- Tool arguments.
- Fresh store and service state.
- Execution AbortSignal.

**Outputs:**

- Structured success or error values.
- For successful mutations, published project/history state.

**Error handling and failure modes:**

| Failure | Behavior | Recovery |
|---|---|---|
| Invalid JSON shape | Return INVALID_INPUT with a field path. | Correct arguments and retry. |
| Revision mismatch | Return REVISION_CONFLICT with current revision. | Re-inspect before retrying. |
| Domain validation failure | Return the mapped domain code. | Correct the named entity or field. |
| Unexpected exception | Return INTERNAL_ERROR and log the cause locally. | Retry only if the message marks it retryable. |

**Non-functional requirements:**

- Direct handlers remain thin and contain no separate business rules.
- Outputs omit complete project snapshots unless a read explicitly requests detail.
- Mutation command IDs are namespaced by WebMCP tool and request ID.

### 6.3 Batch resolver

**Responsibility:** Resolve local references, generate entity IDs, normalize public changes, and validate them against successive temporary states.

**Inputs:**

- A required base revision.
- A short batch label.
- Two to 100 ordered public changes.

**Outputs:**

- One canonical Operation array.
- A local-reference-to-UUID map.
- Either one committed batch result or one indexed error.

**Error handling and failure modes:**

| Failure | Behavior | Recovery |
|---|---|---|
| Duplicate local reference | Reject before dispatch. | Rename one reference. |
| Missing or forward reference | Return its zero-based change index. | Create the entity earlier or use a stable ID. |
| Change validation fails | Return its index and field; discard temporary state. | Correct the failing change. |
| Dispatch throws | Publish nothing; propagate to safe error mapping. | Investigate the underlying programmer failure. |

**Non-functional requirements:**

- All-or-nothing state and history.
- Deterministic validation apart from generated UUID values.
- At most 100 public changes, matching PROJECT_CAPS.

### 6.4 ProjectService and store integration

**Responsibility:** Continue owning canonical state and history while adding page-session revision tracking and idempotent history controls.

Manual and WebMCP mutation paths converge before ProjectService. The service increments project revision only when the current project actually changes, including successful undo, redo, and restore. The store publishes once per direct call or atomic batch. Existing selection remains unless the selected entity was removed.

### 6.5 Registration bridge

**Responsibility:** Connect stable tool definitions to the live store and manage their browser lifecycle.

The bridge registers tools after mount and unregisters them with one AbortController. It reports unsupported, registering, ready, or failed state locally. It omits playback and export definitions until their services are usable.

## 7) Interface data model

### 7.1 Common mutation metadata

| Field | Type | Required | Constraint |
|---|---|---:|---|
| request_id | string | yes | Non-empty, bounded caller identifier; idempotent within one tool. |
| base_revision | non-negative integer | direct: no; batch: yes | Expected current page-session project revision. |

The adapter maps a mutation to a namespaced command ID containing its tool name and request ID. Reusing the same request ID with the same tool returns the retained outcome and never repeats the edit.

### 7.2 Entity reference

Batch changes identify existing or earlier-created entities with exactly one of:

| Field | Type | Meaning |
|---|---|---|
| id | string | Stable existing entity UUID. |
| ref | string | Unique local reference declared by an earlier creation change in the same batch. |

Forward references and objects containing both fields are invalid. Direct tools accept stable IDs and return generated IDs for created entities.

### 7.3 Success result

Every successful project mutation includes:

| Field | Type | Meaning |
|---|---|---|
| success | true | Stable envelope discriminator. |
| project_revision | integer | Revision after the call. |
| history_entry_id | string or absent | Entry created by a changed commit. |
| history_cursor | integer | Current history position. |
| changes | ChangeSummary | Created, updated, and deleted entity IDs. |
| deduplicated | boolean | Whether the request ID returned a prior outcome. |

Creation tools add their generated entity IDs. Batch success also adds applied_changes and the local reference map. A valid no-op returns success, changed false, and no new history entry or revision.

### 7.4 Error result

| Field | Type | Required | Meaning |
|---|---|---:|---|
| success | false | yes | Stable envelope discriminator. |
| code | string enum | yes | Machine-readable category. |
| message | string | yes | Concise corrective guidance. |
| field | string | no | Public input path. |
| change_index | integer | batch only | Zero-based failing batch item. |
| retryable | boolean | yes | Whether repeating later may succeed without changed arguments. |
| current_revision | integer | conflicts only | Revision the agent should inspect. |

Results never contain stack traces or raw exception messages.

### 7.5 Project revision

Revision starts at zero for a new studio store and increases by one whenever the current Project identity changes through dispatch, undo, redo, or restore. Reads, no-ops, selection changes, persistence, playback, and export do not increment it. Revision is not stored in the Project document or IndexedDB.

## 8) Storage artifacts

WebMCP adds no production storage. The existing persistence service continues to save Project snapshots when the application integrates autosave. Request deduplication, project revision, tool registration state, and local batch references remain page-session memory.

The repository stores one evaluation corpus:

~~~text
src/webmcp/evals/tool-selection.json
~~~

Each case follows Chrome's messages plus expectedCall shape and contains no user data or secrets.

## 9) Core workflows

### 9.1 Direct mutation

1. Read the latest project revision and state from the store.
2. Return a retained result when the namespaced request ID was already successful.
3. If supplied, compare base_revision with the current revision.
4. Parse the focused public input and reject unknown fields.
5. Generate IDs required by the intent.
6. Translate to one canonical operation or one tightly coupled canonical batch.
7. Run shared canonical validation.
8. Dispatch once with source Agent and the direct tool name.
9. Publish the updated service state once.
10. Return generated IDs, revision, history position, and ChangeSummary.

### 9.2 Atomic batch

1. Require a fresh base_revision, label, and 2–100 changes.
2. Create an empty local-reference map and a detached temporary project.
3. For each change in order, resolve stable IDs and earlier local references.
4. Generate UUIDs for declared creation references.
5. Translate the public change into canonical operations.
6. Validate and reduce those operations into the temporary project.
7. On any failure, discard temporary state and return the indexed error.
8. Dispatch the complete canonical operation list once through ProjectService.
9. Publish one project/history update.
10. Return one history entry and the complete reference map.

### 9.3 Inspection

1. Read a fresh store snapshot.
2. Validate the requested view, IDs, cursor, filters, and page size.
3. Select only the fields needed for that view.
4. Return stable ordering, a next cursor when present, and project revision.

### 9.4 History control

Undo and redo use idempotent history-control requests so a retry cannot move twice. They change revision but do not create a history entry. restore_history resolves a retained entry, applies its after-snapshot as one new Agent action, and returns its new history entry.

### 9.5 Capability registration

The bridge registers project inspection, project mutation, history, and batch tools when the current studio state can service them. Playback, seek, pause, stop, and export remain absent until their integrations report usable. A later capability update registers the newly usable tool without changing existing contracts.

## 10) WebMCP contracts

### 10.1 Contract conventions

- Tool and parameter names use snake_case.
- Direct tool descriptions state the user intent and do not mention command dispatch.
- Direct tools generate concise history labels from validated inputs and do not accept arbitrary labels.
- Public bar and step positions are one-based. Durations and repeat counts are positive counts.
- Schemas set additionalProperties false and use explicit enums and bounds where useful.
- Runtime validation remains authoritative because schema enforcement is not assumed.
- Mutation tools use readOnlyHint false. Read tools use readOnlyHint true.
- get_project and get_history set untrustedContentHint true because names and labels can contain user-authored text.

### 10.2 Inspection tools

| Tool | Input | Result |
|---|---|---|
| get_project | Required view plus view-specific filters and pagination | A selected current-project view and project revision. |
| get_sound_catalog | Optional kind filter | Stable drum-kit, sound, and synth-preset identifiers. |
| get_history | Required list or entry view | Paginated entry summaries or one entry's affected before/after values. |

get_project views:

| View | Parameters | Contents |
|---|---|---|
| overview | none | Project metadata, caps, revision, history position, persistence status when available, and entity counts. |
| tracks | optional track_ids, cursor, limit | Ordered tracks with kind, instrument, color, and mixer state. |
| patterns | optional kind, cursor, limit | Pattern headers, event counts, and placement counts. |
| pattern | pattern_id, optional event cursor and limit | One pattern and a page of its drum hits or synth notes. |
| arrangement | optional bar range, track_ids, cursor, limit | Ordered clips with enough pattern metadata to determine duration. |

Pagination defaults to 20 items and permits at most 100. Cursors are opaque and tied to the project revision; using one after the project changes returns INVALID_CURSOR.

get_history list returns entry ID, source, tool name when present, label, timestamp, current or undone state, and ChangeSummary. The entry view returns normalized operations plus before/after values only for affected entities, never complete project snapshots.

### 10.3 Project tools

| Tool | Action input | Rules |
|---|---|---|
| rename_project | name | Trimmed length 1–80. |
| set_tempo | bpm | Finite value from 40–240. |
| set_master_volume | volume_db | Finite value from -60–0 dB. |

### 10.4 Track tools

| Tool | Action input | Rules |
|---|---|---|
| create_track | kind, instrument_id, optional name | kind is drum or synth; instrument must match; appends track; returns track_id. |
| rename_track | track_id, name | Trimmed length 1–40. |
| set_track_instrument | track_id, instrument_id | Compatible catalog entry; validates all placed drum patterns. |
| reorder_track | track_id, position | One-based position in the current ordered track list. |
| set_track_mix | track_id, optional volume_db, optional pan | At least one value; volume -60–6 dB, pan -1–1. |
| set_track_mute | track_id, muted | Sets an explicit boolean, never toggles. |
| set_track_solo | track_id, soloed | Sets an explicit boolean, never toggles. |
| delete_track | track_id, optional delete_clips | Preserves patterns; defaults cascade permission to false. |

When delete_track finds clips and delete_clips is false, it returns DEPENDENCIES_EXIST with affected clip IDs. The caller may explicitly authorize cascading clip deletion or remove or reassign clips within a batch.

### 10.5 Pattern tools

| Tool | Action input | Rules |
|---|---|---|
| create_pattern | kind, optional name, length_bars, optional placement | Creates an empty pattern; optional placement is an atomic paired action; returns pattern_id and optional clip_id. |
| rename_pattern | pattern_id, name | Trimmed length 1–40. |
| resize_pattern | pattern_id, length_bars | Length is 1, 2, or 4 bars; rejects event truncation or invalid placements. |
| duplicate_pattern | pattern_id, optional name | Copies all content with fresh event IDs; returns pattern_id. |
| delete_pattern | pattern_id, optional delete_clips | Defaults cascade permission to false. |

Optional create_pattern placement contains track_id, one-based start_bar, and repeat_count defaulting to one. A placed pattern must match the destination track kind and drum kit.

### 10.6 Arrangement tools

| Tool | Action input | Rules |
|---|---|---|
| place_pattern | pattern_id, track_id, start_bar, optional repeat_count | Creates a compatible non-overlapping clip; returns clip_id. |
| move_clip | clip_id, optional track_id, optional start_bar | Changes at least one placement coordinate. |
| change_clip_pattern | clip_id, pattern_id | Preserves track, start, and repeats while validating the replacement. |
| set_clip_repeats | clip_id, repeat_count | Explicit integer from 1–64. |
| duplicate_clip | clip_id | Places a shared-pattern copy immediately after the source; returns clip_id. |
| make_clip_unique | clip_id, optional pattern_name | Copies content and redirects only that clip; returns pattern_id. |
| delete_clip | clip_id | Removes one placement and preserves its pattern. |

Every placement-changing tool validates entity existence, kind compatibility, drum kit compatibility, same-track overlap, the 256-bar boundary, and capacity.

### 10.7 Event tools

| Tool | Action input | Rules |
|---|---|---|
| add_drum_hits | pattern_id, hits | Each hit contains sound_id and one-based step; returns hit_ids. |
| delete_drum_hits | pattern_id, hit_ids | IDs must exist in the same drum pattern. |
| add_notes | pattern_id, notes | Each note contains midi_note, one-based start_step, and length_steps; returns note_ids. |
| edit_notes | pattern_id, notes | Each item contains note_id and at least one replacement field. |
| duplicate_notes | pattern_id, note_ids, step_offset, pitch_offset | Preserves duration and returns generated note_ids. |
| delete_notes | pattern_id, note_ids | IDs must exist in the same synth pattern. |

Event lists contain at least one item and no duplicate target IDs. MIDI pitches span 24–96, steps and durations are whole numbers inside the pattern, drum sounds come from the catalog, and the resulting pattern contains at most 512 events. Adding an already-present identical drum cell is a successful no-op.

There is no generic edit_drum_hits tool. Coordinated drum movement or sound replacement is an atomic delete/add batch.

### 10.8 History tools

| Tool | Action input | Rules |
|---|---|---|
| undo | common mutation metadata | Moves backward once without creating history. |
| redo | common mutation metadata | Moves forward once without creating history. |
| restore_history | history_entry_id plus common metadata | Restores a retained after-snapshot as one new Agent entry. |

Successful history controls increment project revision and return the resulting cursor. Namespaced request IDs ensure retries cannot move history twice.

### 10.9 Atomic batch tool

apply_project_changes accepts:

| Field | Type | Constraint |
|---|---|---|
| request_id | string | Required and non-empty. |
| base_revision | integer | Required and equal to current revision. |
| label | string | Required, trimmed, concise, and bounded. |
| changes | PublicChange[] | Required, 2–100 ordered items. |

Creation changes may declare a unique ref. Later changes use an EntityReference containing either a stable ID or an earlier ref. The success result includes applied_changes, one history entry, one resulting revision, ChangeSummary, and the reference map.

The public change union uses the same user-intent names and action fields as direct tools. It is translated to the existing canonical Operation union before dispatch. A batch failure includes change_index and leaves state, history, selection, revision, and persistence notification unchanged.

Batch changes cover only the project mutations in Sections 10.3–10.7. Inspection, undo, redo, restore, playback, and export cannot appear inside apply_project_changes.

### 10.10 Common results

Mutation success has this conceptual shape:

~~~json
{
  "success": true,
  "result": {
    "changed": true,
    "deduplicated": false,
    "project_revision": 13,
    "history_entry_id": "797e...",
    "history_cursor": 7,
    "changes": {
      "created": {},
      "updated": { "track_ids": ["67ca..."] },
      "deleted": {}
    }
  }
}
~~~

Errors have this conceptual shape:

~~~json
{
  "success": false,
  "error": {
    "code": "TRACK_NOT_FOUND",
    "field": "track_id",
    "message": "No track exists with that ID.",
    "retryable": false
  }
}
~~~

Batch errors add a zero-based change_index. Revision conflicts add current_revision. Error messages do not repeat untrusted text unless necessary for correction.

### 10.11 Error codes

| Category | Codes |
|---|---|
| Shape and concurrency | INVALID_INPUT, INVALID_REFERENCE, INVALID_CURSOR, REVISION_CONFLICT |
| Missing entities | TRACK_NOT_FOUND, PATTERN_NOT_FOUND, CLIP_NOT_FOUND, HIT_NOT_FOUND, NOTE_NOT_FOUND |
| Musical constraints | OUT_OF_RANGE, KIND_MISMATCH, INCOMPATIBLE_INSTRUMENT, CLIP_OVERLAP |
| Product limits | CAPACITY_EXCEEDED, BATCH_TOO_SMALL, BATCH_TOO_LARGE |
| Dependencies | DEPENDENCIES_EXIST, FORWARD_REFERENCE, DUPLICATE_REFERENCE |
| History | NOTHING_TO_UNDO, NOTHING_TO_REDO, HISTORY_ENTRY_NOT_FOUND |
| Runtime | AUDIO_BLOCKED, EXPORT_FAILED, EXECUTION_CANCELLED, INTERNAL_ERROR |

### 10.12 Future registered tools

These contracts are reserved but remain unregistered until backing services are connected:

| Tool | Input | Result |
|---|---|---|
| play | optional start_bar and start_step | Starts or resumes and returns transport position. |
| pause | none | Pauses at the current musical position. |
| stop | none | Stops and resets to the beginning. |
| seek | bar and optional step | Moves to a one-based musical position. |
| export_wav | optional file_name | Renders a frozen project and initiates a WAV download. |

Transport and export do not create project history or increment project revision. play may return AUDIO_BLOCKED until a manual browser gesture unlocks audio. Export may require browser-mediated user interaction before download.

Autosave has no direct tool. It follows successful commits automatically, and its status appears in the project overview once integrated.

### 10.13 Deferred and excluded candidates

| Candidate tools | Why omitted | Reconsider when |
|---|---|---|
| duplicate_track | Track, pattern, and clip-copy semantics do not exist. | The product defines track duplication. |
| quantize_notes, transpose_notes, humanize_notes | No equivalent project or UI actions. | Musical transformation operations are implemented. |
| set_note_pitch, set_note_start, set_note_duration | Too granular for one edit-notes intent. | A distinct UX requires independent setters. |
| update_track, update_pattern, update_clip | Broad names overlap focused direct tools. | The focused registry proves materially harder to use. |
| edit_project, apply_operations | Exposes internal terminology and overlaps direct tools. | Never, unless the public strategy changes. |
| toggle_mute, toggle_solo | Retried toggles are not idempotent. | No need; explicit setters cover the intent. |
| get_tracks, get_pattern, get_arrangement | get_project views cover these reads. | One view becomes independently valuable or too complex. |
| save_project, load_project | Persistence is automatic application lifecycle behavior. | Users gain explicit multi-project or file workflows. |
| reset_project, clear_storage | Destructive recovery behavior lacks an approved WebMCP flow. | The UI exposes and confirms the same action. |
| select_track, select_pattern, open_activity, close_dialog | They manipulate presentation rather than project capability. | UI state itself becomes the desired agent output. |
| compose_song, generate_pattern, suggest_chords | Musical reasoning belongs to the external agent. | Only if the product intentionally adds an embedded model. |
| set_velocity, record_audio, loop_playback | The project and runtime do not support them. | Their corresponding product capabilities ship. |
| import_audio, import_project, export_project | File workflows are outside the current project model. | The UI supports the same imports or project files. |
| add_effect, automate_parameter | Effects and automation are out of scope. | The audio and project models add them. |
| sync_project, share_project | There is no account, backend, or authorization model. | Cloud projects are designed and implemented. |

This table is an evolution register, not a promised roadmap. A candidate is added only after it has a distinct user intent, a backing capability, shared validation, history behavior, and batch representation when applicable.

## 11) Security model

- WebMCP receives untrusted inputs and validates shape, type, bounds, identifiers, relationships, and caps before dispatch.
- The reducer and command service do not repeat boundary validation.
- Tool schemas use additionalProperties false, but runtime checks remain authoritative.
- Tools are not exposed to cross-origin documents through exposedTo.
- Project names and history labels render as text through React and are never interpreted as HTML.
- Tool descriptions are static source strings and contain no project or external content.
- Read outputs containing project names or history labels use untrustedContentHint true.
- The static sound catalog uses readOnlyHint true and untrustedContentHint false.
- Mutation tools use readOnlyHint false. The current draft has no destructiveHint or idempotentHint, so the design does not invent them.
- Destructive dependency behavior is explicit in parameters such as delete_clips.
- Command IDs namespace tool name and request ID to prevent collisions with manual command UUIDs or other tools.
- Results omit raw audio, complete snapshots, stack traces, internal exception text, and browser data unrelated to the active project.
- No secrets, credentials, OAuth, or network calls are introduced.

## 12) Operational guardrails

### 12.1 Limits

| Limit | Default |
|---|---:|
| Direct event items | 1–512, additionally bounded by resulting pattern cap |
| Batch public changes | 2–100 |
| Read page size | 20 default, 100 maximum |
| Project names | 1–80 characters after trimming |
| Track and pattern names | 1–40 characters after trimming |
| Request IDs | 1–128 characters |
| Batch labels | 1–80 characters after trimming |
| Local references | 1–64 ASCII letters, digits, underscores, or hyphens; start with a letter |
| Opaque cursors | At most 256 characters |
| WAV filenames | 1–120 characters after trimming |
| Arrangement | Existing 256-bar and 512-clip caps |
| History | Existing 100-entry and successful-command caps |

WAV filenames are sanitized to a safe download name and receive the .wav suffix when absent.

### 12.2 Local diagnostics

Track locally:

- Registration status and registration failures.
- Tool name, success or error code, and elapsed time.
- Revision conflicts and rejected batch change indexes.
- Batch size and validation failure category.
- Future audio-blocked and export-failure outcomes.

Diagnostics must not store complete tool inputs, note arrays, project snapshots, or user-authored text.

### 12.3 Health behavior

There is no server health endpoint. The studio exposes unsupported, registering, ready, or failed WebMCP status in its existing UI. Registration failure never disables manual editing. Each tool obtains fresh state at execution time rather than closing over a stale project.

## 13) Retention and lifecycle

- Tool registrations live only for the mounted studio document and are removed on unmount.
- Local references live only while one batch executes.
- Project revision and WebMCP registration status live for one page session.
- Successful request outcomes use the existing bounded command cache.
- History follows the existing 100-entry retention policy.
- Tool-selection eval fixtures remain in source control.
- WebMCP adds no cookies, IndexedDB stores, analytics, or server retention.

## 14) Deployment and rollout

### 14.1 Delivery sequence

1. Extract and prove shared validation without changing current UI behavior.
2. Add project revision and idempotent history-control commands.
3. Implement pure WebMCP contracts and thin direct adapters.
4. Implement local-reference resolution and apply_project_changes.
5. Register usable tools through the studio bridge.
6. Add UI synchronization and registration-status integration.
7. Add deterministic contract, equivalence, registration, and UI integration tests.
8. Add tool-selection eval fixtures and run browser acceptance.
9. Register playback and export only in later integrations that satisfy their contracts.

### 14.2 Compatibility

All existing manual UI behavior and canonical Operation variants remain compatible. Public WebMCP naming is separate from camelCase TypeScript and dotted internal operation types. Additive future tools do not change existing direct contracts. Changes to public semantics require a new documented interface revision rather than silent reinterpretation.

### 14.3 Rollback

The bridge is an additive client component. Removing its mount disables WebMCP registration while leaving the project, UI, persistence, and audio packages functional. Shared validation extraction must retain focused UI regression tests so it can be reverted independently if behavior changes.

## 15) Decision log

### Decision: Fine-grained user-intent tools

**Context:** Agents need discoverable actions that resemble how users describe DAW edits.

**Decision:** Expose focused direct tools for meaningful actions rather than a generic public mutation tool.

**Alternatives considered:**

- One edit_project operation union — smaller registry but a denser common schema.
- Whole-project replacement or JSON Patch — minimal surface but shifts invariant management to the caller.

**Trade-offs:** The registry is larger and needs tool-selection evaluation, while individual schemas and user-visible names remain focused.

### Decision: One separate atomic batch tool

**Context:** Song-level requests often require multiple dependent edits that must not partially apply.

**Decision:** apply_project_changes accepts 2–100 public changes and commits one canonical batch.

**Alternatives considered:**

- Sequential direct calls — can expose partial work and noisy history.
- A generic mutation tool for both single and multi-edit work — overlaps direct tools.

**Trade-offs:** The batch schema is intentionally more complex than direct schemas.

### Decision: Page-generated IDs with local references

**Context:** A batch may create an entity and use it in a later change.

**Decision:** Creation changes declare local refs; the page generates UUIDs and resolves later references.

**Alternatives considered:**

- Agent-generated UUIDs — simpler adapter but burdens callers and broadens ID validation.
- Forward references — allow arbitrary ordering but require a dependency graph.

**Trade-offs:** Batches must be dependency ordered and cannot reference future creations.

### Decision: Shared validation before trusted dispatch

**Context:** Current UI validation is distributed while the project reducer trusts typed callers.

**Decision:** Extract pure canonical validation used by both UI and WebMCP, leaving ProjectService and the reducer trusted.

**Alternatives considered:**

- Duplicate WebMCP validation — fastest initially but risks semantic drift.
- Move all validation into the reducer — changes the established internal contract and repeats boundary concerns.

**Trade-offs:** The UI must be migrated carefully with regression coverage.

### Decision: Register only usable capabilities

**Context:** Playback and export contracts are planned before their UI integrations are complete.

**Decision:** Document their stable contracts but omit them from the registry until usable.

**Alternatives considered:**

- Register placeholders returning unavailable — makes discovery advertise actions that cannot succeed.

**Trade-offs:** Agents must rely on current discovery rather than assume every documented future tool is present.

### Decision: One-based public musical positions

**Context:** Internal storage is zero-based while the UI and ordinary musical requests refer to bar and step one.

**Decision:** WebMCP accepts and returns one-based bars and pattern steps.

**Alternatives considered:**

- Expose internal zero-based values — avoids conversion but increases off-by-one mistakes.

**Trade-offs:** Adapters must consistently translate at the boundary.

## 16) Verification strategy

### 16.1 Deterministic tests

- Write tests before implementation changes.
- Preserve the current passing baseline.
- Test shared validation independently with no store or browser.
- Use table-driven contract tests for every direct mutation: schema rejection, translation, successful execution, domain errors, history attribution, undo, and stable result shape.
- Prove every direct mutation produces the same Project result as its equivalent public change through apply_project_changes.
- Test local refs, generated-ID maps, successive-state validation, forward and duplicate refs, size bounds, revision conflicts, idempotency, and atomic rollback.
- Test registration against a small fake modelContext, including unsupported browsers, exact names, cleanup, registration rejection, and omitted future tools.
- Invoke a registered mutation in a UI integration test and observe the visible project and Agent activity update.
- Run typecheck, lint, focused tests, the full test suite, and build before completion.

### 16.2 Tool-selection evals

Store cases using Chrome's documented messages and expectedCall structure. Cover:

- Direct requests selecting the intended dedicated tool.
- Correct arguments derived from user language and inspected IDs.
- Multi-edit requests selecting apply_project_changes.
- Single edits avoiding the batch tool.
- Requests that require inspection before mutation.
- Multi-step create, edit, arrange, undo, and correction journeys.
- Failure categories: wrong tool, wrong arguments, unnecessary batch, and missing required batch.

The corpus is runnable by an external probabilistic evaluator but adds no model SDK, credentials, or CI dependency. Deterministic tool code remains covered by the repository test suites.

### 16.3 Browser acceptance

1. Confirm supported-browser discovery shows exactly the usable tools.
2. Rename a track and observe one Agent activity entry and immediate UI update.
3. Create a pattern, notes, and placement through one local-reference batch.
4. Force a middle-batch validation failure and observe no project or history change.
5. Retry a successful request ID and observe no repeated mutation.
6. Make a manual edit between inspection and a guarded batch and observe REVISION_CONFLICT.
7. Undo, redo, and restore through WebMCP and compare with manual controls.
8. Confirm unsupported WebMCP leaves manual editing fully functional.
9. When integrated, confirm blocked audio and export failures are actionable and non-mutating.

## 17) Implementation checklist

### Shared project boundary

- [ ] Add failing shared-validation tests.
- [ ] Extract pure canonical validation from UI-only code.
- [ ] Migrate UI actions to shared validation without behavior changes.
- [ ] Add project revision and idempotent history-control contracts.

### WebMCP contracts and adapters

- [ ] Define common schemas, envelopes, error codes, and inspection views.
- [ ] Implement focused direct tools as thin canonical-operation adapters.
- [ ] Implement page-generated IDs and ordered local references.
- [ ] Implement apply_project_changes with successive validation and atomic dispatch.
- [ ] Implement history inspection and controls.

### Browser integration

- [ ] Add minimal document.modelContext typing and registration lifecycle.
- [ ] Mount WebMCPBridge with the existing live store.
- [ ] Expose registration status without affecting manual editing.
- [ ] Omit unavailable playback and export tools.

### Verification

- [ ] Add per-tool contract and direct-versus-batch equivalence tests.
- [ ] Add batch atomicity, idempotency, revision, and reference tests.
- [ ] Add registration and UI synchronization tests.
- [ ] Add tool-selection eval fixtures.
- [ ] Complete browser acceptance in a WebMCP-capable browser.
- [ ] Run test, typecheck, lint, and build.

## 18) Summary

- WebMCP exposes explicit user-intent tools backed by existing canonical operations.
- Direct calls create one Agent history entry; coordinated changes use one atomic batch entry.
- Manual and agent edits share validation, state, history, undo, redo, and restore.
- Project revisions guard stale batches while request IDs deduplicate retries.
- Page-generated UUIDs and ordered local references support dependent batch changes.
- Read tools provide compact paginated views rather than complete snapshots.
- Public bars and steps are one-based; internal data remains zero-based.
- Tool registration advertises only capabilities that currently work.
- Playback and export contracts are reserved for later usable integrations.
- No backend, cross-origin exposure, polyfill, model SDK, or new dependency is added.
