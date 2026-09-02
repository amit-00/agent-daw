export interface AutomationEvent {
  readonly method: "set" | "linear" | "cancel" | "hold";
  readonly value?: number;
  readonly time: number;
}

export const disableCancelAndHoldAtTime = (parameter: AudioParam): void => {
  Object.defineProperty(parameter, "cancelAndHoldAtTime", { value: undefined });
};

export class FakeAudioParam {
  value = 0;
  readonly events: AutomationEvent[] = [];

  setValueAtTime(value: number, time: number): FakeAudioParam {
    this.value = value;
    this.events.push({ method: "set", value, time });
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): FakeAudioParam {
    this.value = value;
    this.events.push({ method: "linear", value, time });
    return this;
  }

  cancelScheduledValues(time: number): FakeAudioParam {
    this.events.push({ method: "cancel", time });
    return this;
  }

  cancelAndHoldAtTime(time: number): FakeAudioParam {
    this.events.push({ method: "hold", time });
    return this;
  }
}

export class FakeAudioNode {
  readonly connections: unknown[] = [];
  disconnected = false;

  connect(destination: unknown): unknown {
    this.connections.push(destination);
    return destination;
  }

  disconnect(): void {
    this.disconnected = true;
    this.connections.length = 0;
  }
}

export class FakeBufferSource extends FakeAudioNode {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  readonly startTimes: number[] = [];
  readonly stopTimes: number[] = [];

  start(when?: number): void {
    this.startTimes.push(when ?? 0);
  }

  stop(when?: number): void {
    this.stopTimes.push(when ?? 0);
  }

  finish(): void {
    this.onended?.();
  }
}

export class FakeGainNode extends FakeAudioNode {
  readonly gain = new FakeAudioParam();
}

export class FakeStereoPannerNode extends FakeAudioNode {
  readonly pan = new FakeAudioParam();
}

export class FakeOscillatorNode extends FakeAudioNode {
  type: OscillatorType = "sine";
  readonly frequency = new FakeAudioParam();
  onended: (() => void) | null = null;
  readonly startTimes: number[] = [];
  readonly stopTimes: number[] = [];

  start(when?: number): void {
    this.startTimes.push(when ?? 0);
  }

  stop(when?: number): void {
    this.stopTimes.splice(0, this.stopTimes.length, when ?? 0);
  }

  finish(): void {
    this.onended?.();
  }
}

export class FakeBiquadFilterNode extends FakeAudioNode {
  type: BiquadFilterType = "lowpass";
  readonly frequency = new FakeAudioParam();
  readonly Q = new FakeAudioParam();
}

export class FakeAudioContext {
  currentTime = 0;
  state: AudioContextState = "suspended";
  readonly destination = new FakeAudioNode();
  readonly bufferSources: FakeBufferSource[] = [];
  readonly gains: FakeGainNode[] = [];
  readonly panners: FakeStereoPannerNode[] = [];
  readonly oscillators: FakeOscillatorNode[] = [];
  readonly filters: FakeBiquadFilterNode[] = [];
  decodeFailures = 0;

  async resume(): Promise<void> {
    this.state = "running";
  }

  async close(): Promise<void> {
    this.state = "closed";
  }

  async decodeAudioData(_: ArrayBuffer): Promise<AudioBuffer> {
    if (this.decodeFailures > 0) {
      this.decodeFailures -= 1;
      throw new DOMException("decode failed", "EncodingError");
    }
    return { duration: 0.1 } as AudioBuffer;
  }

  createBufferSource(): AudioBufferSourceNode {
    const value = new FakeBufferSource();
    this.bufferSources.push(value);
    return value as unknown as AudioBufferSourceNode;
  }

  createGain(): GainNode {
    const value = new FakeGainNode();
    this.gains.push(value);
    return value as unknown as GainNode;
  }

  createStereoPanner(): StereoPannerNode {
    const value = new FakeStereoPannerNode();
    this.panners.push(value);
    return value as unknown as StereoPannerNode;
  }

  createOscillator(): OscillatorNode {
    const value = new FakeOscillatorNode();
    this.oscillators.push(value);
    return value as unknown as OscillatorNode;
  }

  createBiquadFilter(): BiquadFilterNode {
    const value = new FakeBiquadFilterNode();
    this.filters.push(value);
    return value as unknown as BiquadFilterNode;
  }

  asAudioContext(): AudioContext {
    return this as unknown as AudioContext;
  }
}

export class FakeOfflineAudioContext extends FakeAudioContext {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  renderFailure: Error | undefined;

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    super();
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
  }

  async startRendering(): Promise<AudioBuffer> {
    if (this.renderFailure !== undefined) throw this.renderFailure;
    return {
      duration: this.length / this.sampleRate,
      length: this.length,
      numberOfChannels: this.numberOfChannels,
      sampleRate: this.sampleRate,
      getChannelData: (): Float32Array => new Float32Array(this.length),
    } as unknown as AudioBuffer;
  }

  asOfflineAudioContext(): OfflineAudioContext {
    return this as unknown as OfflineAudioContext;
  }
}

export class FakeTimers {
  nextId = 1;
  readonly callbacks = new Map<number, () => void>();
  readonly intervals: number[] = [];

  setInterval(callback: () => void, milliseconds: number): unknown {
    const id = this.nextId;
    this.nextId += 1;
    this.callbacks.set(id, callback);
    this.intervals.push(milliseconds);
    return id;
  }

  clearInterval(handle: unknown): void {
    if (typeof handle === "number") this.callbacks.delete(handle);
  }

  tick(): void {
    for (const callback of [...this.callbacks.values()]) callback();
  }
}
