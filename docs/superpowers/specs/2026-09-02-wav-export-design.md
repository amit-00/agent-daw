# AgentDAW WAV Export Design

## Goal

Enable the existing Export button to render the current project as a 44.1 kHz,
16-bit stereo WAV and download it without changing project state or history.

## Scope

The feature includes:

- full-arrangement rendering from a frozen project snapshot;
- the existing drum samples, synth presets, track gain, pan, mute, solo, and
  master gain;
- synth release tails;
- WAV encoding and browser download;
- visible progress and actionable failure feedback; and
- automated coverage from PCM encoding through the Export button.

It does not connect live playback, add export settings, add formats, normalize
or master audio, render stems, or add dependencies.

## Architecture

`src/audio/exporter.ts` owns WAV export. It reuses the current timeline
expansion, sampler, synth presets, and native Web Audio nodes so playback and
export follow the same musical rules. The sampler and synth accept the native
`BaseAudioContext` shared by live and rendering contexts; the live engine keeps
its existing `AudioContext` contract.

The exporter exposes one browser-independent render function with explicit
platform dependencies and small pure helpers for PCM encoding and file naming.
The production wrapper supplies `OfflineAudioContext`, `fetch`, `Blob`, object
URLs, and a temporary anchor. This keeps browser side effects at the edge and
makes the core behavior testable without adding a library.

`Transport` owns only request state: idle, exporting, or failed. It freezes the
current project with `structuredClone`, calls the production export wrapper,
and does not dispatch a project command.

## Export Contract

The project is rendered with these fixed values:

| Setting | Value |
|---|---:|
| Channels | 2 |
| Sample rate | 44,100 Hz |
| PCM depth | signed 16-bit little-endian |
| Maximum rendered duration | 600 seconds |

The musical duration ends at `arrangementEndStep(project)`. Rendering includes
the longest release among synth presets used by scheduled events so the final
note does not end abruptly. The resulting context length is
`ceil(renderedSeconds * 44_100)` frames.

An empty arrangement is rejected. A project whose musical duration plus release
tail exceeds 600 seconds is rejected before allocating the rendering context.
The exporter expands the complete timeline once and rejects missing tracks,
missing patterns, unknown presets, and unavailable drum samples rather than
creating a misleading partial file.

Track routing is:

```text
drum or synth source -> track gain -> stereo pan -> master gain -> output
```

Mute and solo use the same rules as playback. Values are applied at time zero;
the live engine's five-millisecond mixer ramps are not needed for a newly
created graph.

The synth scheduler receives a voice cap equal to the number of synth events,
with a minimum of one. This preserves every pre-scheduled voice without adding
a separate synth implementation or an export-only mode to the existing synth.

## WAV Encoding

The encoder writes a 44-byte RIFF/WAVE header followed by interleaved stereo
samples. Each floating-point sample is clamped to `[-1, 1]`; negative values
scale by 32,768 and non-negative values by 32,767 before conversion to signed
16-bit PCM. Header sizes derive from the actual rendered buffer.

The result is a `Blob` with MIME type `audio/wav`.

## Download Flow

The existing disabled Export button becomes available when the project has an
arrangement and no export is running. With no arrangement it stays disabled and
its accessible description tells the user to add a clip before exporting.

On activation:

1. Copy the current project with `structuredClone`.
2. Change the button label to `Exporting…` and disable it.
3. Render and encode the snapshot.
4. Create an object URL, click a temporary anchor with a sanitized file name,
   remove the anchor, and revoke the URL.
5. Restore the idle button label.

The file name preserves the trimmed project name while replacing control
characters and characters forbidden by common desktop file systems with `-`.
Trailing dots and spaces are removed. An empty result falls back to
`agentdaw.wav`.

The button exposes its busy state with `aria-busy`. A concise status message is
announced while rendering. Failures appear in an alert near the button and leave
the editor usable. A second activation while rendering does nothing.

## Errors

Expected failures use a specific `WavExportError` carrying one of these codes:

- `empty_arrangement`;
- `duration_exceeded`;
- `invalid_project_reference`;
- `unknown_preset`;
- `missing_sample`;
- `sample_load_failed`;
- `render_failed`; or
- `download_failed`.

Messages name the relevant sound, preset, or project reference when available
and tell the user what to correct or retry. Unexpected exceptions retain their
cause internally but the UI displays a stable export-stage message rather than
raw browser details. No failure mutates the project or creates history.

## Testing

Tests proceed with failing behavior checks before implementation:

- a pure encoder test verifies RIFF fields, frame-derived lengths, stereo
  interleaving, clamping, and signed scaling;
- exporter tests verify duration calculation, release-tail inclusion, complete
  timeline scheduling, mixer values, and successful rendering;
- exporter failure tests cover empty arrangements, the 600-second cap, stale
  references, unknown presets, missing samples, and render rejection;
- file-name tests cover forbidden characters, trailing dots/spaces, and the
  fallback name; and
- a Transport test verifies busy/disabled state, one download per activation,
  sanitized naming, error feedback, and unchanged history.

After focused tests pass, the project test suite, UI suite, typecheck, lint, and
production build must pass. `git diff` is reviewed for unrelated changes.

## Acceptance Criteria

1. Clicking Export on a valid project downloads one playable `.wav` file.
2. The file is 44.1 kHz, 16-bit stereo PCM and includes the audible arrangement,
   mixer state, and final synth release.
3. Export uses the project state captured at activation even if editing
   continues while rendering.
4. Export creates no project mutation or history entry.
5. An empty project cannot start export and the control explains how to enable
   it. Excessive, incomplete, or failed exports show actionable feedback and do
   not download a partial file.
6. No new runtime or development dependency is added.
