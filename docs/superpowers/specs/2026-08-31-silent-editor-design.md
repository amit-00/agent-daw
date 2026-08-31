# Silent Editor UI Design

Date: 2026-08-31

Status: Agreed scope documented; implementation has not started.

Branch: `codex/silent-editor`, based on `b3a3463` (pnpm migration).

Implementation: [Silent editor plan](../plans/2026-08-31-silent-editor.md).

# 1) Goals and Scope

## 1.1 Outcomes

1. Replace the disconnected UI fixtures with an editable project, without redesigning the desktop workstation.
2. Create and manage tracks, reusable patterns, and arrangement clips; move and repeat clips on a bar grid.
3. Edit drum hits and pitched notes, including chords, with changes retained when switching selections.
4. Edit mixer values and navigate real, undoable history through the existing project service.
5. Migrate from track-owned patterns to independent patterns without changing existing music or enabling audible playback.

## 1.2 Non-goals

Audible playback, note preview/audition, recording, looping playback, export, autosave UI integration, WebMCP integration, audio clips/import, effects, automation, sound design, mobile/tablet layouts, and a broad visual redesign are excluded. Audio compatibility work maintains the existing engine; it does not connect transport or editor gestures to it.

## 1.3 Global constraints

- Use Node.js >=23.6 and pnpm 10.17.0; retain `pnpm-lock.yaml` as the only package-manager lockfile.
- Use the existing React, Next.js, Tailwind, Zustand, and test tooling; add no dependencies without explicit approval.
- Keep the current desktop layout and visual language; this milestone changes interactions, not the overall design.
- Route committed musical edits through `ProjectService`; do not create a second editable project or history implementation.
- Trust typed internal callers; do not add generic `isRecord`, `assertRecord`, checked-getter, or command-schema infrastructure, or repeated whole-project runtime validation.
- Check concrete musical constraints once at the UI editing boundary; decode unknown persisted data only at a persistence boundary.
- Keep this milestone silent: no playback, recording, export, or audible note preview.
- Work test-first in small functional slices, with human review before proceeding to the next slice.

# 2) Glossary and Ownership

| Term | Meaning |
| --- | --- |
| Track | Ordered instrument lane: drum kit or synth preset, name, volume, pan, mute, and solo. |
| Pattern | Reusable project-level musical content: drum hits or synth notes, a name, and a length. It does not own an instrument or belong to a track. |
| Arrangement clip | Placement of a pattern on a particular track at a starting bar, repeated a whole number of times. |
| Bar / step | A bar is four beats; a step is one sixteenth note. There are 16 steps per bar. Stored bars and steps are zero-based; displayed labels are one-based. |
| Make unique | Copy a clip's pattern and its events, then point only that clip at the copy. |
| Gesture | One pointer drag/paint/resize or continuous control adjustment, previewed locally and committed once. |
| Note preview | Audibly playing a note when adding, selecting, or dragging it. This is excluded; visual previews remain included. |
| Restore | Make the project match a retained history entry's after-snapshot, as a new undoable action. |

```text
Project
├── ordered tracks ── instrument + mixer settings
├── patterns ──────── drum hits or synth notes
└── clips ─────────── patternId + trackId + startBar + repeatCount
                         │          │
                         └─ content └─ instrument/routing
```

One pattern may be unplaced, placed repeatedly on one track, or shared across compatible tracks. A pattern sidebar selection must never imply that there is exactly one associated clip or track.

# 3) Current System and Implementation Boundaries

The current domain has `Pattern.trackId`; clips reference only patterns. The UI has a different prototype model (`Pattern.clipId`, percentage-positioned clips, fixed track IDs) and canned activity. Grid edits, mute, and solo live outside the domain; some controls are inert or simulate playback.

The domain already has typed operations, pure reduction, atomic command batches, no-op detection, detached snapshots, source attribution, undo/redo, and restore. Reuse these. The audio engine is present on this branch, and its timeline currently derives routing from the pattern's track.

