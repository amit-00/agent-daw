# Domain-Scoped Project Reducers Design

Date: 2026-09-03

Status: Approved for implementation.

Issue: [#7](https://github.com/amit-00/agent-daw/issues/7)

Branch: `codex/issue-7-domain-reducers`, based on `origin/main` at `0a58a72`.

## Goal

Make project operations easier to navigate and change by giving each project domain its own operation union, reducer, and focused tests without changing runtime behavior or serialized command history.

## Trigger

The deferred refactor is now warranted: `src/project/reducer.ts` contains 17 operation cases across six domains, and `test/project.test.ts` has grown to 1,544 lines. Both files now impose the review and merge-conflict costs described in issue #7.

## Architecture

Add one module per existing domain under `src/project/operations/`:

- `project.ts`
- `track.ts`
- `pattern.ts`
- `arrangement.ts`
- `drum-hits.ts`
- `synth-notes.ts`

Each module owns its serializable discriminated operation union and pure reducer. `commands.ts` composes those six unions into the public `Operation` type, so `Command`, `HistoryAction`, and current consumers keep their existing imports.

`reducer.ts` remains the public entry point. It owns project-wide diff summarization and a small exhaustive router that narrows each operation to its domain reducer. Shared reducer helpers contain only logic used by multiple domains: JSON equality, change-summary construction, and pattern replacement.

```text
Command / history / WebMCP operation
                  │
                  ▼
       exhaustive reduceOperation router
          │       │       │       │
          ▼       ▼       ▼       ▼
       domain reducers (pure Project → Reduction)
                  │
                  ▼
        ProjectService sequencing/history
```

## Compatibility

Keep every existing flat `type` value, including `project.update`, `track.create`, `drum-hits.add`, and `synth-notes.delete`. This preserves browser-session history serialization and the shipped WebMCP-facing operation shape. No migration or legacy fixture is required because stored project data does not contain commands or history.

The exports from `src/project/index.ts`, the `Operation` import path, reducer behavior, change-summary ordering, no-op identity behavior, batching, deduplication, undo, redo, and restore remain unchanged.

## Exhaustiveness and Errors

The root router and every domain reducer end in a typed `never` assertion. TypeScript therefore fails when a new operation is added without both domain handling and root routing. If an untyped runtime caller bypasses the existing validation boundary, the assertion throws an actionable error naming the unsupported operation type instead of returning `undefined`.

## Tests

First add a failing routing regression test for an unsupported runtime operation. Then implement the exhaustive assertion and domain routing.

Split `test/project.test.ts` into focused domain reducer tests plus project-service and shared reducer tests. Reuse a small fixture module rather than duplicate project builders. Preserve every current assertion, including direct dispatch, mixed-domain batches, change summaries, input immutability, serializable history, deduplication, and undo/redo.

Required verification:

- `pnpm test:project`
- `pnpm typecheck`
- `pnpm test`
- `pnpm lint`
- `pnpm build`

## Non-goals

- No nested domain/action discriminator.
- No operation classes, factories, registry, middleware, or plugin system.
- No validation changes or new dependencies.
- No behavior changes in `ProjectService`.
- No unrelated project-domain refactoring.

## Risks

The primary risk is a mechanical test move dropping coverage or changing an import. Preserve test bodies verbatim where possible, compare test counts before and after, and use the full suite plus typecheck to catch omissions. The second risk is accidental serialized-shape drift; retaining the existing discriminant strings avoids it.
