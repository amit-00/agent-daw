# React UI Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the approved DAW prototype into focused React modules using Zustand and Tailwind CSS while preserving its appearance and interactions.

**Architecture:** A flat `components`, `data`, `stores`, and `types` structure keeps the single-screen application easy to navigate. Static fixtures remain immutable data; one Zustand store owns shared interactive state; components subscribe to narrow slices and use Tailwind utilities directly.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, Zustand, Tailwind CSS 4, Vitest, Testing Library, jsdom

**Spec:** `docs/superpowers/specs/2026-08-26-react-ui-architecture-design.md`

## Global Constraints

- Preserve the current approved UI and all existing interactions.
- Use the flat structure from the approved design; do not introduce a feature namespace.
- Keep static project fixtures outside Zustand.
- Use narrow Zustand selectors and no `useEffect`.
- Prefer standard Tailwind utilities; use arbitrary values only for approved exact dimensions.
- Keep inline dynamic styles only for positions, widths, colors, note placement, and meter heights.
- Do not add component, icon, selector-helper, or CSS-in-JS dependencies.
- Follow red-green-refactor and run the focused test first.

---

## File Map

| File | Responsibility |
| --- | --- |
| `src/app/page.tsx` | Render `Studio` only |
| `src/app/globals.css` | Tailwind import and document-wide rules |
| `src/components/Studio.tsx` | Compose the four major UI regions |
| `src/components/Transport.tsx` | Project metadata, playback, output, export, and activity toggle |
| `src/components/ActivityPanel.tsx` | Conditional activity overlay |
| `src/components/icons.tsx` | Existing text and SVG icons |
| `src/components/arrangement/Arrangement.tsx` | Ruler, track/lane grid, and playhead composition |
| `src/components/arrangement/TrackHeader.tsx` | Track name, preset, mute, and solo controls |
| `src/components/arrangement/TrackLane.tsx` | Clips for one track |
| `src/components/arrangement/Clip.tsx` | Selectable clip and drum/note marks |
| `src/components/arrangement/Playhead.tsx` | Static arrangement playhead |
| `src/components/editor/TrackEditor.tsx` | Editor shell and Pattern/Mixer tab selection |
| `src/components/editor/PatternEditor.tsx` | Selected pattern details and editable step grid |
| `src/components/editor/PatternSidebar.tsx` | Project pattern selection list |
| `src/components/editor/Mixer.tsx` | Fixed-width channel strip layout |
| `src/components/editor/ChannelStrip.tsx` | Meter, volume/pan sliders, mute, and solo controls |
| `src/data/studio-data.ts` | Immutable project fixtures and validated lookup helpers |
| `src/stores/studio-store.ts` | Shared session state and actions |
| `src/types/studio.ts` | Domain identifiers and fixture types |
| `src/test/setup.ts` | Testing Library matchers and cleanup |
| `src/stores/studio-store.test.ts` | Store behavior tests |
| `src/components/Studio.test.tsx` | User-visible component behavior tests |

---

### Task 1: Add the Test, Tailwind, and Zustand Foundation

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `postcss.config.mjs`
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`
- Create: `src/types/studio.ts`
- Create: `src/data/studio-data.ts`
- Create: `src/stores/studio-store.test.ts`
- Create: `src/stores/studio-store.ts`

**Interfaces:**
- Produces: `TrackId`, `EditorTab`, `Track`, `Clip`, and `Pattern` domain types.
- Produces: `TRACKS`, `CLIPS`, `PROJECT_PATTERNS`, `getTrack`, `getClip`, `getPattern`, and `findPatternForClip`.
- Produces: `useStudioStore: UseBoundStore<StoreApi<StudioState>>` with typed state and actions.

- [ ] **Step 1: Install only the approved dependencies**

Run:

```bash
npm install zustand
npm install --save-dev tailwindcss @tailwindcss/postcss vitest @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom
```

Add these scripts to `package.json`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 2: Configure Tailwind and Vitest**

Create `postcss.config.mjs`:

```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

Create `vitest.config.ts`:

```ts
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
```

Create `src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);
```

- [ ] **Step 3: Write failing Zustand behavior tests**

Create `src/stores/studio-store.test.ts` with tests that reset from `getInitialState()` before each case and assert:

