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

const samplePreparation = (
  kit: DrumKitDefinition,
  buffers: ReadonlyMap<DrumSoundId, AudioBuffer>,
): SamplePreparation => ({
  readySoundIds: kit.sounds.filter(({ id }) => buffers.has(id)).map(({ id }) => id),
  unavailableSoundIds: kit.sounds.filter(({ id }) => !buffers.has(id)).map(({ id }) => id),
});

export class Sampler {
  private readonly options: SamplerOptions;
  private readonly buffers = new Map<DrumSoundId, AudioBuffer>();
  private pendingPreparation: Promise<SamplePreparation> | undefined;
  private preparationGeneration: number = 0;

  constructor(options: SamplerOptions) {
    this.options = options;
  }

  prepare(): Promise<SamplePreparation> {
    if (this.pendingPreparation !== undefined) {
      return this.pendingPreparation;
    }

    const unavailableSounds = this.options.kit.sounds.filter(({ id }) => !this.buffers.has(id));
    if (unavailableSounds.length === 0) {
      return Promise.resolve(samplePreparation(this.options.kit, this.buffers));
    }

    const generation = this.preparationGeneration;
    let preparation: Promise<SamplePreparation>;
    preparation = Promise.allSettled(
      unavailableSounds.map(async ({ url }) => this.options.context.decodeAudioData(
        await this.options.loadArrayBuffer(url),
      )),
    ).then((results) => {
      for (const [index, result] of results.entries()) {
        if (generation === this.preparationGeneration && result.status === "fulfilled") {
          const sound = unavailableSounds[index];
          if (sound !== undefined) {
            this.buffers.set(sound.id, result.value);
          }
        }
      }
      return samplePreparation(this.options.kit, this.buffers);
    }).finally(() => {
      if (this.pendingPreparation === preparation) {
        this.pendingPreparation = undefined;
      }
    });
    this.pendingPreparation = preparation;
    return preparation;
  }

  schedule(event: DrumTimelineEvent, audioTime: number, destination: AudioNode): DrumSource | undefined {
    const buffer = this.buffers.get(event.soundId as DrumSoundId);
    if (buffer === undefined) {
      return undefined;
    }

    const node = this.options.context.createBufferSource();
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
  }

  clear(): void {
    this.buffers.clear();
    this.pendingPreparation = undefined;
    this.preparationGeneration += 1;
  }
}
