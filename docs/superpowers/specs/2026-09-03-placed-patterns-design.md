# Placed Patterns and Arrangement-Owned Editing Design

Date: 2026-09-03

Status: Approved for implementation planning.

Branch: `codex/remove-project-patterns-sidebar`, based on `ee37b85`.

## 1. Goal

Remove the project-patterns sidebar and make the arrangement the only manual entry point for creating, selecting, and managing patterns. Every pattern in a committed project must have at least one arrangement clip.

This change keeps reusable patterns: multiple clips may still reference one pattern, and editing shared content updates every placement. It changes the previous rule that patterns could exist independently of clips.

## 2. User Experience

- Remove `PatternSidebar` from the lower editor and let the drum grid or piano roll use the full editor width.
- Selecting an arrangement clip selects its pattern and opens that pattern in the lower editor.
- With no selected clip, the lower editor asks the user to select or create a clip; it does not offer a pattern library.
- Create a pattern and its first clip atomically by double-clicking an empty lane position or using **Create pattern here** in track settings.
- Put pattern rename, length, duplicate-with-placement, and delete-all-placements controls in the existing clip `•••` dialog alongside its placement controls.
- **Duplicate clip** continues to create another clip sharing the same pattern.
- **Duplicate pattern** copies the pattern and its events, then places the copy at a user-selected track and bar in one action.
- **Make unique** copies and redirects a clip only when its pattern has multiple placements. It is a no-op when the selected clip is already the pattern's sole placement.
- **Delete clip** removes the pattern too when that clip was its last placement.
- **Delete pattern** removes the pattern, its events, and every placement after confirmation.
- Deleting a track removes its clips and any patterns that consequently have no placements; shared patterns placed elsewhere remain.

## 3. Project Invariant and Transactions

A committed `Project` is valid only when every `project.patterns` entry is referenced by at least one `project.arrangement` clip. The stored schema remains version 2 because no field or representation changes; this is a tightened relationship invariant.

Keep the existing low-level pattern and arrangement operations. A transaction may temporarily contain a pattern before its first clip while its ordered operations are evaluated, but the final project must satisfy the invariant.

Use one shared transaction-finalization path for manual commands, WebMCP commands, and batches:

1. Apply and validate the ordered operations using the existing rules.
2. Remove patterns not referenced by the resulting arrangement.
3. Reject creation or duplication when the requested transaction did not produce a placement for the new pattern.
4. Compute the final change summary from the transaction's initial and finalized projects so automatic pattern and event deletions appear in history and activity.
5. Commit the finalized project as one undoable history entry.

Central finalization covers direct clip deletion, track deletion, changing a clip's pattern, and any future operation that can remove the last reference. Do not duplicate orphan cleanup across UI and WebMCP callers.

Undo, redo, and restore move only between finalized snapshots. Undoing deletion of a last clip restores both the clip and its pattern.

## 4. Persistence Compatibility

After decoding and relationship-checking an existing schema-1 or schema-2 record, remove patterns that have no clips before returning the project to the application. This normalization is silent, creates no history entry, and does not rewrite the stored record merely because it was loaded.

Malformed clips and other corrupt data retain the current recovery behavior. Loading must not invent a track or placement for an orphan pattern.

Remove the bundled `Unused idea` orphan from the demo project. Empty projects remain valid because they contain neither patterns nor clips.

## 5. WebMCP Contract

- `create_pattern` requires `placement` containing `track_id`, one-based `start_bar`, and optional `repeat_count`; success returns both `pattern_id` and `clip_id`.
- `duplicate_pattern` gains the same required `placement`; success returns both generated IDs.
- Batch forms of pattern creation and duplication also require placement and remain atomic.
- `place_pattern` remains available for adding another placement of an existing pattern.
- `delete_clip`, `delete_track`, `change_clip_pattern`, and `make_clip_unique` descriptions and results reflect automatic orphan cleanup.
- `make_clip_unique` returns a successful no-op for a sole-placement pattern and creates no history entry.
- `delete_pattern` retains explicit cascade authorization because every valid pattern has at least one dependent clip.
- Project reads never return orphan patterns.

Invalid placement, overlap, capacity, kind, or instrument compatibility rejects the whole create or duplicate request. No pattern or clip is partially committed.

## 6. Component and Store Changes

- Delete `PatternSidebar` and the unplaced `AddPattern` flow.
- Simplify `PatternEditor` to render one selected clip's pattern at full width.
- Merge the useful `PatternSettings` controls into `ClipSettings`; reuse the existing destination-track compatibility control for duplicate-with-placement.
- Remove the manual store action that creates an unplaced pattern.
- Change manual pattern duplication to require a destination and create the copied pattern plus clip atomically.
- Preserve derived clip/pattern/track selection reconciliation after commands and history navigation.
- Update track-deletion copy so it no longer claims patterns remain when orphaned patterns will be removed.

No new dependency, alternate state container, or replacement command language is needed.

## 7. Failure and Edge Cases

- Creating or duplicating requires both a free pattern slot and a free clip slot.
- A destination that overlaps another clip, exceeds bar 256, uses the wrong track kind, or lacks drum sounds fails without changing project or history.
- Reassigning the sole clip of one pattern to another pattern deletes the old orphan pattern.
- Reassigning one of several clips preserves the old shared pattern.
- Deleting a track prunes only patterns whose remaining placement count becomes zero.
- Deleting the last track may leave an empty project, but never a project containing patterns without clips.
- Shared pattern rename, length, and event edits continue to affect every placement and retain current compatibility checks.
- Selection is cleared when its clip or pattern is deleted; stale dialogs fail safely through existing store checks.

## 8. Verification

Development remains test-first. Add or update focused tests for:

- transaction finalization and accurate change summaries;
- creation/duplication without placement rejection;
- clip deletion, track deletion, reassignment, shared patterns, and sole-placement `make_clip_unique`;
- undo, redo, restore, and selection reconciliation;
- schema-1 and schema-2 load normalization without mutating the stored source value;
- required WebMCP placement schemas, validation, generated IDs, batching, and tool descriptions;
- removal of the pattern sidebar, full-width pattern editor, arrangement-only creation, and combined clip/pattern settings;
- demo and empty-project validity.

After focused tests pass, run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`. Start the worktree dev server and verify the complete create, edit, share, duplicate, delete, track-delete, and undo flows in the browser.

## 9. Non-goals

- Changing the pattern, clip, track, or project field shapes.
- Adding a replacement library, hidden orphan archive, trash, or recovery UI.
- Automatically choosing a placement for legacy orphan patterns.
- Changing shared-pattern editing semantics, clip repetition, audio rendering, or arrangement gestures beyond orphan cleanup.

This design supersedes the unplaced-pattern ownership and deletion behavior in the silent-editor and WebMCP interface designs. Their remaining architecture and interaction decisions stay in force.
