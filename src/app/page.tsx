"use client";

import type { CSSProperties, Dispatch, ReactElement, SetStateAction } from "react";
import { useState } from "react";

type TrackId = "drums" | "bass" | "chords" | "melody" | "pad";
type EditorTab = "mixer" | "sequence";
type IconName =
  | "activity"
  | "chevron"
  | "download"
  | "draw"
  | "mixer";

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

const TRACKS: readonly Track[] = [
  {
    id: "drums",
    name: "Neon Kit",
    kind: "drum",
    color: "#9a69f5",
    preset: "Polaroid Drums",
    volume: 74,
  },
  {
    id: "bass",
    name: "Low Orbit",
    kind: "synth",
    color: "#d95fc8",
    preset: "Velvet Sub",
    volume: 68,
  },
  {
    id: "chords",
    name: "Glasshouse",
    kind: "synth",
    color: "#ef6070",
    preset: "Warm Glass",
    volume: 61,
  },
  {
    id: "melody",
    name: "Afterglow",
    kind: "synth",
    color: "#f18a4c",
    preset: "Soft Signal",
    volume: 72,
  },
  {
    id: "pad",
    name: "Night Air",
    kind: "synth",
    color: "#efbd52",
    preset: "Cloud Pad",
    volume: 55,
  },
] as const;

const CLIPS: readonly Clip[] = [
  { id: "drums-a", trackId: "drums", name: "Neon Kit · Main", start: 0, width: 50, detail: "4 bars · 64 steps" },
  { id: "drums-b", trackId: "drums", name: "Neon Kit · Lift", start: 50, width: 26, detail: "2 bars · 32 steps" },
  { id: "bass-a", trackId: "bass", name: "Low Orbit · A", start: 0, width: 50, detail: "4 bars · 14 notes" },
  { id: "bass-b", trackId: "bass", name: "Low Orbit · B", start: 52, width: 48, detail: "4 bars · 12 notes" },
  { id: "chords-a", trackId: "chords", name: "Glasshouse", start: 0, width: 50, detail: "4 bars · 22 notes" },
  { id: "chords-b", trackId: "chords", name: "Glasshouse · Open", start: 50, width: 50, detail: "4 bars · 18 notes" },
  { id: "melody-a", trackId: "melody", name: "Afterglow", start: 18, width: 58, detail: "4 bars · 19 notes" },
  { id: "pad-a", trackId: "pad", name: "Night Air", start: 0, width: 100, detail: "8 bars · 16 notes" },
] as const;

const ICONS: Readonly<Record<IconName, string>> = {
  activity: "⌁",
  chevron: "›",
  download: "⇩",
  draw: "✎",
  mixer: "≡",
};

const DRUM_LEVELS = [33, 58, 41, 75, 51, 86, 42, 67, 47, 80, 57, 91, 49, 70, 38, 76, 53, 88, 44, 72, 35, 61, 46, 82] as const;
const NOTE_MARKS = [
  [5, 22, 16], [18, 46, 25], [32, 31, 11], [43, 62, 20],
  [58, 18, 13], [67, 43, 21], [82, 29, 12], [91, 56, 7],
] as const;
const SEQUENCE_NOTES = ["C5", "A4", "F4", "C4"] as const;
const INITIAL_SEQUENCE_STEPS = [1, 6, 12, 17, 23, 29, 36, 42, 49, 55, 60] as const;

function Icon({ name, size = 16 }: Readonly<{ name: IconName; size?: number }>): ReactElement {
  return (
    <span className="icon" style={{ fontSize: size }} aria-hidden="true">
      {ICONS[name]}
    </span>
  );
}

type TransportIconName = "loop" | "pause" | "play" | "record" | "redo" | "speaker" | "stop" | "undo";