| Existing area | Responsibility in this change |
| --- | --- |
| `src/project/` | Ownership migration, track reorder, existing commands and history. |
| `src/stores/studio-store.ts` | UI state and the bridge to one project-service instance. |
| `src/types/studio.ts`, `src/data/studio-data.ts` | Remove duplicate musical models; retain only presentation metadata and an explicit domain-shaped demo project. |
| `src/components/arrangement/` | Track management, bar-based clip rendering, placement and gestures. |
| `src/components/editor/` | Pattern library, drum grid, piano roll, and controlled mixer. |
| `src/components/Transport.tsx`, `ActivityPanel.tsx` | Real history controls; honest silent/unsaved status. |
| `src/audio/catalog.ts`, `timeline.ts` | Reuse catalog metadata; route timeline events through clips. |
| `test/`, colocated UI tests | Existing Node test runner and Vitest/Testing Library; no new test framework. |

`src/persistence/service.ts` exists only on the unfinished `codex/project-persistence` branch. It is not available in this checkout and still depends on older domain validation APIs. Do not merge or rewrite that branch as an incidental UI task. Deliver the typed schema converter here and record the loader integration requirements in section 9.

# 4) Architecture and State Flow

```text
Pointer / keyboard / menu / native input
                 │
                 ▼
Typed UI edit action ─── invalid intent ──► actionable UI message
                 │ valid operation or atomic batch
                 ▼
          ProjectService
          project + history
                 │ publish the committed snapshot
                 ▼
           Zustand render state
                 │
                 └──► arrangement / pattern editor / mixer / activity

Selection, focus, open panels, and gesture previews stay in UI state.
Pointer movement never dispatches project commands.
```

## 4.1 Project service and store bridge

The service owns committed musical state. Store actions dispatch commands or history controls, then publish the service's current state for subscribed React components. No service event bus is needed for this milestone: all UI mutations go through this bridge. A future external adapter must use the same publishing path or add a service subscription when that integration actually exists.

Each mounted workstation owns its store/service instance, avoiding cross-instance state leaks and giving tests isolated sessions. Zustand holds the service snapshot for rendering, not an independently mutable song. Do not mirror track mixer values in sets or notes in a separate step array. Unexpected service errors propagate; anticipated editing conflicts are explained before dispatch.

## 4.2 Selection and rendering

Selection consists of nullable track, pattern, and clip IDs plus editor-local selected note IDs. Selecting a clip selects its pattern and track. Selecting a pattern from the library clears clip-specific context; it may be edited without any placement. Clear references that disappear after delete/undo/restore, and show an empty-state prompt instead of using unchecked prototype getters.

Track colors and friendly preset labels are presentation metadata, not new musical fields. Derive clip labels, event thumbnails, positions, and widths from the current project. The displayed arrangement must scroll to cover placements through the 256-bar cap rather than hiding everything after the prototype's eight bars. Show pattern usage counts and, when relevant, the selected clip's instrument context.

## 4.3 Editing boundary

Use named typed actions for the interactions in section 6. Reuse the existing operation types and only extract small musical calculations when multiple interactions need them. Do not add a parallel generic action language, arbitrary command parser, or validation framework.

Validate actual text/numeric input and the affected musical relationships: existence after a stale selection, bounds, overlap, kind/kit compatibility, and resource limits. A rejected edit changes neither the project nor history. Disable impossible menu options when known in advance, but recheck against the current project on commit because undo or another edit may have invalidated a preview.

# 5) Data Model and Invariants

## 5.1 Schema version 2

| Entity | Fields | Change |
| --- | --- | --- |
| Project | `schemaVersion: 2`, `id`, `name`, `bpm`, `masterVolumeDb`, ordered `tracks`, `patterns`, `arrangement` | Bump schema version; collections remain arrays. |
| Track | `id`, `name`, `kind`, `instrumentId`, `volumeDb`, `pan`, `muted`, `soloed` | No added fields. Array order controls arrangement and mixer order. |
| Drum pattern | `id`, `name`, `kind: "drum"`, `lengthBars`, `events: DrumHit[]` | Remove `trackId`. |
| Synth pattern | `id`, `name`, `kind: "synth"`, `lengthBars`, `events: SynthNote[]` | Remove `trackId`. |
| Clip | `id`, `patternId`, `trackId`, `startBar`, `repeatCount` | Add required `trackId`. |
| Drum hit | `id`, `soundId`, `startStep` | Unchanged; stable catalog sound IDs. |
| Synth note | `id`, `midiNote`, `startStep`, `lengthSteps` | Unchanged; chords supported. |

