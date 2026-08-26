# Main DAW UI Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a polished, interactive visual prototype of AgentDAW's desktop workspace from the approved reference direction.

**Architecture:** A single Next.js client page owns seeded presentation data and local-only interaction state. Plain CSS renders the full-screen DAW shell, arrangement, mixer overlay, inspector, and responsive desktop behavior without adding a component or state library.

**Tech Stack:** Next.js 16.3.3, React 19.2.8, strict TypeScript 6.0.3, ESLint 9.39.5, plain CSS

**Spec:** `docs/superpowers/specs/2026-08-25-main-daw-ui-prototype-design.md`

## Global Constraints

- Target a 1440×900 desktop viewport and use horizontal overflow at narrower desktop widths.
- Use original AgentDAW branding and seeded project content.
- Add no UI, icon, state, audio, persistence, or backend dependency.
- Keep prototype state local and visual-only.
- Use accessible names, selected states, visible focus, and native controls where appropriate.
- Automated tests are skipped for this design iteration by explicit user authorization.

---

### Task 1: Create the minimal Next.js application shell

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `next-env.d.ts`
- Create: `next.config.ts`
- Create: `tsconfig.json`
- Create: `eslint.config.mjs`
- Create: `src/app/layout.tsx`
- Modify: `.gitignore`

**Interfaces:**
- Produces: Next.js App Router root layout and the `dev`, `build`, `lint`, and `typecheck` scripts.

- [ ] **Step 1: Add exact runtime and development dependencies**

```json
{
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "next": "16.3.3",
    "react": "19.2.8",
    "react-dom": "19.2.8"
  },
  "devDependencies": {
    "@types/node": "26.3.0",
    "@types/react": "19.2.18",
    "@types/react-dom": "19.2.5",
    "eslint": "9.39.5",
    "eslint-config-next": "16.3.3",
    "typescript": "6.0.3"
  }
}
```

- [ ] **Step 2: Configure strict TypeScript, Next.js, and ESLint**

Use the App Router defaults with `strict: true`, `noEmit: true`, `jsx: preserve`,
and the `@/*` path alias. Extend `.gitignore` with these exact generated paths:

```text
node_modules/
.next/
out/
*.tsbuildinfo
```

Use the official flat ESLint presets without plugins or custom rules:

```js
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([".next/**", "out/**", "next-env.d.ts"]),
]);
```

- [ ] **Step 3: Add the root metadata and layout**

```tsx
export const metadata: Metadata = {
  title: "AgentDAW — Studio",
  description: "A browser-based pattern workstation for composing with people and agents.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>): ReactElement {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 4: Install dependencies and verify the empty shell compiles**

Run: `npm install && npm run typecheck && npm run lint`

Expected: all commands exit with status 0.

- [ ] **Step 5: Commit**

```bash
git add .gitignore package.json package-lock.json next-env.d.ts next.config.ts tsconfig.json eslint.config.mjs src/app/layout.tsx
git commit -m "build: add Next.js application shell"
```

### Task 2: Build the interactive DAW workspace

**Files:**
- Create: `src/app/page.tsx`
- Create: `src/app/globals.css`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: the App Router layout from Task 1.
- Produces: default `StudioPage(): ReactElement`; local state for playback, clip selection, mixer visibility, tool selection, inspector tabs, per-track mute/solo, and playhead position.

- [ ] **Step 1: Define the seeded view model and reusable icon primitive**

```tsx
type TrackId = "drums" | "bass" | "chords" | "melody" | "pad";
type ToolId = "select" | "draw" | "split" | "focus";
type InspectorTab = "details" | "activity";

interface Track {
  readonly id: TrackId;
  readonly name: string;
  readonly kind: "drum" | "synth";
  readonly color: string;
  readonly preset: string;
  readonly volume: number;
}

interface Clip {
  readonly id: string;
  readonly trackId: TrackId;
  readonly name: string;
  readonly start: number;
  readonly width: number;
  readonly detail: string;
}