```ts
import { beforeEach, describe, expect, it } from "vitest";

import { PROJECT_PATTERNS } from "@/data/studio-data";
import { useStudioStore } from "@/stores/studio-store";

describe("studio store", () => {
  beforeEach(() => {
    useStudioStore.setState(useStudioStore.getInitialState(), true);
  });

  it("controls playback without an effect", () => {
    useStudioStore.getState().togglePlayback();
    expect(useStudioStore.getState().isPlaying).toBe(true);
    useStudioStore.getState().stopPlayback();
    expect(useStudioStore.getState().isPlaying).toBe(false);
  });

  it("selects a pattern and its associated clip atomically", () => {
    const pattern = PROJECT_PATTERNS[6];
    useStudioStore.getState().selectPattern(pattern.id);
    const state = useStudioStore.getState();
    expect(state.selectedPatternId).toBe(pattern.id);
    expect(state.selectedClipId).toBe(pattern.clipId);
    expect([...state.sequenceSteps]).toEqual(pattern.steps);
  });

  it("updates mute, solo, and sequence sets immutably", () => {
    const initialMuted = useStudioStore.getState().mutedTrackIds;
    useStudioStore.getState().toggleMute("drums");
    useStudioStore.getState().toggleSolo("bass");
    useStudioStore.getState().toggleSequenceStep(3);
    const state = useStudioStore.getState();
    expect(state.mutedTrackIds).not.toBe(initialMuted);
    expect(state.mutedTrackIds.has("drums")).toBe(true);
    expect(state.soloTrackIds.has("bass")).toBe(true);
    expect(state.sequenceSteps.has(3)).toBe(true);
  });
});
```

- [ ] **Step 4: Run the store test and confirm the red state**

Run: `npm test -- src/stores/studio-store.test.ts`

Expected: FAIL because the data and store modules do not exist yet.

- [ ] **Step 5: Move typed fixtures and implement the minimal store**

Move the `TrackId`, `EditorTab`, `Track`, `Clip`, and `Pattern` definitions from `src/app/page.tsx:6-35` into `src/types/studio.ts`. Move the fixture arrays from `src/app/page.tsx:39-116` into `src/data/studio-data.ts` without changing their values. Also move `DRUM_LEVELS`, `NOTE_MARKS`, and `SEQUENCE_NOTES` there.

Add strict lookup helpers to `studio-data.ts` using this pattern:

```ts
function requireItem<T extends { readonly id: string }>(
  items: readonly T[],
  id: string,
  label: string,
): T {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) {
    throw new Error(`Unknown ${label} "${id}". Check studio-data.ts fixture relationships.`);
  }
  return item;
}

export const getTrack = (id: TrackId): Track => requireItem(TRACKS, id, "track");
export const getClip = (id: string): Clip => requireItem(CLIPS, id, "clip");
export const getPattern = (id: string): Pattern => requireItem(PROJECT_PATTERNS, id, "pattern");
export const findPatternForClip = (clipId: string): Pattern | undefined =>
  PROJECT_PATTERNS.find((pattern) => pattern.clipId === clipId);
```

Implement `src/stores/studio-store.ts` with one immutable set helper and one store:

```ts
import { create } from "zustand";

import { findPatternForClip, getPattern, PROJECT_PATTERNS } from "@/data/studio-data";
import type { EditorTab, TrackId } from "@/types/studio";

interface StudioState {
  readonly isPlaying: boolean;
  readonly activityOpen: boolean;
  readonly editorTab: EditorTab;
  readonly selectedClipId: string;
  readonly selectedPatternId: string;
  readonly mutedTrackIds: ReadonlySet<TrackId>;
  readonly soloTrackIds: ReadonlySet<TrackId>;
  readonly sequenceSteps: ReadonlySet<number>;
  readonly togglePlayback: () => void;
  readonly stopPlayback: () => void;
  readonly toggleActivity: () => void;
  readonly closeActivity: () => void;
  readonly selectEditorTab: (tab: EditorTab) => void;
  readonly selectClip: (clipId: string) => void;
  readonly selectPattern: (patternId: string) => void;
  readonly toggleMute: (trackId: TrackId) => void;
  readonly toggleSolo: (trackId: TrackId) => void;
  readonly toggleSequenceStep: (step: number) => void;
}

function toggled<T>(values: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const next = new Set(values);
  next.has(value) ? next.delete(value) : next.add(value);
  return next;
}

const initialPattern = PROJECT_PATTERNS[4];

export const useStudioStore = create<StudioState>((set) => ({
  isPlaying: false,
  activityOpen: true,
  editorTab: "pattern",
  selectedClipId: initialPattern.clipId,
  selectedPatternId: initialPattern.id,
  mutedTrackIds: new Set(),
  soloTrackIds: new Set(),
  sequenceSteps: new Set(initialPattern.steps),
  togglePlayback: () => set((state) => ({ isPlaying: !state.isPlaying })),
  stopPlayback: () => set({ isPlaying: false }),
  toggleActivity: () => set((state) => ({ activityOpen: !state.activityOpen })),
  closeActivity: () => set({ activityOpen: false }),
  selectEditorTab: (editorTab) => set({ editorTab }),
  selectClip: (selectedClipId) => set(() => {
    const pattern = findPatternForClip(selectedClipId);
    return pattern
      ? { selectedClipId, selectedPatternId: pattern.id, sequenceSteps: new Set(pattern.steps) }
      : { selectedClipId };
  }),
  selectPattern: (patternId) => {
    const pattern = getPattern(patternId);
    set({
      selectedPatternId: pattern.id,
      selectedClipId: pattern.clipId,
      sequenceSteps: new Set(pattern.steps),
    });
  },
  toggleMute: (trackId) => set((state) => ({ mutedTrackIds: toggled(state.mutedTrackIds, trackId) })),
  toggleSolo: (trackId) => set((state) => ({ soloTrackIds: toggled(state.soloTrackIds, trackId) })),
  toggleSequenceStep: (step) => set((state) => ({ sequenceSteps: toggled(state.sequenceSteps, step) })),
}));
```

