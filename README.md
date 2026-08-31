# AgentDAW

AgentDAW is a simple browser-based pattern sequencer where a person can compose
with clicks or direct an external agent to compose through WebMCP. Both paths
edit the same tracks, patterns, arrangement, mixer, and visible history.

## Product

Users can:

- Program drums on a step grid.
- Write bass, chords, leads, and pads in a piano roll.
- Arrange reusable patterns into a complete instrumental song.
- Play, mix, autosave, undo, restore, and export the result as WAV.
- Ask an external agent for broad composition or exact note-level changes.

Agent operations use the same command service as manual edits.
Every action records whether it came from the UI or WebMCP, and multi-operation
agent requests commit as one atomic, undoable history entry.

## Challenge scope

The September 3 MVP is desktop-only and uses bundled drum sounds plus curated
Web Audio synth presets. Microphone recording, audio-clip editing, sound design,
effects, automation, cloud storage, and an embedded chatbot are deferred until
the complete compose-to-WAV workflow is stable.

## Architecture

```text
Manual UI ──────┐
                ├─→ command service ─→ project state ─→ editor + Web Audio
WebMCP adapter ─┘          │                 │
                           └─→ history       ├─→ IndexedDB autosave
                                             └─→ offline WAV export
```

The planned stack is strict TypeScript, React, Next.js, native Web Audio, and
IndexedDB with no application backend.

## Documentation

- [Project design](docs/design.md) — approved scope, workflows, architecture,
  data model, WebMCP tools, history, failures, testing, and delivery schedule.

## Status

Project-domain and audio-engine foundations are implemented. Editor and UI
integration are next.

The audio runtime exports `AudioEngine`, `Sampler`, and `Synth` classes from
`src/audio/index.ts`. Construct them with `new AudioEngine(platform)`,
`new Sampler(options)`, or `new Synth(options)`; these replace the previous
`createAudioEngine`, `createSampler`, and `createSynth` factories with the same
arguments and public methods. Wrap instance methods when passing callbacks,
for example `() => engine.stop()`.

## Internal input contract

The project package trusts its typed callers. It does not validate shapes, IDs,
ranges, references, catalog membership, overlap, or input caps. UI, WebMCP, and
persistence boundaries must supply valid, JSON-serializable data; those adapters
are not implemented yet. `PROJECT_CAPS` describes product limits for those callers;
only history and command-cache retention are enforced internally.

`reduceOperation(project, operation)` and `ProjectService` need no sound catalog.
Dispatch and restore return successful results; execution errors propagate rather
than becoming structured validation failures. Batches commit only after all
operations finish. Snapshot detachment, no-op detection, and history controls remain.

## License

MIT. See [LICENSE](LICENSE).