IDs remain stable strings; new UI entities use fresh IDs. Clip references resolve to existing patterns and tracks. Drum patterns can only use drum tracks; synth patterns can only use synth tracks. A drum track's kit must provide every sound used by its placed patterns. Sharing does not require a routing table, separate instrument entity, database index, or pattern-to-track mapping cache.

The clip occupies the half-open interval `[startBar, startBar + lengthBars × repeatCount)`. Two clips on the same track conflict only if their intervals overlap; adjacency is legal. Pattern length changes evaluate all referencing clips using the proposed length, including collisions between two references to the same pattern.

## 5.2 Ownership and destructive actions

| Action | Result |
| --- | --- |
| Edit/rename a pattern | All referencing clips reflect the change. |
| Duplicate a clip | New clip ID; shares the existing pattern; initially follows the source on the same track if that placement is valid. Reject a blocked destination rather than silently searching/moving other clips. |
| Duplicate a pattern | New pattern and event IDs; creates an unplaced library item. |
| Make unique | Duplicate pattern/events and repoint the selected clip in one atomic history entry. |
| Move a clip across tracks | Change only placement/routing fields; keep its pattern ID. Reject incompatible tracks. |
| Delete a clip | Remove the placement; keep the pattern and events. |
| Delete a track | Remove the track and its clips only; keep all patterns, including newly unplaced ones. Confirm when clips will be removed. |
| Delete a pattern | Remove the pattern, events, and every referencing clip across tracks. Confirm with the number of affected placements. |

Each destructive action is undoable. Cancelling confirmation does nothing. History change summaries must match these cascades; track deletion must no longer claim that it deleted retained patterns/events.

# 6) Interaction Contract

| ID | Surface | Required behavior |
| --- | --- | --- |
| UI-1 | Track header / Add track | Add drum or synth track with an appropriate kit/preset; rename, change preset, reorder, delete. Track kind stays fixed. Offer Move up/Move down alongside drag reorder. Mixer order follows track order. |
| UI-2 | Pattern library | Create an unplaced drum/synth pattern; select, rename, choose 1/2/4 bars, duplicate, delete, and place on a compatible track at a bar. Sidebar drag has a Place action with track/bar inputs as an alternative. |
| UI-3 | Empty lane | Double-click an empty bar to create a new one-bar pattern and its first clip in one history entry. Provide a keyboard/menu Create pattern here equivalent. |
| UI-4 | Arrangement clip | Select, move by whole bars, move between compatible tracks, duplicate, delete, and Make unique. Right-edge resize changes whole-pattern repeat count, not arbitrary trimming or note stretching. Provide numeric start/repeat/track controls. |
| UI-5 | Drum editor | Named catalog sound rows; toggle hits; paint or erase across steps in one gesture. Visiting a cell twice in one stroke does not toggle it twice. |
| UI-6 | Piano roll | Pitch/time grid; add, select, move, resize, duplicate, delete notes; support simultaneous pitches. Sixteenth-step snapping, minimum one-step duration, MIDI 24–96. Include keyboard/numeric alternatives to dragging. |
| UI-7 | Mixer | Controlled track dB volume, pan, mute, solo, and master dB volume; exact visible values; changes synchronized with track headers and history. No fabricated meters or master-pan field. |
| UI-8 | History / transport | Actual manual/agent-attributed entries, Undo, Redo, and Restore. Disable unavailable actions and show the history cursor. Playback, record, loop, and export remain disabled with an explanation. No fake running time, output level, or moving playhead. |
| UI-9 | Cross-cutting | Empty states, focus-aware shortcuts, cancelled gestures, invalid-drop feedback, stable selection, one history entry per completed edit, and an explicit indication that edits are in memory and lost on refresh. |

Project name and BPM must display project state rather than fixture text. Making those fields editable is not required for this milestone. Fixed snap/zoom labels must not look like working controls if no interaction is provided.

