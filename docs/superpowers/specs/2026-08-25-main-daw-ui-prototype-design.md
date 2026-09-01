# Main DAW UI Prototype Design

## Goal

Build a polished desktop-only visual prototype of AgentDAW's main workspace. It
should evoke the supplied dark DAW reference while using AgentDAW branding,
music data, and product terminology. This iteration validates layout, visual
hierarchy, and interaction feel; it does not implement music editing or audio.

## Scope

The prototype is one full-viewport page built with Next.js, React, strict
TypeScript, and plain CSS. It uses seeded display data and local component state.
No UI library, state library, audio engine, persistence, or backend is added.

The page targets a 1440×900 desktop viewport. At narrower desktop widths, the
arrangement remains usable through horizontal overflow rather than introducing
an unplanned mobile layout.

## Visual Direction

- Near-black application chrome with subtle borders and layered charcoal panels.
- Bright violet, magenta, coral, orange, and amber clips against a precise grid.
- Compact typography, restrained shadows, and clear selected and hover states.
- AgentDAW wordmark and original demo content rather than copied branding or
  song metadata.
- Familiar DAW density without hiding primary controls from a beginner.

## Layout

### Navigation rail

A narrow left rail contains the AgentDAW mark, Compose, Sounds, and History
destinations, plus a compact project status area at the bottom. Compose is the
active destination in this prototype.

### Transport bar

The top bar contains the project name, BPM and time readouts, undo and redo,
play and stop controls, a small level indicator, and an Export button. Controls
change visual state only.

### Arrangement

The central workspace contains a bar ruler, playhead, track headers, and seeded
pattern clips for drums, bass, chords, melody, and pad. Synth clips show note
marks; drum clips show compact waveform-like marks. Clicking a clip updates the
selection treatment and inspector content.

### Mixer

A floating lower-center mixer overlays the arrangement, matching the layered
feel of the reference. It contains one strip per track and a master strip with
visual faders, meters, mute, and solo controls. A toolbar button toggles the
mixer panel.

### Inspector

The right panel shows details for the selected clip: artwork-like color field,
pattern name, track, length, preset, and a short activity list. Inspector tabs
switch between Details and Activity without loading external data.

### Tool dock

A compact dock anchored below the arrangement exposes Select, Draw, Split,
Mixer, and Focus controls. Select is active by default; the tool buttons update
their active appearance only.

## Interaction Model

React state is limited to prototype feedback:

- play and pause appearance;
- selected clip and active inspector content;
- mute and solo state per seeded track;
- active tool and inspector tab;
- mixer open and closed state;
- playhead position through a native range input.

These interactions do not modify project-domain data, schedule audio, persist,
or create history. Buttons expose accessible names, selected states, and visible
keyboard focus. Native controls are used where they fit.

## File Shape

Use the smallest structure that stays readable:

```text
src/app/layout.tsx
src/app/page.tsx
src/app/globals.css
```

Seed data and small presentational components remain in `page.tsx` until real
domain integration creates a reason to extract them. Icons use inline SVG or
text; the visual artwork uses CSS gradients, so no image dependency is needed.

## Verification

The user authorized skipping automated tests for this design iteration. Before
delivery, run TypeScript checking and linting, then inspect the page in a desktop
browser at approximately 1440×900. Verify the intended control states manually
and check for clipping, overflow, contrast, and visible focus treatment.

## Deferred Work

- Web Audio playback and scheduling.
- Editable notes, drum hits, clips, and mixer values.
- Project command-service integration and history mutations.
- IndexedDB autosave, WAV export, and WebMCP.
- Responsive tablet or mobile layouts.
- Extracted design-system primitives or additional dependencies.