function Icon({ name, size = 16 }: Readonly<{ name: IconName; size?: number }>): ReactElement
```

Use five tracks and seven clips with original names: Neon Kit, Low Orbit,
Glasshouse, Afterglow, and Night Air. Keep the data at module scope and readonly.

- [ ] **Step 2: Build the layout regions in one page component**

```tsx
export default function StudioPage(): ReactElement {
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState(CLIPS[0].id);
  const [mixerOpen, setMixerOpen] = useState(true);
  const [activeTool, setActiveTool] = useState<ToolId>("select");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("details");
  const [playhead, setPlayhead] = useState(27);
  const [mutedTracks, setMutedTracks] = useState<ReadonlySet<TrackId>>(new Set());
  const [soloTracks, setSoloTracks] = useState<ReadonlySet<TrackId>>(new Set());

  return (
    <main className="studio-shell">
      <nav className="sidebar" aria-label="Primary navigation">Compose navigation</nav>
      <section className="workspace">
        <header className="transport">Project transport</header>
        <section className="arrangement" aria-label="Song arrangement">Timeline and tracks</section>
        {mixerOpen ? <aside className="mixer" aria-label="Mixer">Track and master strips</aside> : null}
        <div className="tool-dock" role="toolbar" aria-label="Editing tools">Editing tools</div>
      </section>
      <aside className="inspector" aria-label="Selected pattern inspector">Pattern details</aside>
    </main>
  );
}
```

Render `<nav>`, `<header>`, the arrangement `<section>`, mixer `<aside>`,
inspector `<aside>`, and bottom tool dock. Use buttons for actions, tabs with
`aria-selected`, mute/solo buttons with `aria-pressed`, and a labeled range
input for the playhead.

- [ ] **Step 3: Implement the visual-only interactions**

Use functional state updates for mute and solo sets. Play toggles its icon and
label; stop clears play state; clip buttons update the inspector; Mixer toggles
the overlay; tool and inspector buttons update their selected treatment. No
interaction mutates seeded data.

- [ ] **Step 4: Style the complete desktop composition**

```css
:root {
  --bg: #070708;
  --panel: #0d0d10;
  --panel-raised: #151519;
  --line: rgba(255, 255, 255, 0.08);
  --text: #f5f5f7;
  --muted: #85858d;
  --accent: #a977ff;
}

.studio-shell {
  display: grid;
  grid-template-columns: 168px minmax(760px, 1fr) 276px;
  grid-template-rows: 64px minmax(0, 1fr);
  min-width: 1180px;
  height: 100dvh;
  overflow: hidden;
  color: var(--text);
  background: var(--bg);
}
```

Complete the grid, clip colors, note and waveform marks, floating mixer,
inspector artwork, hover/active states, scrollbar treatment, and focus-visible
outline. Keep all visuals in CSS and inline SVG icons; do not add image files.

- [ ] **Step 5: Verify compilation and lint**

Run: `npm run typecheck && npm run lint && npm run build`

Expected: all commands exit with status 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx src/app/globals.css src/app/layout.tsx
git commit -m "feat: build main DAW visual prototype"
```

### Task 3: Preview and visually verify the page

**Files:**
- Modify only if visual verification reveals a concrete defect.

**Interfaces:**
- Consumes: the complete Studio page from Task 2.
- Produces: a working local preview and validated 1440×900 composition.

- [ ] **Step 1: Start the development server**

Run: `npm run dev`

Expected: Next.js prints a local URL and reports ready without runtime errors.

- [ ] **Step 2: Verify the route responds before opening the preview**

Run: `curl --fail --silent --output /dev/null http://localhost:3000`

Expected: exit status 0.

- [ ] **Step 3: Open the first meaningful preview**

Open the exact local URL in the Codex browser panel only after Step 2 succeeds.

- [ ] **Step 4: Inspect at 1440×900 and exercise visual state controls**

Check the full viewport for clipping and unintended overflow. Toggle play/stop,
select at least two clips, toggle mute and solo, switch inspector tabs, move the
playhead, change the active tool, and close/reopen the mixer. Confirm each action
has a visible state change and keyboard focus remains visible.

- [ ] **Step 5: Run the final verification**

Run: `npm run typecheck && npm run lint && npm run build && git diff --check`

Expected: all commands exit with status 0 and `git status --short` is empty.
