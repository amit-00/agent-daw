# AgentDAW

AgentDAW is a browser-based pattern sequencer. The current milestone is a silent,
in-memory editor: manual UI actions edit one project, mixer, and visible history.

## Product

The current editor supports:

- Creating, renaming, reordering, configuring, and deleting tracks.
- Creating reusable drum or synth patterns and arranging shared clips.
- Moving clips across compatible tracks, repeating them, and making copies unique.
- Programming drums on a step grid and notes or chords in a piano roll.
- Editing track/master mixer values with undo, redo, and confirmed history restore.

Playback, recording, export, autosave, and the WebMCP adapter are not connected
to this editor yet. Refreshing starts a new demo session and loses edits.

## Challenge scope

The September 3 MVP is desktop-only and uses bundled drum sounds plus curated
Web Audio synth presets. Microphone recording, audio-clip editing, sound design,
effects, automation, cloud storage, and an embedded chatbot are deferred until
the complete compose-to-WAV workflow is stable.

## Architecture

```text
Manual UI ─→ Zustand bridge ─→ command service ─→ project state
                                      │                 │
                                      └─→ history       └─→ silent editor

Web Audio, IndexedDB, export, and WebMCP foundations/integrations remain separate.
```

The planned stack is strict TypeScript, React, Next.js, native Web Audio, and
IndexedDB with no application backend.

## Development

Use Node.js 23.6 or newer and pnpm 10.17.0 (pinned in `package.json`).

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Run checks with `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`.
Commit `pnpm-lock.yaml` when dependencies change; do not generate npm or Yarn
lockfiles. Each Git worktree needs its own `pnpm install --frozen-lockfile`.
Dependency build scripts are allowed only for `esbuild` and `unrs-resolver`.

## Documentation

- [Project design](docs/design.md) — approved scope, workflows, architecture,
  data model, WebMCP tools, history, failures, testing, and delivery schedule.
- [Silent editor design](docs/superpowers/specs/2026-08-31-silent-editor-design.md)
  — agreed UI interactions, independent patterns, clip-to-track routing, and
  silent-only scope; supersedes the earlier pattern ownership model.
- [Silent editor implementation plan](docs/superpowers/plans/2026-08-31-silent-editor.md)
  — test-first delivery slices, acceptance checks, and the separate persistence
  integration gate. The silent UI slices are implemented on the feature branch.

## Status

Project-domain and audio-engine foundations are implemented. The editor UI is
connected to the project command/history service but deliberately does not
construct the audio runtime or persist sessions.

The audio runtime exports `AudioEngine`, `Sampler`, and `Synth` classes from
`src/audio/index.ts`. Construct them with `new AudioEngine(platform)`,
`new Sampler(options)`, or `new Synth(options)`; these replace the previous
`createAudioEngine`, `createSampler`, and `createSynth` factories with the same
arguments and public methods. Wrap instance methods when passing callbacks,
for example `() => engine.stop()`.

## Internal input contract

The project package trusts its typed callers. It does not validate shapes, IDs,
ranges, references, catalog membership, overlap, or input caps. UI, WebMCP, and
persistence boundaries must supply valid, JSON-serializable data; only the UI
boundary is implemented in this milestone. `PROJECT_CAPS` describes product limits
for those callers; only history and command-cache retention are enforced internally.

`reduceOperation(project, operation)` and `ProjectService` need no sound catalog.
Dispatch and restore return successful results; execution errors propagate rather
than becoming structured validation failures. Batches commit only after all
operations finish. Snapshot detachment, no-op detection, and history controls remain.

## License

MIT. See [LICENSE](LICENSE).
