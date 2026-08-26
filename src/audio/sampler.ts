import type { DrumKitDefinition, DrumSoundId } from "./catalog.ts";
import type { DrumTimelineEvent } from "./timeline.ts";

export type LoadArrayBuffer = (url: string) => Promise<ArrayBuffer>;

export interface SamplePreparation {
  readonly readySoundIds: readonly DrumSoundId[];
  readonly unavailableSoundIds: readonly DrumSoundId[];
}

export interface DrumSource {
  readonly key: string;
  readonly ended: Promise<void>;
  stop(audioTime: number): void;
}

export interface SamplerOptions {
  readonly context: AudioContext;
  readonly kit: DrumKitDefinition;
  readonly loadArrayBuffer: LoadArrayBuffer;
}

export interface Sampler {
  prepare(): Promise<SamplePreparation>;
  schedule(
    event: DrumTimelineEvent,
    audioTime: number,
    destination: AudioNode,
  ): DrumSource | undefined;
  clear(): void;
}

const samplePreparation = (
  kit: DrumKitDefinition,
  buffers: ReadonlyMap<DrumSoundId, AudioBuffer>,
): SamplePreparation => ({
  readySoundIds: kit.sounds.filter(({ id }) => buffers.has(id)).map(({ id }) => id),
  unavailableSoundIds: kit.sounds.filter(({ id }) => !buffers.has(id)).map(({ id }) => id),
});

export function createSampler(options: SamplerOptions): Sampler {
  const buffers = new Map<DrumSoundId, AudioBuffer>();
  let pendingPreparation: Promise<SamplePreparation> | undefined;

  return {
    prepare(): Promise<SamplePreparation> {
      if (pendingPreparation !== undefined) {
        return pendingPreparation;
      }

      const unavailableSounds = options.kit.sounds.filter(({ id }) => !buffers.has(id));
      if (unavailableSounds.length === 0) {
        return Promise.resolve(samplePreparation(options.kit, buffers));
      }

      let preparation: Promise<SamplePreparation>;
      preparation = Promise.allSettled(
        unavailableSounds.map(async ({ url }) => options.context.decodeAudioData(
          await options.loadArrayBuffer(url),
        )),
      ).then((results) => {
        for (const [index, result] of results.entries()) {
          if (result.status === "fulfilled") {
            const sound = unavailableSounds[index];
            if (sound !== undefined) {
              buffers.set(sound.id, result.value);
            }
          }
        }
        return samplePreparation(options.kit, buffers);
      }).finally(() => {
        if (pendingPreparation === preparation) {
          pendingPreparation = undefined;
        }
      });
      pendingPreparation = preparation;
      return preparation;
    },

    schedule(event: DrumTimelineEvent, audioTime: number, destination: AudioNode): DrumSource | undefined {
      const buffer = buffers.get(event.soundId as DrumSoundId);
      if (buffer === undefined) {
        return undefined;
      }

      const node = options.context.createBufferSource();
      let stopped = false;
      let cleaned = false;
      let resolveEnded: () => void;
      const ended = new Promise<void>((resolve) => {
        resolveEnded = resolve;
      });
      const cleanup = (): void => {
        if (cleaned) {
          return;
        }
        cleaned = true;
        node.disconnect();
        resolveEnded();
      };

      node.buffer = buffer;
      node.onended = cleanup;
      node.connect(destination);
      node.start(audioTime);

      return {
        key: event.key,
        ended,
        stop(stopAudioTime: number): void {
          if (stopped || cleaned) {
            return;
          }
          stopped = true;
          node.stop(stopAudioTime);
        },
      };
    },

    clear(): void {
      buffers.clear();
      pendingPreparation = undefined;
    },
  };
}
