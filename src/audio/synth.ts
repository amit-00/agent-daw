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

export interface Synth {
  schedule(
    event: SynthTimelineEvent,
    audioTime: number,
    durationSeconds: number,
    destination: AudioNode,
  ): SynthVoice | undefined;
  stopAll(audioTime: number): void;
  stopTrack(trackId: string, audioTime: number): void;
  activeVoiceCount(): number;
}

export const midiNoteToFrequency = (note: number): number =>
  440 * 2 ** ((note - 69) / 12);

const findPreset = (
  presets: Readonly<Record<SynthPresetId, SynthPreset>>,
  instrumentId: string,
): SynthPreset | undefined => Object.values(presets).find(({ id }) => id === instrumentId);

export function createSynth(options: SynthOptions): Synth {
  if (options.voiceCap <= 0) {
    throw new RangeError(`Synth voice cap must be greater than zero; received ${options.voiceCap}`);
  }
  if (options.stopRampSeconds <= 0) {
    throw new RangeError(
      `Synth stop ramp seconds must be greater than zero; received ${options.stopRampSeconds}`,
    );
  }

  const activeVoices = new Set<SynthVoice>();

  const stopOldestVoice = (trackId: string, audioTime: number): void => {
    const oldest = [...activeVoices].find((voice) => voice.trackId === trackId)
      ?? activeVoices.values().next().value;
    oldest?.stop(audioTime);
  };

  return {
    schedule(
      event: SynthTimelineEvent,
      audioTime: number,
      durationSeconds: number,
      destination: AudioNode,
    ): SynthVoice | undefined {
      const preset = findPreset(options.presets, event.instrumentId);
      if (preset === undefined) {
        return undefined;
      }
      if (activeVoices.size >= options.voiceCap) {
        stopOldestVoice(event.trackId, audioTime);
      }

      const oscillator = options.context.createOscillator();
      const filter = options.context.createBiquadFilter();
      const gain = options.context.createGain();
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
        activeVoices.delete(voice);
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
      gain.gain.setValueAtTime(preset.peakGain * preset.sustainGain, audioTime + durationSeconds);
      gain.gain.linearRampToValueAtTime(0, releaseEnd);
      oscillator.connect(filter);
      filter.connect(gain);
      gain.connect(destination);

      voice = {
        key: event.key,
        trackId: event.trackId,
        startedAt: audioTime,
        ended,
        stop(stopAudioTime: number): void {
          if (stopped || cleaned) {
            return;
          }
          stopped = true;
          activeVoices.delete(voice);
          gain.gain.cancelScheduledValues(stopAudioTime);
          gain.gain.setValueAtTime(gain.gain.value, stopAudioTime);
          const stopEnd = Math.round((stopAudioTime + options.stopRampSeconds) * 1_000_000_000) / 1_000_000_000;
          gain.gain.linearRampToValueAtTime(0, stopEnd);
          oscillator.stop(stopEnd);
        },
      };
      oscillator.onended = cleanup;
      activeVoices.add(voice);
      oscillator.start(audioTime);
      oscillator.stop(releaseEnd);
      return voice;
    },

    stopAll(audioTime: number): void {
      for (const voice of [...activeVoices]) {
        voice.stop(audioTime);
      }
    },

    stopTrack(trackId: string, audioTime: number): void {
      for (const voice of [...activeVoices]) {
        if (voice.trackId === trackId) {
          voice.stop(audioTime);
        }
      }
    },

    activeVoiceCount(): number {
      return activeVoices.size;
    },
  };
}
