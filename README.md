# AgentDAW

AgentDAW is a small browser-based multitrack editor built for a simple idea:
the human and the agent should be able to work on the same music project
without either one pretending to be the other.

The human gets a visual timeline. The agent gets a semantic project model and
safe editing tools through [WebMCP](https://github.com/webmachinelearning/webmcp).
Both paths execute the same command system, so an agent edit is visible,
reviewable, and undoable in the UI.

## Why this project

The [WebMCP Challenge](https://openai.com/webmcp-challenge/) asks builders to
explore apps that become meaningfully better when people and their agents use
them together. A DAW is a useful test case because its timeline is easy for a
person to understand visually but awkward for an agent to manipulate through
clicks alone.

AgentDAW is intentionally not an Ableton replacement. It is a focused
demonstration of agent-native creative software.

## MVP

- Load a bundled demo song or upload local audio files.
- Create tracks and place clips on a beat-based timeline.
- Drag, trim, duplicate, and delete clips.
- Play, pause, seek, and change BPM.
- Adjust volume and pan; mute and solo tracks.
- Inspect the project through WebMCP.
- Apply grouped agent edits with one visible, undoable history entry.
- Let a human edit between two agent actions; the next agent action reads the
  current project state.

The core product loop is:

```text
human edits → agent inspects → agent edits → human reviews/edits → agent adapts
```

## Architecture at a glance

```text
Human UI ───────┐
                ├── executeCommand() ── Project Store ── Web Audio graph
WebMCP tools ───┘                         │
                                          └── grouped history / undo
```

The UI and WebMCP adapters are consumers of one command layer. The app does
not contain an LLM or an in-app chatbot; ChatGPT or another compatible agent is
the intelligence layer.

## Suggested demo

1. Load the demo project and ask the agent to describe its structure.
2. Ask it to shorten the intro and bring the bass in earlier.
3. Ask it to make the chorus hit harder with a grouped edit transaction.
4. Manually move the synth clip.
5. Ask the agent to keep that human change and smooth the transition.
6. Undo the grouped agent transaction from the history panel.

The important moment is the handoff between human and agent, not autonomous
music generation.

## Documentation

- [Project design](docs/design.md) — product boundary, architecture, command
  model, WebMCP surface, history model, stack, non-goals, and delivery plan.

## Status

Documentation seed for a public hackathon project. The implementation should
follow the design and stay within the MVP boundary until the demo works.

## License

MIT. See [LICENSE](LICENSE).