function TransportIcon({ name }: Readonly<{ name: TransportIconName }>): ReactElement {
  return (
    <svg className="transport-icon" viewBox="0 0 24 24" aria-hidden="true">
      {name === "play" ? <path d="m8 5 11 7-11 7V5Z" fill="currentColor" /> : null}
      {name === "pause" ? <path d="M7 5h3v14H7zm7 0h3v14h-3z" fill="currentColor" /> : null}
      {name === "stop" ? <rect x="8" y="8" width="8" height="8" rx="1" fill="currentColor" /> : null}
      {name === "record" ? <circle cx="12" cy="12" r="4" fill="currentColor" /> : null}
      {name === "loop" ? <path d="M17.5 7H8a5 5 0 0 0-5 5m3.5 5H16a5 5 0 0 0 5-5M17 3.5 20.5 7 17 10.5M7 13.5 3.5 17 7 20.5" /> : null}
      {name === "undo" ? <path d="M9 8H4m0 0 3-3M4 8l3 3m-3-3h9a5 5 0 0 1 5 5v1" /> : null}
      {name === "redo" ? <path d="M15 8h5m0 0-3-3m3 3-3 3m3-3h-9a5 5 0 0 0-5 5v1" /> : null}
      {name === "speaker" ? <path d="M5 10v4h3l4 3V7L8 10H5Zm10-1.5a5 5 0 0 1 0 7m2-9a8 8 0 0 1 0 11" /> : null}
    </svg>
  );
}

function toggleSet<T>(current: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const next = new Set(current);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}

function TrackControls({
  track,
  muted,
  soloed,
  setMutedTracks,
  setSoloTracks,
}: Readonly<{
  track: Track;
  muted: boolean;
  soloed: boolean;
  setMutedTracks: Dispatch<SetStateAction<ReadonlySet<TrackId>>>;
  setSoloTracks: Dispatch<SetStateAction<ReadonlySet<TrackId>>>;
}>): ReactElement {
  return (
    <div className="track-controls">
      <button
        className={muted ? "track-toggle active" : "track-toggle"}
        type="button"
        aria-label={`${muted ? "Unmute" : "Mute"} ${track.name}`}
        aria-pressed={muted}
        onClick={() => setMutedTracks((current) => toggleSet(current, track.id))}
      >
        M
      </button>
      <button
        className={soloed ? "track-toggle solo active" : "track-toggle solo"}
        type="button"
        aria-label={`${soloed ? "Unsolo" : "Solo"} ${track.name}`}
        aria-pressed={soloed}
        onClick={() => setSoloTracks((current) => toggleSet(current, track.id))}
      >
        S
      </button>
      <span className="track-level" aria-hidden="true">
        <span style={{ width: `${track.volume}%` }} />
      </span>
    </div>
  );
}

function ClipMarks({ kind }: Readonly<{ kind: Track["kind"] }>): ReactElement {
  if (kind === "drum") {
    return (
      <span className="waveform" aria-hidden="true">
        {DRUM_LEVELS.map((height, index) => (
          <i key={`${height}-${index}`} style={{ height: `${height}%` }} />
        ))}
      </span>
    );
  }

  return (
    <span className="note-marks" aria-hidden="true">
      {NOTE_MARKS.map(([left, top, width]) => (
        <i
          key={`${left}-${top}`}
          style={{ "--note-left": `${left}%`, "--note-top": `${top}%`, "--note-width": `${width}%` } as CSSProperties}
        />
      ))}
    </span>
  );
}

function formatTime(playhead: number): string {
  const seconds = Math.round(playhead * 0.78);
  const minute = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, "0");
  return `${minute}:${remainder}.0`;
}