- [ ] **Step 6: Run the focused test and static checks**

Run:

```bash
npm test -- src/stores/studio-store.test.ts
npm run typecheck
npm run lint
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit the foundation**

```bash
git add package.json package-lock.json postcss.config.mjs vitest.config.ts src/test src/types src/data src/stores
git commit -m "add studio state foundation"
```

---

### Task 2: Extract Transport and Activity as the First UI Slice

**Files:**
- Create: `src/components/Studio.test.tsx`
- Create: `src/components/icons.tsx`
- Create: `src/components/Transport.tsx`
- Create: `src/components/ActivityPanel.tsx`
- Create: `src/components/Studio.tsx`

**Interfaces:**
- Consumes: focused values and actions from `useStudioStore`.
- Produces: `Studio`, `Transport`, and `ActivityPanel` React components with no props.
- Produces: shared `Icon` and `TransportIcon` components.

- [ ] **Step 1: Write failing transport and activity tests**

Create `src/components/Studio.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { Studio } from "@/components/Studio";
import { useStudioStore } from "@/stores/studio-store";

describe("Studio", () => {
  beforeEach(() => {
    useStudioStore.setState(useStudioStore.getInitialState(), true);
  });

  it("controls playback", async () => {
    const user = userEvent.setup();
    render(<Studio />);
    const play = screen.getByRole("button", { name: "Play" });
    await user.click(play);
    expect(screen.getByRole("button", { name: "Pause" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(screen.getByRole("button", { name: "Play" })).toHaveAttribute("aria-pressed", "false");
  });

  it("toggles the activity overlay", async () => {
    const user = userEvent.setup();
    render(<Studio />);
    expect(screen.getByRole("complementary", { name: "Activity" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Hide activity" }));
    expect(screen.queryByRole("complementary", { name: "Activity" })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the red state**

Run: `npm test -- src/components/Studio.test.tsx`

Expected: FAIL because `Studio` does not exist.

- [ ] **Step 3: Extract the icons, transport, activity panel, and shell**

Move `Icon` and `TransportIcon` from `src/app/page.tsx:118-141` into `icons.tsx`. Move the transport markup from `src/app/page.tsx:242-306` into `Transport.tsx`, replacing local state with these narrow subscriptions. Translate the relevant rules from `src/app/globals.css:84-329` and the final typography overrides at `src/app/globals.css:1084-1123` into direct Tailwind classes:

```ts
const isPlaying = useStudioStore((state) => state.isPlaying);
const togglePlayback = useStudioStore((state) => state.togglePlayback);
const stopPlayback = useStudioStore((state) => state.stopPlayback);
const activityOpen = useStudioStore((state) => state.activityOpen);
const toggleActivity = useStudioStore((state) => state.toggleActivity);
```

Move the activity markup from `src/app/page.tsx:463-483` into `ActivityPanel.tsx`. Translate `src/app/globals.css:1007-1083` into direct Tailwind classes. Subscribe separately to `activityOpen` and `closeActivity`, returning `null` when closed. Move the activity strings into `studio-data.ts`.

Create `Studio.tsx` as a client component that currently composes `Transport` and `ActivityPanel` inside the existing full-viewport shell. Apply Tailwind utilities directly, preserving the 58-pixel header, black background, typography, borders, focus-visible states, and right-edge overlay.

- [ ] **Step 4: Run the focused test and static checks**

Run:

```bash
npm test -- src/components/Studio.test.tsx
npm run typecheck
npm run lint
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit the first UI slice**

```bash
git add src/components src/data/studio-data.ts
git commit -m "extract transport and activity"
```

---

### Task 3: Extract the Arrangement

**Files:**
- Modify: `src/components/Studio.test.tsx`
- Create: `src/components/arrangement/Arrangement.tsx`
- Create: `src/components/arrangement/TrackHeader.tsx`
- Create: `src/components/arrangement/TrackLane.tsx`
- Create: `src/components/arrangement/Clip.tsx`
- Create: `src/components/arrangement/Playhead.tsx`
- Modify: `src/components/Studio.tsx`

**Interfaces:**
- Consumes: `TRACKS`, `CLIPS`, fixture helpers, and the selected/mute/solo store slices.
- Produces: `Arrangement` with no props; child components accept only their typed fixture item and index where needed.

- [ ] **Step 1: Add failing arrangement behavior tests**

Append tests that assert the current selection and controls:

```tsx
it("selects a clip and its pattern", async () => {
  const user = userEvent.setup();
  render(<Studio />);
  await user.click(screen.getByRole("button", { name: "Select Afterglow" }));
  expect(screen.getByRole("button", { name: "Select Afterglow" })).toHaveAttribute("aria-pressed", "true");
  expect(useStudioStore.getState().selectedPatternId).toBe("afterglow");
});

it("shares mute and solo state from track controls", async () => {
  const user = userEvent.setup();
  render(<Studio />);
  await user.click(screen.getAllByRole("button", { name: "Mute Neon Kit" })[0]);
  await user.click(screen.getAllByRole("button", { name: "Solo Low Orbit" })[0]);
  expect(screen.getAllByRole("button", { name: "Unmute Neon Kit" })[0]).toHaveAttribute("aria-pressed", "true");
  expect(screen.getAllByRole("button", { name: "Unsolo Low Orbit" })[0]).toHaveAttribute("aria-pressed", "true");
});
```

- [ ] **Step 2: Run the focused tests and confirm the red state**

Run: `npm test -- src/components/Studio.test.tsx`

Expected: the new arrangement assertions fail because `Studio` does not render it.

- [ ] **Step 3: Extract the arrangement components with Tailwind styling**

Move arrangement markup from `src/app/page.tsx:309-369` into the five documented modules. Translate `src/app/globals.css:333-606` into direct Tailwind classes. Keep `DRUM_LEVELS` and `NOTE_MARKS` in `studio-data.ts`. Use the store directly in `TrackHeader` and `Clip`, with one selector call per value or action.

Preserve these layout values through Tailwind arbitrary utilities:

```text
Arrangement: min-w-[870px], min-h-[650px], grid-cols-[154px_minmax(730px,1fr)]
Rows: grid-rows-[39px_repeat(5,112px)]
Track headers: sticky left-0 z-[3] bg-black
Playhead canvas offset: left-[154px]
Clip opacity: color-mix using 80% visible clip color
```

Render the two vertical grid backgrounds with arbitrary background-image and background-size utilities. Render the playhead line and marker as real nested elements rather than custom pseudo-element CSS.

- [ ] **Step 4: Run the focused tests and checks**

Run:

```bash
npm test -- src/components/Studio.test.tsx
npm run typecheck
npm run lint
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit the arrangement**

```bash
git add src/components/Studio.test.tsx src/components/Studio.tsx src/components/arrangement
git commit -m "extract arrangement components"
```

---

### Task 4: Extract the Pattern Editor

**Files:**
- Modify: `src/components/Studio.test.tsx`
- Create: `src/components/editor/TrackEditor.tsx`
- Create: `src/components/editor/PatternEditor.tsx`
- Create: `src/components/editor/PatternSidebar.tsx`
- Modify: `src/components/Studio.tsx`

**Interfaces:**
- Consumes: editor tab, selected pattern, selected clip, selected track, sequence steps, and their actions.
- Produces: the editor shell, pattern list, selected details, and 64-button step grid.

- [ ] **Step 1: Add failing editor behavior tests**

Append:

```tsx
it("switches patterns and edits sequence steps", async () => {
  const user = userEvent.setup();
  render(<Studio />);
  await user.click(screen.getByRole("button", { name: "Select pattern Afterglow" }));
  expect(screen.getByRole("region", { name: "Pattern editor for Afterglow" })).toBeVisible();
  const step = screen.getByRole("button", { name: "Add C5 at step 1" });
  await user.click(step);
  expect(step).toHaveAttribute("aria-pressed", "true");
});

it("changes editor tabs", async () => {
  const user = userEvent.setup();
  render(<Studio />);
  await user.click(screen.getByRole("button", { name: "Mixer" }));
  expect(screen.getByRole("button", { name: "Mixer" })).toHaveAttribute("aria-pressed", "true");
});
```

- [ ] **Step 2: Run the focused tests and confirm the red state**

Run: `npm test -- src/components/Studio.test.tsx`

Expected: the new editor assertions fail because the editor is absent.

- [ ] **Step 3: Extract the pattern editor and use accessible tab state**

Move the editor shell and pattern branch from `src/app/page.tsx:373-430` into the documented modules. Translate the shell and pattern rules from `src/app/globals.css:608-676` and `src/app/globals.css:688-892` into direct Tailwind classes. `TrackEditor` subscribes to `editorTab` and `selectEditorTab`; each tab button exposes `aria-pressed`. `PatternSidebar` gives every item an explicit name in this form:

```tsx
aria-label={`Select pattern ${clip.name}`}
```

`PatternEditor` uses `getPattern`, `getClip`, and `getTrack` for validated derivation and subscribes only to `selectedPatternId`, `sequenceSteps`, and `toggleSequenceStep`. Preserve the 214-pixel sidebar, 12-pixel whitespace above the grid, 16-column ruler, four note rows, and active step color with Tailwind utilities and a dynamic `--sequence-color` value.

- [ ] **Step 4: Run the focused tests and checks**

Run:

```bash
npm test -- src/components/Studio.test.tsx
npm run typecheck
npm run lint
```

Expected: all commands exit 0 except that the Mixer content may still be empty; the tab-state assertion must pass.

- [ ] **Step 5: Commit the pattern editor**

```bash
git add src/components/Studio.test.tsx src/components/Studio.tsx src/components/editor
git commit -m "extract pattern editor"
```

---

### Task 5: Extract the Mixer

**Files:**
- Modify: `src/components/Studio.test.tsx`
- Create: `src/components/editor/Mixer.tsx`
- Create: `src/components/editor/ChannelStrip.tsx`
- Modify: `src/components/editor/TrackEditor.tsx`

**Interfaces:**
- Consumes: `TRACKS`, track volume fixture values, and shared mute/solo slices.
- Produces: six fixed-width strips with accessible volume and pan sliders.

- [ ] **Step 1: Add a failing mixer test**

Append:

```tsx
it("shows mixer-only volume and pan controls", async () => {
  const user = userEvent.setup();
  render(<Studio />);
  expect(screen.queryByRole("slider", { name: "Neon Kit volume" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Mixer" }));
  expect(screen.getByRole("slider", { name: "Neon Kit volume" })).toHaveValue(74);
  expect(screen.getByRole("slider", { name: "Neon Kit pan" })).toHaveValue(50);
});
```

- [ ] **Step 2: Run the focused test and confirm the red state**

Run: `npm test -- src/components/Studio.test.tsx`

Expected: FAIL because the mixer sliders do not exist.

- [ ] **Step 3: Extract mixer components with fixed dimensions**

Move the mixer branch from `src/app/page.tsx:432-458` into `Mixer.tsx` and `ChannelStrip.tsx`. Translate `src/app/globals.css:678-686` and `src/app/globals.css:894-1005` into direct Tailwind classes. Keep the existing native uncontrolled ranges with `defaultValue`, explicit labels, and no store state. Preserve:

```text
Strip width: 210px
Grid columns: repeat(6, 210px)
Meter height: 142px
Meter width: 12px with two 4px bars
Control order: meter, Volume slider, Pan slider, mute/solo or master value
```

Subscribe to mute and solo values and actions in each non-master `ChannelStrip`. Keep the master strip data local because it is a single fixed visual fixture.

- [ ] **Step 4: Run focused tests and checks**

Run:

```bash
npm test -- src/components/Studio.test.tsx
npm run typecheck
npm run lint
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit the mixer**

```bash
git add src/components/Studio.test.tsx src/components/editor
git commit -m "extract mixer components"
```

---

### Task 6: Replace the Monolith and Remove Raw Component CSS

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/components/Studio.tsx`
- Modify: `src/components/Studio.test.tsx`

**Interfaces:**
- Consumes: all completed component modules.
- Produces: the final application page with no duplicated legacy implementation or component stylesheet.

- [ ] **Step 1: Add a failing composition assertion**

Add one test that proves all major regions render together:

```tsx
it("renders the complete workstation", () => {
  render(<Studio />);
  expect(screen.getByRole("banner")).toBeVisible();
  expect(screen.getByRole("region", { name: "Song arrangement" })).toBeVisible();
  expect(screen.getByRole("complementary", { name: "Track editor" })).toBeVisible();
  expect(screen.getByRole("complementary", { name: "Activity" })).toBeVisible();
});
```

- [ ] **Step 2: Run the focused test and confirm any missing landmark fails**

Run: `npm test -- src/components/Studio.test.tsx`

Expected: FAIL until each documented landmark is present with the specified role and name.

- [ ] **Step 3: Compose the complete Studio and reduce page.tsx**

Make `Studio.tsx` compose the completed regions in this order:

```tsx
export function Studio(): ReactElement {
  return (
    <main className="relative h-dvh min-w-[1180px] overflow-hidden bg-black text-zinc-100">
      <section className="flex h-dvh min-w-0 flex-col overflow-hidden" id="studio">
        <Transport />
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_410px] overflow-hidden">
          <Arrangement />
          <TrackEditor />
        </div>
      </section>
      <ActivityPanel />
    </main>
  );
}
```

Replace `page.tsx` with:

```tsx
import type { ReactElement } from "react";

import { Studio } from "@/components/Studio";

export default function StudioPage(): ReactElement {
  return <Studio />;
}
```

- [ ] **Step 4: Delete component CSS and keep only global rules**

Replace `globals.css` with the minimal global layer:

```css
@import "tailwindcss";

:root {
  color-scheme: dark;
}

* {
  box-sizing: border-box;
}

html,
body {
  width: 100%;
  min-width: 1180px;
  height: 100%;
  margin: 0;
  overflow: hidden;
  background: #000;
}

body,
button,
input {
  font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

button,
a,
input {
  -webkit-tap-highlight-color: transparent;
}
```

Do not introduce a `cn` helper, Tailwind configuration file, custom theme tokens, or compatibility classes for the removed stylesheet.

- [ ] **Step 5: Run the full automated verification**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

Expected: all commands exit 0 and Vitest reports zero failures.

- [ ] **Step 6: Commit the completed module and Tailwind migration**

```bash
git add src/app src/components
git commit -m "complete React UI refactor"
```

---

### Task 7: Verify Visual Fidelity and Interaction in the Browser

**Files:**
- Modify only the smallest affected component if browser verification finds a regression.

**Interfaces:**
- Consumes: the running Next.js application at `http://localhost:3000/`.
- Produces: evidence that the approved appearance and interactions remain intact.

- [ ] **Step 1: Open the current local application and capture the full UI**

Use the in-app browser at the existing `http://localhost:3000/` tab. Capture the viewport at its current size and compare it with the approved pre-refactor state for:

```text
58px transport
full-width arrangement with 154px solid track sidebar
five 112px track rows and 80%-visible rainbow clips
vertical grid with every eighth line emphasized
410px fixed track editor
214px pattern sidebar and 64-step grid
right-edge activity overlay touching the viewport and transport border
```

- [ ] **Step 2: Exercise every preserved interaction**

In the browser, verify:

```text
Play toggles to Pause; Stop restores Play
Activity opens, closes, and overlays rather than pushes content
Pattern and Mixer tabs switch
Clip selection updates pattern selection
Pattern selection updates the editable grid
Sequence steps toggle
Track mute and solo state is shared between arrangement and mixer
Volume and pan controls appear only in Mixer
```

- [ ] **Step 3: Check browser errors**

Inspect the browser console for errors and hydration warnings.

Expected: no errors or warnings caused by the application.

- [ ] **Step 4: Re-run verification after any visual correction**

If a correction was needed, run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

Expected: all commands exit 0, then repeat the affected browser check.

- [ ] **Step 5: Commit only if browser verification required changes**

```bash
git add src
git commit -m "match approved DAW visuals"
```
