import type { Project, Track } from "../project/index.ts";
import {
  BASIC_DRUM_KIT,
  SYNTH_PRESETS,
  findSynthPreset,
} from "./catalog.ts";
import type { LoadArrayBuffer } from "./sampler.ts";
import { Sampler } from "./sampler.ts";
import { Synth } from "./synth.ts";
import { arrangementEndStep, expandTimeline, secondsPerStep } from "./timeline.ts";

const CHANNELS = 2;
const SAMPLE_RATE = 44_100;
const BYTES_PER_SAMPLE = 2;
const WAV_HEADER_BYTES = 44;

const writeAscii = (view: DataView, offset: number, value: string): void => {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
};

const pcm16 = (sample: number): number => {
  const clamped = Math.max(-1, Math.min(1, sample));
  return Math.round(clamped * (clamped < 0 ? 32_768 : 32_767));
};

export interface WavExportPlatform {
  readonly createContext: (
    channels: number,
    length: number,
    sampleRate: number,
  ) => OfflineAudioContext;
  readonly loadArrayBuffer: LoadArrayBuffer;
}

export function encodeWav(buffer: AudioBuffer): Blob {
  if (buffer.numberOfChannels !== CHANNELS || buffer.sampleRate !== SAMPLE_RATE) {
    throw new RangeError("WAV export requires a 44.1 kHz stereo audio buffer");
  }
  const dataBytes = buffer.length * CHANNELS * BYTES_PER_SAMPLE;
  const output = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(output);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, output.byteLength - 8, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE, true);
  view.setUint16(32, CHANNELS * BYTES_PER_SAMPLE, true);
  view.setUint16(34, BYTES_PER_SAMPLE * 8, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
  let offset = WAV_HEADER_BYTES;
  for (let frame = 0; frame < buffer.length; frame += 1) {
    for (const channel of channels) {
      view.setInt16(offset, pcm16(channel[frame] ?? 0), true);
      offset += BYTES_PER_SAMPLE;
    }
  }
  return new Blob([output], { type: "audio/wav" });
}

export function wavFileName(projectName: string): string {
  const safeName = projectName
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "")
    .replace(/^[-. ]+$/g, "");
  return `${safeName || "agentdaw"}.wav`;
}

const dbToGain = (decibels: number): number => 10 ** (decibels / 20);
const trackGain = (track: Track, hasSolo: boolean): number =>
  track.muted || (hasSolo && !track.soloed) ? 0 : dbToGain(track.volumeDb);

export async function renderProjectToWav(
  project: Project,
  platform: WavExportPlatform,
): Promise<Blob> {
  const endStep = arrangementEndStep(project);
  const expansion = expandTimeline(project, 0, endStep);
  const releaseSeconds = expansion.events.reduce((longest, event) =>
    event.kind === "synth"
      ? Math.max(longest, findSynthPreset(event.instrumentId)?.releaseSeconds ?? 0)
      : longest, 0);
  const durationSeconds = endStep * secondsPerStep(project.bpm) + releaseSeconds;
  const context = platform.createContext(
    CHANNELS,
    Math.ceil(durationSeconds * SAMPLE_RATE),
    SAMPLE_RATE,
  );
  const master = context.createGain();
  master.gain.setValueAtTime(dbToGain(project.masterVolumeDb), 0);
  master.connect(context.destination);
  const hasSolo = project.tracks.some(({ soloed }) => soloed);
  const buses = new Map(project.tracks.map((track) => {
    const gain = context.createGain();
    const panner = context.createStereoPanner();
    gain.gain.setValueAtTime(trackGain(track, hasSolo), 0);
    panner.pan.setValueAtTime(track.pan, 0);
    gain.connect(panner);
    panner.connect(master);
    return [track.id, gain] as const;
  }));
  const usedSoundIds = new Set(expansion.events
    .filter((event) => event.kind === "drum")
    .map(({ soundId }) => soundId));
  const sampler = new Sampler({
    context,
    kit: {
      ...BASIC_DRUM_KIT,
      sounds: BASIC_DRUM_KIT.sounds.filter(({ id }) => usedSoundIds.has(id)),
    },
    loadArrayBuffer: platform.loadArrayBuffer,
  });
  await sampler.prepare();
  const synthEvents = expansion.events.filter((event) => event.kind === "synth");
  const synth = new Synth({
    context,
    presets: SYNTH_PRESETS,
    voiceCap: Math.max(1, synthEvents.length),
    stopRampSeconds: 0.005,
  });
  for (const event of expansion.events) {
    const destination = buses.get(event.trackId);
    if (destination === undefined) continue;
    const start = event.startStep * secondsPerStep(project.bpm);
    if (event.kind === "drum") sampler.schedule(event, start, destination);
    else synth.schedule(
      event,
      start,
      event.durationSteps * secondsPerStep(project.bpm),
      destination,
    );
  }
  return encodeWav(await context.startRendering());
}