export default function StudioPage(): ReactElement {
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState(CLIPS[4].id);
  const [editorTab, setEditorTab] = useState<EditorTab>("sequence");
  const [activityOpen, setActivityOpen] = useState(true);
  const [playhead, setPlayhead] = useState(27);
  const [mutedTracks, setMutedTracks] = useState<ReadonlySet<TrackId>>(new Set());
  const [soloTracks, setSoloTracks] = useState<ReadonlySet<TrackId>>(new Set());
  const [sequenceSteps, setSequenceSteps] = useState<ReadonlySet<number>>(new Set(INITIAL_SEQUENCE_STEPS));

  const selectedClip = CLIPS.find((clip) => clip.id === selectedClipId) ?? CLIPS[0];
  const selectedTrack = TRACKS.find((track) => track.id === selectedClip.trackId) ?? TRACKS[0];
  return (
    <main className="studio-shell">
      <section className="workspace" id="studio">
        <header className="transport">
          <div className="transport-leading">
            <button className="project-switcher" type="button">
              <span className="project-icon">◫</span>
              <span>Midnight Polaroid</span>
              <span className="version">v1</span>
              <Icon name="chevron" />
            </button>
          </div>

          <div className="transport-console">
            <div className="transport-meta" aria-label="Project tempo">
              <span><small>BPM</small><strong>118</strong></span>
              <span className="time-readout">{formatTime(playhead)}</span>
            </div>

            <div className="transport-controls" aria-label="Playback controls">
              <button
                className="play-button"
                type="button"
                aria-label={isPlaying ? "Pause" : "Play"}
                aria-pressed={isPlaying}
                onClick={() => setIsPlaying((playing) => !playing)}
              >
                <TransportIcon name={isPlaying ? "pause" : "play"} />
              </button>
              <button className="transport-button" type="button" aria-label="Stop" onClick={() => setIsPlaying(false)}>
                <TransportIcon name="stop" />
              </button>
              <button className="transport-button record-button" type="button" aria-label="Record">
                <TransportIcon name="record" />
              </button>
              <button className="transport-button" type="button" aria-label="Loop playback">
                <TransportIcon name="loop" />
              </button>
            </div>

            <div className="history-controls" aria-label="Edit history">
              <button className="transport-button" type="button" aria-label="Undo"><TransportIcon name="undo" /></button>
              <button className="transport-button" type="button" aria-label="Redo"><TransportIcon name="redo" /></button>
            </div>

            <div className="master-output" aria-label="Master output level">
              <TransportIcon name="speaker" />
              <span className="output-line"><span /></span>
            </div>
          </div>

          <div className="transport-actions">
            <button
              className={activityOpen ? "activity-button active" : "activity-button"}
              type="button"
              aria-label={activityOpen ? "Hide activity" : "Show activity"}
              aria-pressed={activityOpen}
              onClick={() => setActivityOpen((open) => !open)}
            >
              <Icon name="activity" />
              Activity
            </button>

            <button className="export-button" type="button">
              <Icon name="download" />
              Export
            </button>
          </div>
        </header>

        <div className="canvas-wrap editor-open">
          <div className="arrangement-pane">
            <section className="arrangement" aria-label="Song arrangement">
            <div className="arrangement-corner">
              <span>TRACKS</span>
              <button type="button" aria-label="Add track">＋</button>
            </div>

            <div className="ruler">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((bar) => <span key={bar}>{String(bar).padStart(2, "0")}</span>)}
            </div>

            {TRACKS.map((track, trackIndex) => (
              <div className="track-row" style={{ gridRow: trackIndex + 2 }} key={track.id}>
                <div className="track-label">
                  <span className="track-copy"><strong>{track.name}</strong><small>{track.preset}</small></span>
                  <button className="track-menu" type="button" aria-label={`More options for ${track.name}`}>•••</button>
                </div>
                <TrackControls
                  track={track}
                  muted={mutedTracks.has(track.id)}
                  soloed={soloTracks.has(track.id)}
                  setMutedTracks={setMutedTracks}
                  setSoloTracks={setSoloTracks}
                />
              </div>
            ))}

            {TRACKS.map((track, trackIndex) => (
              <div className="lane" style={{ gridRow: trackIndex + 2 }} key={`${track.id}-lane`}>
                {CLIPS.filter((clip) => clip.trackId === track.id).map((clip) => (
                  <button
                    className={selectedClip.id === clip.id ? "clip selected" : "clip"}
                    key={clip.id}
                    type="button"
                    aria-label={`Select ${clip.name}`}
                    aria-pressed={selectedClip.id === clip.id}
                    onClick={() => setSelectedClipId(clip.id)}
                    style={{
                      "--clip-color": track.color,
                      "--clip-start": `${clip.start}%`,
                      "--clip-width": `${clip.width}%`,
                    } as CSSProperties}
                  >
                    <span className="clip-title">{clip.name}</span>
                    <ClipMarks kind={track.kind} />
                  </button>
                ))}
              </div>
            ))}

            <div className="playhead" style={{ "--playhead": `${playhead}%` } as CSSProperties} aria-hidden="true">
              <span />
            </div>
            <label className="playhead-control">
              <span>Playhead position</span>
              <input
                type="range"
                min="0"
                max="100"
                value={playhead}
                onChange={(event) => setPlayhead(Number(event.target.value))}
              />
            </label>
            </section>
          </div>

          <aside className="editor-drawer glass-card" aria-label="Track editor">
              <div className="editor-header">
                <span><Icon name={editorTab === "sequence" ? "draw" : "mixer"} /> Track editor</span>
                <div className="editor-tabs">
                  <button className={editorTab === "sequence" ? "active" : ""} type="button" onClick={() => setEditorTab("sequence")}>Sequence</button>
                  <button className={editorTab === "mixer" ? "active" : ""} type="button" onClick={() => setEditorTab("mixer")}>Mixer</button>
                </div>
              </div>

              {editorTab === "sequence" ? (
                <section
                  className="sequence-editor"
                  aria-label={`Sequence editor for ${selectedTrack.name}`}
                  style={{ "--sequence-color": selectedTrack.color } as CSSProperties}
                >
                  <div className="sequence-toolbar">
                    <span><small>SELECTED TRACK</small><strong>{selectedTrack.name}</strong><em>{selectedClip.name} · {selectedClip.detail}</em></span>
                    <div className="sequence-options"><button type="button">Pattern A</button><button type="button">1 / 16</button><button type="button">100%</button></div>
                  </div>
                  <div className="sequence-workspace">
                    <div className="sequence-ruler">
                      {Array.from({ length: 16 }, (_, step) => <span key={step}>{step + 1}</span>)}
                    </div>
                    <div className="sequence-notes">
                      {SEQUENCE_NOTES.map((note) => <span key={note}>{note}</span>)}
                    </div>
                    <div className="sequence-grid">
                      {Array.from({ length: 64 }, (_, step) => (
                        <button
                          className={sequenceSteps.has(step) ? "sequence-step active" : "sequence-step"}
                          key={step}
                          type="button"
                          aria-label={`${sequenceSteps.has(step) ? "Clear" : "Add"} ${SEQUENCE_NOTES[Math.floor(step / 16)]} at step ${(step % 16) + 1}`}
                          aria-pressed={sequenceSteps.has(step)}
                          onClick={() => setSequenceSteps((current) => toggleSet(current, step))}
                        />
                      ))}
                    </div>
                  </div>
                </section>
              ) : (
                <div className="mixer-strips">
                  {TRACKS.map((track) => (
                    <div className="channel-strip" key={`${track.id}-mixer`}>
                      <span className="channel-name">{track.name.split(" ")[0]}</span>
                      <span className="meter"><i style={{ height: `${track.volume}%` }} /><i style={{ height: `${track.volume - 8}%` }} /></span>
                      <input aria-label={`${track.name} volume`} type="range" min="0" max="100" defaultValue={track.volume} />
                      <span className="pan-knob" aria-hidden="true"><i /></span>
                      <div className="channel-buttons">
                        <button className={mutedTracks.has(track.id) ? "active" : ""} type="button" aria-label={`Mute ${track.name}`} aria-pressed={mutedTracks.has(track.id)} onClick={() => setMutedTracks((current) => toggleSet(current, track.id))}>M</button>
                        <button className={soloTracks.has(track.id) ? "active solo" : ""} type="button" aria-label={`Solo ${track.name}`} aria-pressed={soloTracks.has(track.id)} onClick={() => setSoloTracks((current) => toggleSet(current, track.id))}>S</button>
                      </div>
                    </div>
                  ))}
                  <div className="channel-strip master-strip">
                    <span className="channel-name">Master</span>
                    <span className="meter"><i style={{ height: "82%" }} /><i style={{ height: "76%" }} /></span>
                    <input aria-label="Master volume" type="range" min="0" max="100" defaultValue="78" />
                    <span className="pan-knob" aria-hidden="true"><i /></span>
                    <span className="master-label">−3.2</span>
                  </div>
                </div>
              )}
          </aside>

        </div>
      </section>

      {activityOpen ? (
        <aside className="inspector glass-card" aria-label="Activity">
          <div className="inspector-header">
            <span><Icon name="activity" /> Activity</span>
            <button className="close-button" type="button" aria-label="Close activity" onClick={() => setActivityOpen(false)}>×</button>
          </div>
          <div className="activity-list">
            <span className="eyebrow">LATEST CHANGES</span>
            {[
              ["✦", "Agent shaped Glasshouse", "Added open voicings · just now"],
              ["AM", "You adjusted Neon Kit", "Muted the final kick · 2m"],
              ["✦", "Agent created Afterglow", "19 notes · 6m"],
              ["AM", "You renamed the project", "Midnight Polaroid · 9m"],
            ].map(([avatar, title, detail]) => (
              <div className="activity-entry" key={title}>
                <span className={avatar === "✦" ? "mini-orb" : "mini-avatar"}>{avatar}</span>
                <p><strong>{title}</strong><small>{detail}</small></p>
              </div>
            ))}
          </div>
        </aside>
      ) : null}
    </main>
  );
}
