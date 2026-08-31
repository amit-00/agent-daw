import type { SynthPreset, SynthPresetId } from "./catalog.ts";
import type { SynthTimelineEvent } from "./timeline.ts";

export interface SynthVoice {
  readonly key: string;
  readonly trackId: string;
  readonly startedAt: number;
  readonly ended: Promise<void>;
  stop(audioTime: number): void;
}

export interface SynthOptions {
  readonly context: AudioContext;
  readonly presets: Readonly<Record<SynthPresetId, SynthPreset>>;
  readonly voiceCap: number;
  readonly stopRampSeconds: number;
}

export const midiNoteToFrequency = (note: number): number =>
  440 * 2 ** ((note - 69) / 12);

const findPreset = (
  presets: Readonly<Record<SynthPresetId, SynthPreset>>,
  instrumentId: string,
): SynthPreset | undefined => Object.values(presets).find(({ id }) => id === instrumentId);

const envelopeValueDuringNote = (preset: SynthPreset, elapsedSeconds: number): number => {
  if (elapsedSeconds <= 0) {
    return 0;
  }
  if (elapsedSeconds < preset.attackSeconds) {
    return preset.peakGain * elapsedSeconds / preset.attackSeconds;
  }
  const sustainGain = preset.peakGain * preset.sustainGain;
  const decayElapsed = elapsedSeconds - preset.attackSeconds;
  if (decayElapsed < preset.decaySeconds) {
    return preset.peakGain +
      (sustainGain - preset.peakGain) * decayElapsed / preset.decaySeconds;
  }
  return sustainGain;
};

const envelopeValueAtTime = (
  preset: SynthPreset,
  audioTime: number,
  durationSeconds: number,
  valueTime: number,
): number => {
  const noteEnd = audioTime + durationSeconds;
  if (valueTime <= noteEnd) {
    return envelopeValueDuringNote(preset, valueTime - audioTime);
  }
  const releaseElapsed = valueTime - noteEnd;
  if (releaseElapsed >= preset.releaseSeconds) {
    return 0;
  }
  return envelopeValueDuringNote(preset, durationSeconds) *
    (1 - releaseElapsed / preset.releaseSeconds);
};

const holdEnvelopeAtTime = (
  parameter: AudioParam,
  audioTime: number,
  value: number,
): void => {
  if (typeof parameter.cancelAndHoldAtTime === "function") {
    parameter.cancelAndHoldAtTime(audioTime);
    return;
  }
  parameter.cancelScheduledValues(audioTime);
  parameter.setValueAtTime(value, audioTime);
};

export class Synth {
  private readonly options: SynthOptions;
  private readonly activeVoices = new Set<SynthVoice>();

  constructor(options: SynthOptions) {
    if (!Number.isInteger(options.voiceCap) || options.voiceCap <= 0) {
      throw new RangeError(`Synth voice cap must be a positive integer; received ${options.voiceCap}`);
    }
    if (!Number.isFinite(options.stopRampSeconds) || options.stopRampSeconds <= 0) {
      throw new RangeError(
        `Synth stop ramp seconds must be finite and greater than zero; received ${options.stopRampSeconds}`,
      );
    }
    this.options = options;
  }

  private stopOldestVoice(trackId: string, audioTime: number): void {
    let oldestOnTrack: SynthVoice | undefined;
    let oldest: SynthVoice | undefined;
    for (const voice of this.activeVoices) {
      if (oldest === undefined || voice.startedAt < oldest.startedAt) {
        oldest = voice;
      }
      if (
        voice.trackId === trackId &&
        (oldestOnTrack === undefined || voice.startedAt < oldestOnTrack.startedAt)
      ) {
        oldestOnTrack = voice;
      }
    }
    (oldestOnTrack ?? oldest)?.stop(audioTime);
  }

  schedule(
    event: SynthTimelineEvent,
    audioTime: number,
    durationSeconds: number,
    destination: AudioNode,
  ): SynthVoice | undefined {
    const preset = findPreset(this.options.presets, event.instrumentId);
    if (preset === undefined) {
      return undefined;
    }
    if (this.activeVoices.size >= this.options.voiceCap) {
      this.stopOldestVoice(event.trackId, audioTime);
    }

    const oscillator = this.options.context.createOscillator();
    const filter = this.options.context.createBiquadFilter();
    const gain = this.options.context.createGain();
    const releaseEnd = Math.round(
      (audioTime + durationSeconds + preset.releaseSeconds) * 1_000_000_000,
    ) / 1_000_000_000;
    let stopped = false;
    let cleaned = false;
    let resolveEnded = (): void => undefined;
    let voice: SynthVoice;

    const cleanup = (): void => {
      if (cleaned) {
        return;
      }
      cleaned = true;
      this.activeVoices.delete(voice);
      oscillator.disconnect();
      filter.disconnect();
      gain.disconnect();
      resolveEnded();
    };

    const ended = new Promise<void>((resolve) => {
      resolveEnded = resolve;
    });

    oscillator.type = preset.oscillator;
    oscillator.frequency.setValueAtTime(midiNoteToFrequency(event.midiNote), audioTime);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(preset.filterCutoffHz, audioTime);
    filter.Q.setValueAtTime(preset.filterQ, audioTime);
    gain.gain.setValueAtTime(0, audioTime);
    gain.gain.linearRampToValueAtTime(preset.peakGain, audioTime + preset.attackSeconds);
    gain.gain.linearRampToValueAtTime(
      preset.peakGain * preset.sustainGain,
      audioTime + preset.attackSeconds + preset.decaySeconds,
    );
    holdEnvelopeAtTime(
      gain.gain,
      audioTime + durationSeconds,
      envelopeValueAtTime(preset, audioTime, durationSeconds, audioTime + durationSeconds),
    );
    gain.gain.linearRampToValueAtTime(0, releaseEnd);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(destination);

    voice = {
      key: event.key,
      trackId: event.trackId,
      startedAt: audioTime,
      ended,
      stop: (stopAudioTime: number): void => {
        if (stopped || cleaned) {
          return;
        }
        stopped = true;
        this.activeVoices.delete(voice);
        holdEnvelopeAtTime(
          gain.gain,
          stopAudioTime,
          envelopeValueAtTime(preset, audioTime, durationSeconds, stopAudioTime),
        );
        const stopEnd = Math.round((stopAudioTime + this.options.stopRampSeconds) * 1_000_000_000) / 1_000_000_000;
        gain.gain.linearRampToValueAtTime(0, stopEnd);
        oscillator.stop(stopEnd);
      },
    };
    oscillator.onended = cleanup;
    this.activeVoices.add(voice);
    oscillator.start(audioTime);
    oscillator.stop(releaseEnd);
    return voice;
  }

  stopAll(audioTime: number): void {
    for (const voice of [...this.activeVoices]) {
      voice.stop(audioTime);
    }
  }

  stopTrack(trackId: string, audioTime: number): void {
    for (const voice of [...this.activeVoices]) {
      if (voice.trackId === trackId) {
        voice.stop(audioTime);
      }
    }
  }

  activeVoiceCount(): number {
    return this.activeVoices.size;
  }
}