## 6.1 Gesture lifecycle

1. Capture the affected entity ID, starting values, pointer position, and geometry at gesture start. Pointer capture keeps release/cancel observable outside the original target.
2. Calculate a snapped candidate from the original values and current position; account for lane/grid scroll offsets. Keep preview state out of the service and preserve the pointer's grab offset.
3. Preview validity and the proposed placement/note/slider value. Do not shift other clips or truncate notes to make a candidate fit.
4. On release, resolve current entities and recheck the affected constraints. Commit one operation or batch only if values changed and the candidate remains valid.
5. Escape, pointer cancellation, lost capture, or unmount discards an unfinished preview. Invalid release preserves the original state and explains why. Ensure a release followed by lost capture cannot commit twice.

Keyboard actions invoke the same typed edit action. Text inputs, selects, contenteditable regions, and active dialogs retain their native keys; Delete and undo shortcuts must not alter the song while the user edits a field. A keyboard range adjustment commits on key release; a text value commits on Enter or blur without a duplicate commit. Escape restores the committed value.

## 6.2 Shared drum content

Use catalog metadata without creating an audio context or loading samples. A placed pattern's edit must remain playable by every referencing drum track's kit. For an unplaced pattern, offer the bundled catalog's named sounds; placement performs the kit-compatibility check. Kit changes inspect every pattern placed on that track. Reject unsupported sounds with a useful message rather than dropping hits or silently copying the pattern.

# 7) Bounds and Failure Behavior

| Limit | Value / policy |
| --- | --- |
| Track / pattern / clip count | 16 / 128 / 512, from `PROJECT_CAPS`. |
| Events per pattern / operations per batch | 512 / 100, from `PROJECT_CAPS`; aggregate paint/note updates into existing multi-event operations. |
| Arrangement extent | Clip end at or before bar 256; zero-based start is non-negative. |
| Pattern length / repeats | 1, 2, or 4 bars / integer 1–64. |
| Event bounds | Integer start step in pattern; synth length a positive integer ending within the pattern; MIDI 24–96. |
| Mixer | Track -60 to +6 dB; master -60 to 0 dB; pan -1 to +1. |
| Names | Track 1–40 characters; use the same 1–40 UI limit for new pattern names. Trim whitespace; do not silently rename another entity. |
| History / command cache | Existing service retention: 100 entries / 100 successful command IDs. |

Pattern shrinkage that would cut off events is rejected, not auto-trimmed. Expansion that overlaps any placement or exceeds the arrangement extent is rejected. Pattern creation plus placement and Make unique check their combined caps before dispatch, leaving no orphan copies if the edit is refused.

Expected failures appear beside the relevant control or in an accessible status message: for example, “This would overlap Beat on Drums” or “Shorten the note ending at step 20 before choosing 1 bar.” No console-only errors for user mistakes. Stale selection is cleared; stale edit targets produce a message and no mutation. Native controls, labels, visible focus, and non-drag alternatives are mandatory.

There are no new network services, secrets, permissions, telemetry, or background jobs. Render names as text, never HTML. Persisted data is untrusted when a loader is integrated; typed in-memory data is not repeatedly re-decoded.

# 8) History and Session Lifecycle

All user edits are `source: "manual"` commands with descriptive labels. Display existing `source: "agent"` accurately when supplied; do not fabricate activity to demonstrate it. Pure selection, previews, confirmations, rejected actions, and no-ops create no history entry. A new edit after undo uses the service's existing redo-branch behavior.

Restore uses the selected entry's after-snapshot and is itself undoable. Reconcile selection after undo, redo, restore, and deletion. Retained history is bounded by the service; unavailable/pruned entries cannot be restored through a stale UI reference.

The milestone is an in-memory session. No writes to browser storage are introduced. Refresh starts a fresh session, so the UI must not claim that changes have been saved. Migration rollback does not recover an unsaved session; preserve legacy records when persistence integration eventually occurs.

# 9) Migration and Compatibility

## 9.1 Typed project conversion

