# AgentDAW

AgentDAW is a desktop-first pattern workstation that runs entirely in the browser. Build drum and synth patterns, arrange them into a song, mix the result, and export a WAV without a backend.

## Features

- Create, rename, reorder, configure, mute, solo, and delete tracks.
- Program drums in a step grid and notes or chords in a piano roll.
- Create reusable patterns directly in the arrangement: creating or duplicating one requires its first clip. Repeat shared clips, move them between compatible tracks, or make one placement unique.
- Removing a pattern's last clip removes the pattern; shared patterns remain while another clip still places them.
- Play the arrangement through native Web Audio with per-track and master level meters.
- Mix track volume and pan plus master volume, with undo, redo, and history restore.
- Save the current project automatically in IndexedDB and start over from a blank project or the bundled demo.
- Export the arrangement as a WAV file.
- Expose the same project, editing, playback, history, and export operations through WebMCP when the browser supports it.

Project history belongs to the current browser session; the project itself persists locally. Microphone recording, audio clips, effects, automation, cloud sync, and an embedded chat UI are outside the current scope.

## Architecture

```text
Manual UI ─┐
           ├─→ Studio store ─→ ProjectService ─→ project + session history
WebMCP ────┘        │
                    ├─→ AudioEngine (Web Audio playback + meters)
                    ├─→ ProjectPersistenceService (IndexedDB)
                    └─→ offline WAV renderer
```

The app uses strict TypeScript, React, Next.js, Zustand, native Web Audio, and IndexedDB. UI and WebMCP inputs are validated before they reach the shared project operations so both entry points produce the same state and history behavior.

## Development

Requirements: Node.js 23.6 or newer and pnpm 10.17.0.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The editor targets desktop layouts with a minimum width of 1180px.

Run the complete verification suite with:

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

## Deployment

Cloudflare Workers deploys this static application through its GitHub integration. Create a Workers project for `amit-00/agent-daw` with:

- Production branch: `main`
- Build command: `pnpm build`
- Deploy command: `npx wrangler deploy`
- Environment variable: `NODE_VERSION=24`
- Environment variable: `PNPM_VERSION=10.17.0`

`wrangler.jsonc` deploys the generated `out` directory as Workers Static Assets. Cloudflare builds non-production branches when enabled and deploys `main` to production. GitHub Actions runs tests, type checking, linting, and a production build before merge; no Cloudflare API token is stored in GitHub.

## Documentation

- [Project design](docs/design.md) — product scope, workflows, architecture, data model, WebMCP contract, failure handling, and delivery plan.
- [Silent editor design](docs/superpowers/specs/2026-08-31-silent-editor-design.md) — the interaction model that established independent patterns and clip routing.
- [Silent editor implementation plan](docs/superpowers/plans/2026-08-31-silent-editor.md) — the test-first delivery slices used for the editor foundation.

## License

MIT. See [LICENSE](LICENSE).
