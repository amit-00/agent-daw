# WebMCP Main Integration Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` and complete each task in order with the listed verification checkpoints.

**Goal:** Rebase the WebMCP branch onto `origin/main`, preserve every newly introduced UI behavior, and expose the new playback and WAV export capabilities through the same application services.

**Architecture:** The Zustand studio store remains the single application boundary. UI controls and WebMCP tools call store actions; the existing provider subscription owns audio replacement and autosave side effects. WAV export reuses the production exporter, while the Transport keeps its local busy/error presentation.

**Tech Stack:** TypeScript, React, Zustand, Vitest, Testing Library, WebMCP browser API, Web Audio API

**Spec:** `docs/superpowers/specs/2026-09-02-webmcp-interface-design.md`

## Global constraints

- Treat `origin/main` as the behavioral baseline during conflict resolution.
- Keep manual UI preflight messages and run accepted mutations through the shared canonical operation validator.
- Do not add dependencies, a second store, a second project subscription, or a separate WebMCP playback/export implementation.
- Register WebMCP only after persistence bootstrap succeeds and the editor session mounts.
- Preserve Transport-local WAV export progress and error state; WebMCP export must not make the UI button appear busy.
- Keep tools that still lack production behavior absent from the registry.
- Write or update a failing test before each behavior change.

---

## Task 1: Rebase and preserve the main baseline

**Files:**

- Modify conflict files under `src/components/`, `src/stores/`, and `src/webmcp/` only as required by the rebase.
- Test: retain all existing tests from both histories.

1. Create a local recovery branch at the current head.
2. Run the full pre-rebase test suite and record the passing baseline.
3. Rebase `codex/webmcp-interface` onto `origin/main`.
4. Resolve each conflict main-first: retain persistence bootstrap, audio projections/actions, playhead seeking, export UI, and friendly manual validation; then reapply WebMCP status, dispatch, history, restore, revision, and idempotence behavior.
5. Run the smallest affected test file after each conflict group.
6. Run `pnpm test` after the rebase is structurally complete.
7. Commit only if the rebase leaves additional unstaged conflict-resolution corrections.

## Task 2: Reconcile the store, provider, history, and bridge lifecycle

**Files:**

- Modify: `src/stores/studio-store.ts`
- Modify: `src/stores/studio-provider.tsx`
- Modify: `src/components/Studio.tsx`
- Modify: `src/components/Transport.tsx`
- Modify: `src/webmcp/WebMCPBridge.tsx`
- Test: `src/stores/studio-store.test.ts`
- Test: `src/stores/studio-provider.test.tsx`
- Test: `src/components/Studio.test.tsx`

1. Add failing tests proving a changed WebMCP mutation triggers the existing project subscription once, while replay, no-op, and failure trigger neither audio replacement nor autosave.
2. Add failing tests proving enabled manual and WebMCP history jumps stop playback, unavailable/replayed jumps do not, and retained restore follows main’s stop semantics.
3. Add a failing mount test proving tools are absent during loading/recovery and registered only inside a ready `StudioSession`.
4. Merge the store constructor signature and provider subscription from main with the WebMCP dispatch/history/status methods.
5. Route both UI and WebMCP history through the same stop-aware store actions without duplicating provider effects.
6. Mount `WebMCPBridge` only in the ready studio session and merge its status presentation into the current Transport.
7. Run the three focused test files, then typecheck the changed boundary.
8. Commit as `feat: integrate WebMCP with studio services`.

## Task 3: Activate playback tools through store actions

**Files:**

- Modify: `src/stores/studio-store.ts`
- Modify: `src/components/Transport.tsx`
- Modify: `src/webmcp/contracts.ts`
- Modify: `src/webmcp/tools.ts`
- Test: `src/stores/studio-store.test.ts`
- Test: `src/webmcp/contracts.test.ts`
- Test: `src/webmcp/tools.test.ts`

1. Add failing contract tests for `play`, `pause`, `stop`, and `seek`, using one-based public bar/step positions.
2. Add failing handler tests for success, invalid/out-of-range positions, empty projects, unavailable audio, blocked audio, and cancellation during play preparation.
3. Add the minimum explicit store actions needed for play and pause; reuse the existing stop and seek actions and make UI `playPause` delegate to them.
4. Implement the four WebMCP handlers through those store actions. On cancelled play, stop playback to invalidate any late audio preparation.
5. Return typed public playback state and actionable error codes: `AUDIO_BLOCKED`, `AUDIO_UNAVAILABLE`, `NOTHING_TO_PLAY`, `EXECUTION_CANCELLED`, `INVALID_INPUT`, or `OUT_OF_RANGE`.
6. Run the focused store, contract, tools, and Transport tests.
7. Commit as `feat: expose playback through WebMCP`.

## Task 4: Activate WAV export through the production exporter

**Files:**

- Modify: `src/audio/exporter.ts`
- Modify: `src/components/Transport.tsx`
- Modify: `src/webmcp/contracts.ts`
- Modify: `src/webmcp/tools.ts`
- Test: `src/audio/exporter.test.ts`
- Test: `src/webmcp/contracts.test.ts`
- Test: `src/webmcp/tools.test.ts`
- Test: `src/components/Transport.test.tsx`

1. Add failing exporter tests for an optional filename, safe sanitization, a single `.wav` suffix, and cancellation before download.
2. Add failing WebMCP tests for export success, invalid filename length, cancellation, and mapped renderer/download failures.
3. Extend `downloadProjectWav` with one options object carrying the optional filename and signal; preserve the current default UI behavior.
4. Check cancellation before and after rendering and before the anchor click. Pass the signal to sample fetches where supported; do not add a new cancellation framework for offline rendering.
5. Implement `export_wav` by cloning the current project and calling the shared exporter. Return the actual filename and map failures to `EXECUTION_CANCELLED`, `INVALID_INPUT`, or `EXPORT_FAILED` without exposing raw errors.
6. Keep Transport’s `exporting` and `exportError` state local by having it call the same exporter with default options.
7. Run the focused exporter, contract, tools, and Transport tests.
8. Commit as `feat: expose WAV export through WebMCP`.

## Task 5: Update discovery, documentation, evaluations, and verify the branch

**Files:**

- Modify: `src/webmcp/contracts.ts`
- Modify: `src/webmcp/tools.ts`
- Modify: `src/webmcp/register.test.ts`
- Modify: `src/webmcp/tool-selection.eval.test.ts`
- Modify: `docs/superpowers/specs/2026-09-02-webmcp-interface-design.md`
- Test: relevant WebMCP and integration test files.

1. Add a failing overview test for public persistence status and optional `updated_at`, excluding save tokens and raw persistence errors.
2. Add failing registry tests for the exact 41-tool surface and selection evaluations for playback, seeking, and export requests.
3. Expose the persistence projection in `get_project` overview and activate the five new tools in discovery.
4. Update the interface design: move `play`, `pause`, `stop`, `seek`, and `export_wav` from reserved to active; document the new error codes; leave recording, looping, and other unsupported capabilities listed as omitted.
5. Run focused tests, then `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`.
6. Inspect `git diff origin/main...HEAD` for unintended changes and run the existing browser acceptance path for registration, UI synchronization, playback, and export where the environment supports it.
7. Commit as `docs: update the WebMCP interface surface` if documentation/evaluation changes remain.
8. Force-push with lease to update PR #11 only after all verification passes.