1. Accept a typed schema-1 project at the conversion boundary; preserve its original value.
2. Resolve each clip's pattern and copy the old pattern's `trackId` into the clip.
3. Remove `trackId` from every pattern, including unplaced patterns, and set schema version 2.
4. Preserve every ID, event, bar position, repeat count, track order, instrument, and mixer value. Do not create a history action for loading/conversion.
5. Return a schema-2 project unchanged when the version-aware converter receives one. A legacy dangling clip reference produces a specific conversion error; never guess a target track or silently drop music.

This is a narrowly typed converter, not a general import system or a reason to restore deleted domain validators.

## 9.2 Audio compatibility, without playback integration

Update timeline expansion to resolve the instrument from `clip.trackId`. Keep missing-reference diagnostics accurate. Existing event keys already include clip IDs, so the same pattern placed on two tracks must produce separate events routed to the two instruments. Update fixtures and tests in the same slice as the schema change so the existing audio engine remains buildable.

## 9.3 Persistence integration gate

The separate persistence branch currently stores a project plus update time, not retained history. Before that feature can be integrated, its loader must decode supported external versions once, call the converter, accept version 2 on save, and stop depending on removed internal validation APIs. Unsupported or corrupt records must remain recoverable; no automatic clearing or replacement with a demo project.

Do not rewrite a stored schema-1 record until conversion and validation at the storage boundary succeed; preserve an original recoverable copy before an upgrade write. The IndexedDB database version is separate from the project schema version and only changes if storage layout requires it. If durable history is added later, its snapshots and operation payloads need their own version-aware migration rather than being assumed compatible.

Loader/storage integration is a named follow-up gate, not an excuse to merge the unfinished persistence worktree or claim autosave here. Rolling application code back must not entail deleting project records; older loaders must report unsupported schema rather than overwrite newer data.

# 10) Decisions and Trade-offs

| Decision | Alternatives considered | Reason and cost |
| --- | --- | --- |
| Independent patterns; clips select tracks | Track-owned patterns; clip-owned content | Enables reuse across instruments and standalone library items. Costs explicit shared-edit UI, compatibility checks, and schema migration. |
| Shared by default, explicit Make unique | Copy on every move/duplicate | Preserves intentional reuse and avoids hidden copies. Users must see usage counts because edits can affect multiple placements. |
| Existing command service + Zustand bridge | Direct component mutations; new state/history framework | Reuses atomicity and history. Requires every mutation path to publish through one bridge. |
| Targeted UI musical checks | Generic runtime schema checks throughout the app | Maintains valid edits without undoing the trusted-domain refactor. Each future external adapter remains responsible for its own input boundary. |
| Whole-pattern clip resizing | Arbitrary trim, stretch, or partial loops | Matches `repeatCount` and keeps scope small. Fine-grained clip trimming is not available. |
| Silent and in-memory first | Simultaneous playback/autosave integration | Makes editor behavior independently testable. A working composition is not yet audible or durable. |

# 11) Delivery and Acceptance

- [ ] Model: independent patterns, clip routing, safe deletion, reorder, version conversion, and audio routing regressions pass.
- [ ] State bridge: one committed project/history, per-session isolation, no fixture-backed musical state, and safe empty selections.
- [ ] Track/pattern workflows: UI-1, UI-2, and UI-3 work through both direct and accessible controls.
- [ ] Arrangement: UI-4 supports valid cross-track moves, repeats, shared duplication, and Make unique; invalid/cancelled gestures are non-mutating.
- [ ] Pattern editors: UI-5 and UI-6 modify actual events and every shared preview; switching patterns never loses edits.
- [ ] Mixer/history: UI-7 and UI-8 are controlled, undoable, and truthful about silence.
- [ ] Cross-cutting: UI-9, resource caps, keyboard focus, errors, and current desktop layout pass automated and browser review.
- [ ] Integration: document the separate persistence gate; do not report audible playback, autosave, or WebMCP as complete.

The [implementation plan](../plans/2026-08-31-silent-editor.md) supplies file-level slices and checks. This document supersedes the track-owned-pattern model for this milestone in the [original product design](../../design.md) and [historical domain design](2026-08-25-project-domain-design.md); broader product aspirations in those documents are not all part of this change.
