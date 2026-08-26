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

Agent operations use the same validation and command service as manual edits.
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

## License

MIT. See [LICENSE](LICENSE).
