"use client";

import type { CSSProperties, Dispatch, ReactElement, SetStateAction } from "react";
import { useState } from "react";

type TrackId = "drums" | "bass" | "chords" | "melody" | "pad";
type ToolId = "select" | "draw" | "split" | "focus";
type IconName =
  | "activity"
  | "chevron"
  | "compose"
  | "download"
  | "draw"
  | "focus"
  | "history"
  | "mixer"
  | "pause"
  | "play"
  | "redo"
  | "select"
  | "sounds"
  | "split"
  | "stop"
  | "undo";

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

interface Tool {
  readonly id: ToolId;
  readonly label: string;
  readonly icon: IconName;
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

const TOOLS: readonly Tool[] = [
  { id: "select", label: "Select", icon: "select" },
  { id: "draw", label: "Draw", icon: "draw" },
  { id: "split", label: "Split", icon: "split" },
  { id: "focus", label: "Focus", icon: "focus" },
] as const;

const ICONS: Readonly<Record<IconName, string>> = {
  activity: "⌁",
  chevron: "›",
  compose: "✦",
  download: "⇩",
  draw: "✎",
  focus: "⌖",
  history: "↶",
  mixer: "≡",
  pause: "Ⅱ",
  play: "▶",
  redo: "↷",
  select: "↖",
  sounds: "♬",
  split: "✂",
  stop: "■",
  undo: "↶",
};

const DRUM_LEVELS = [33, 58, 41, 75, 51, 86, 42, 67, 47, 80, 57, 91, 49, 70, 38, 76, 53, 88, 44, 72, 35, 61, 46, 82] as const;
const NOTE_MARKS = [
  [5, 22, 16], [18, 46, 25], [32, 31, 11], [43, 62, 20],
  [58, 18, 13], [67, 43, 21], [82, 29, 12], [91, 56, 7],
] as const;

function Icon({ name, size = 16 }: Readonly<{ name: IconName; size?: number }>): ReactElement {
  return (
    <span className="icon" style={{ fontSize: size }} aria-hidden="true">
      {ICONS[name]}
    </span>
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
  const [mixerOpen, setMixerOpen] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(true);
  const [activeTool, setActiveTool] = useState<ToolId>("select");
  const [playhead, setPlayhead] = useState(27);
  const [mutedTracks, setMutedTracks] = useState<ReadonlySet<TrackId>>(new Set());
  const [soloTracks, setSoloTracks] = useState<ReadonlySet<TrackId>>(new Set());

  const selectedClip = CLIPS.find((clip) => clip.id === selectedClipId) ?? CLIPS[0];
  return (
    <main className="studio-shell">
      {sidebarOpen ? (
        <nav className="sidebar glass-card" aria-label="Primary navigation">
          <div className="sidebar-heading">
            <a className="brand" href="#studio" aria-label="AgentDAW studio">
              <span className="brand-mark" aria-hidden="true">A</span>
              <span>Agent<span>DAW</span></span>
            </a>
            <button className="close-button" type="button" aria-label="Close menu" onClick={() => setSidebarOpen(false)}>×</button>
          </div>

          <div className="nav-items">
            <button className="nav-item active" type="button"><Icon name="compose" />Compose</button>
            <button className="nav-item" type="button"><Icon name="sounds" />Sounds</button>
            <button className="nav-item" type="button"><Icon name="history" />History</button>
          </div>

          <div className="sidebar-footer">
            <div className="agent-status">
              <span className="agent-orb"><Icon name="activity" /></span>
              <span><strong>Agent online</strong><small>WebMCP ready</small></span>
              <span className="status-dot" aria-label="Connected" />
            </div>
            <button className="profile" type="button" aria-label="Open profile menu">
              <span className="avatar">AM</span>
              <span><strong>Amit&apos;s Studio</strong><small>Local project</small></span>
              <Icon name="chevron" />
            </button>
          </div>
        </nav>
      ) : null}

      <section className="workspace" id="studio">
        <header className="transport">
          <button
            className={sidebarOpen ? "icon-button panel-toggle active" : "icon-button panel-toggle"}
            type="button"
            aria-label={sidebarOpen ? "Close menu" : "Open menu"}
            aria-pressed={sidebarOpen}
            onClick={() => setSidebarOpen((open) => !open)}
          >
            <Icon name="mixer" />
          </button>
          <button className="project-switcher" type="button">
            <span className="project-icon">◫</span>
            <span>Midnight Polaroid</span>
            <span className="version">v1</span>
            <Icon name="chevron" />
          </button>

          <div className="transport-meta" aria-label="Project tempo">
            <span><small>BPM</small><strong>118</strong></span>
            <span className="time-readout">{formatTime(playhead)}</span>
          </div>

          <div className="transport-controls">
            <button className="icon-button" type="button" aria-label="Undo"><Icon name="undo" /></button>
            <button className="icon-button" type="button" aria-label="Redo"><Icon name="redo" /></button>
            <button
              className="play-button"
              type="button"
              aria-label={isPlaying ? "Pause" : "Play"}
              aria-pressed={isPlaying}
              onClick={() => setIsPlaying((playing) => !playing)}
            >
              <Icon name={isPlaying ? "pause" : "play"} size={13} />
            </button>
            <button className="icon-button stop" type="button" aria-label="Stop" onClick={() => setIsPlaying(false)}>
              <Icon name="stop" size={9} />
            </button>
            <span className={isPlaying ? "record-dot pulsing" : "record-dot"} aria-hidden="true" />
          </div>

          <div className="master-output" aria-label="Master output level">
            <span className="speaker">◖</span>
            <span className="output-line"><span /></span>
          </div>

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
        </header>

        <div className="canvas-wrap">
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

          {mixerOpen ? (
            <aside className="mixer glass-card" aria-label="Mixer">
              <div className="mixer-header">
                <span><Icon name="mixer" /> Mixer</span>
                <div className="mixer-tabs"><button className="active" type="button">Channels</button><button type="button">Master</button></div>
                <button className="close-button" type="button" aria-label="Close mixer" onClick={() => setMixerOpen(false)}>×</button>
              </div>
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
            </aside>
          ) : null}

          <div className="tool-dock glass-card" role="toolbar" aria-label="Editing tools">
            {TOOLS.map((tool) => (
              <button
                className={activeTool === tool.id ? "active" : ""}
                key={tool.id}
                type="button"
                aria-label={tool.label}
                aria-pressed={activeTool === tool.id}
                title={tool.label}
                onClick={() => setActiveTool(tool.id)}
              >
                <Icon name={tool.icon} />
              </button>
            ))}
            <span className="dock-divider" />
            <button
              className={mixerOpen ? "active wide" : "wide"}
              type="button"
              aria-label={mixerOpen ? "Hide mixer" : "Show mixer"}
              aria-pressed={mixerOpen}
              onClick={() => setMixerOpen((open) => !open)}
            >
              <Icon name="mixer" /> Mixer
            </button>
          </div>
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
