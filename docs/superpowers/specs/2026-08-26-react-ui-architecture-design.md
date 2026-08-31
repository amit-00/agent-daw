# React UI Architecture Design

## Goal

Convert the current DAW prototype into a maintainable React application without changing its approved appearance or interactions. Split the interface into focused modules, move shared interactive state to Zustand, and replace the large handwritten stylesheet with Tailwind CSS utilities.

## Scope

This refactor preserves the current project data, layout, controls, responsive minimum width, activity overlay, arrangement, pattern editor, mixer, and playhead. It does not add audio processing, persistence, routing, backend integration, or new product behavior.

## File Structure

```text
src/
├── app/
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── Studio.tsx
│   ├── Transport.tsx
│   ├── ActivityPanel.tsx
│   ├── icons.tsx
│   ├── arrangement/
│   │   ├── Arrangement.tsx
│   │   ├── TrackHeader.tsx
│   │   ├── TrackLane.tsx
│   │   ├── Clip.tsx
│   │   └── Playhead.tsx
│   └── editor/
│       ├── TrackEditor.tsx
│       ├── PatternEditor.tsx
│       ├── PatternSidebar.tsx
│       ├── Mixer.tsx
│       └── ChannelStrip.tsx
├── data/
│   └── studio-data.ts
├── stores/
│   └── studio-store.ts
└── types/
    └── studio.ts
```

The structure stays flat because the application currently has one primary product surface. A feature namespace should be introduced only when a second substantial feature makes the extra hierarchy useful.

## Component Boundaries

`page.tsx` renders `Studio` and contains no application logic. `Studio` composes the four major regions: `Transport`, `Arrangement`, `TrackEditor`, and `ActivityPanel`.

Arrangement components own the timeline, track headers, clips, and playhead. Editor components own the pattern browser, sequence grid, mixer, and channel strips. Shared icons remain in one small module; individual buttons and labels are not abstracted.

Each component reads the narrowest Zustand slice it needs. Components do not receive state setters through multiple layers, and no component subscribes to the entire store.

## Data and State

`studio-data.ts` exports immutable typed fixtures for tracks, clips, patterns, notes, activity entries, waveform levels, and note marks. `studio.ts` defines the identifiers and domain shapes used by the data, store, and components.

The Zustand store owns only mutable shared session state:

- playback status;
- activity-panel visibility;
- active editor tab;
- selected clip and pattern identifiers;
- muted and soloed track identifiers;
- editable sequence steps.

Store actions handle playback, activity visibility, editor-tab selection, clip and pattern selection, mute and solo toggles, and sequence-step toggles. Selecting a pattern updates its associated clip and loads that pattern's steps in one action. Selecting a clip selects its associated pattern when one exists.

Mixer range inputs remain uncontrolled visual controls for this prototype because volume and pan do not yet affect application behavior. They will move into state when audio behavior is implemented.

Fixture lookups use explicit helpers that throw actionable errors when an identifier or relationship is invalid. They do not silently substitute unrelated tracks, clips, or patterns.

## Rendering and Effects

Components use focused Zustand selectors so changes rerender only affected regions. React memoization is added only if a repeated child has stable props and browser profiling shows a useful boundary; it is not applied by default.

The current application requires no `useEffect`. User actions update the store directly, and all displayed values derive synchronously from fixture data and store state.

## Styling

Tailwind CSS utilities replace component-level rules in `globals.css`. Standard Tailwind spacing, typography, colors, borders, opacity, layout, hover, focus, overflow, and reduced-motion utilities are preferred.

Exact arbitrary values are retained only for approved design measurements such as the 58-pixel transport, 154-pixel arrangement sidebar, 112-pixel track rows, 410-pixel editor, and 210-pixel mixer strips. Inline CSS custom properties remain only for runtime clip position, clip width, clip color, playhead position, note placement, sequence color, and level-meter height.

`globals.css` contains the Tailwind import and document-wide rules that cannot be expressed on a component: viewport sizing, minimum application width, dark color scheme, and shared font inheritance. No custom design-token layer is added unless repeated utilities prove insufficient during the conversion.

## Dependencies

Runtime dependencies:

- `zustand` for shared client state.

Development dependencies:

- `tailwindcss` and `@tailwindcss/postcss` for utility styling;
- `vitest`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, and `jsdom` for behavior-first component and store tests.

No component library, selector helper library, icon package, or CSS-in-JS dependency is added.

## Test-Driven Workflow

Implementation follows red-green-refactor in small vertical slices:

1. Add the minimal test environment and prove a simple render test fails before the new component exists.
2. Drive Zustand actions with store tests for playback, selections, mute and solo sets, and sequence steps.
3. Drive each major interface region with user-visible behavior tests before extracting its implementation.
4. Run the focused failing test first, then the related test file after implementation.
5. Finish with the full test suite, typecheck, lint, production build, browser console inspection, and visual comparison against the approved prototype.

Tests assert accessible roles, names, pressed states, visible selections, tab changes, activity visibility, and pattern-step interaction. They avoid snapshots of Tailwind class strings and do not test static decorative markup.

## Acceptance Criteria

- The approved UI remains visually equivalent at the current browser viewport.
- Existing playback, stop, activity, editor-tab, clip, pattern, mute, solo, and sequence-step interactions still work.
- Components and data follow the documented flat structure.
- Shared mutable state is managed by Zustand with focused subscriptions.
- No application behavior depends on `useEffect`.
- The handwritten component CSS is replaced by Tailwind utilities; only justified global and dynamic styles remain.
- Tests, typecheck, lint, production build, and browser checks pass.
