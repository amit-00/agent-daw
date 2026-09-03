import type { Project, Track } from "../project/index.ts";
import { BASIC_DRUM_KIT, SYNTH_PRESETS } from "./catalog.ts";
import type { DrumSource, LoadArrayBuffer } from "./sampler.ts";
import { Sampler } from "./sampler.ts";
import type { SynthVoice } from "./synth.ts";
import { Synth } from "./synth.ts";
import {
  arrangementEndStep,
  audioTimeForStep,
  expandTimeline,
  playbackFingerprint,
  positionAtAudioTime,
  secondsPerStep,
} from "./timeline.ts";

export type AudioEngineStatus = "stopped" | "playing" | "paused" | "blocked" | "closed";
export type AudioIssueCode =
  | "missing_sample"
  | "missing_pattern"
  | "missing_track"
  | "unknown_preset"
  | "late_scheduler"
  | "source_failed";

export interface AudioIssue {
  readonly code: AudioIssueCode;
  readonly message: string;
  readonly relatedId?: string;
}

export interface AudioEngineSnapshot {
  readonly status: AudioEngineStatus;
  readonly positionStep: number;
  readonly arrangementEndStep: number;
  readonly unavailableSoundIds: readonly string[];
  readonly activeVoices: number;
  readonly pendingSources: number;
  readonly lateWakeups: number;
  readonly trackBusCount: number;
  readonly trackLevels: Readonly<Record<string, number>>;
  readonly masterLevel: number;
  readonly lastIssue?: AudioIssue;
}

export type PrepareResult =
  | { readonly ok: true; readonly status: "ready" | "degraded"; readonly unavailableSoundIds: readonly string[] }
  | { readonly ok: false; readonly code: "blocked" | "closed"; readonly message: string };

export type AudioControlResult =
  | {
      readonly ok: true;
      readonly status: "playing" | "paused" | "stopped";
      readonly positionStep: number;
    }
  | {
      readonly ok: false;
      readonly code: "blocked" | "closed" | "nothing_to_play" | "no_project";
      readonly message: string;
    };

export interface AudioEnginePlatform {
  readonly createContext: () => AudioContext;
  readonly loadArrayBuffer: LoadArrayBuffer;
  readonly setInterval: (callback: () => void, milliseconds: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
}

interface TrackBus {
  readonly gain: GainNode;
  readonly panner: StereoPannerNode;
  readonly analyser: AnalyserNode;
}

interface RetainedSource {
  readonly trackId: string;
  readonly source: DrumSource | SynthVoice;
}

interface EventTombstone {
  readonly generation: number;
  readonly endStep: number;
}

interface MixerRamp {
  readonly startTime: number;
  readonly startValue: number;
  readonly endTime: number;
  readonly endValue: number;
}

const MIXER_RAMP_SECONDS = 0.005;
const PLAYBACK_START_LEAD_SECONDS = 0.05;
const SCHEDULER_LOOKAHEAD_SECONDS = 0.1;
const SCHEDULER_TICK_MILLISECONDS = 25;
const METER_FLOOR_DB = -60;
const dbToGain = (decibels: number): number => 10 ** (decibels / 20);
const isAutoplayPolicyError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "NotAllowedError";

const targetGain = (track: Track, hasSolo: boolean): number =>
  track.muted || (hasSolo && !track.soloed) ? 0 : dbToGain(track.volumeDb);

const blockedResult = (): {
  readonly ok: false;
  readonly code: "blocked";
  readonly message: string;
} => ({
  ok: false,
  code: "blocked",
  message: "Audio context is suspended; retry from a user gesture",
});

const closedResult = (): {
  readonly ok: false;
  readonly code: "closed";
  readonly message: string;
} => ({
  ok: false,
  code: "closed",
  message: "Audio engine is closed; create a new engine",
});

export class AudioEngine {
  private readonly platform: AudioEnginePlatform;
  private context: AudioContext | undefined;
  private sampler: Sampler | undefined;
  private synth: Synth | undefined;
  private master: GainNode | undefined;
  private masterAnalyser: AnalyserNode | undefined;
  private project: Project | undefined;
  private projectFingerprint: string = "";
  private projectArrangementEndStep: number = 0;
  private status: AudioEngineStatus = "stopped";
  private unavailableSoundIds: readonly string[] = [];
  private lastIssue: AudioIssue | undefined;
  private preparation: Promise<PrepareResult> | undefined;
  private disposal: Promise<void> | undefined;
  private positionStep: number = 0;
  private anchorStep: number = 0;
  private anchorAudioTime: number = 0;
  private generation: number = 0;
  private playIntentRevision: number = 0;
  private scheduledHorizonAudioTime: number | undefined;
  private schedulerTimer: { readonly handle: unknown } | undefined;
  private lateWakeups: number = 0;
  private readonly trackBuses = new Map<string, TrackBus>();
  private readonly pendingSources = new Map<string, RetainedSource>();
  private readonly eventTombstones = new Map<string, EventTombstone>();
  private readonly mixerRamps = new WeakMap<AudioParam, MixerRamp>();
  private readonly meterSamples = new Float32Array(32);

  constructor(platform: AudioEnginePlatform) {
    this.platform = platform;
  }

  private clampStep(step: number): number {
    return Math.min(
      Math.max(Number.isNaN(step) ? 0 : step, 0),
      this.projectArrangementEndStep,
    );
  }

  private currentPositionStep(): number {
    if (this.status !== "playing" || this.context === undefined || this.project === undefined) {
      return this.positionStep;
    }
    return this.clampStep(positionAtAudioTime(
      this.anchorStep,
      this.anchorAudioTime,
      this.context.currentTime,
      this.project.bpm,
    ));
  }

  private clearSchedulerTimer(): void {
    if (this.schedulerTimer === undefined) {
      return;
    }
    this.platform.clearInterval(this.schedulerTimer.handle);
    this.schedulerTimer = undefined;
  }

  private stopPendingSources(audioTime: number): void {
    for (const { source } of this.pendingSources.values()) {
      source.stop(audioTime);
    }
    this.pendingSources.clear();
    this.eventTombstones.clear();
  }

  private cancelPlayback(): void {
    this.clearSchedulerTimer();
    this.scheduledHorizonAudioTime = undefined;
    if (this.context !== undefined) {
      this.stopPendingSources(this.context.currentTime);
    } else {
      this.pendingSources.clear();
      this.eventTombstones.clear();
    }
  }

  private closeEngine(closeContext: boolean): Promise<void> {
    if (this.disposal !== undefined) {
      return this.disposal;
    }
    this.playIntentRevision += 1;
    this.status = "closed";
    this.preparation = undefined;
    this.cancelPlayback();
    this.positionStep = 0;
    this.sampler?.clear();
    this.synth?.stopAll(this.context?.currentTime ?? 0);
    for (const bus of this.trackBuses.values()) {
      bus.gain.disconnect();
      bus.panner.disconnect();
      bus.analyser.disconnect();
    }
    this.trackBuses.clear();
    this.master?.disconnect();
    this.masterAnalyser?.disconnect();
    this.disposal = closeContext && this.context !== undefined && this.context.state !== "closed"
      ? this.context.close()
      : Promise.resolve();
    return this.disposal;
  }

  private stopTrackSources(trackId: string, audioTime: number): void {
    for (const [eventKey, retained] of this.pendingSources) {
      if (retained.trackId !== trackId) {
        continue;
      }
      retained.source.stop(audioTime);
      this.pendingSources.delete(eventKey);
    }
  }

  private ramp(parameter: AudioParam, value: number): void {
    const currentTime = this.context?.currentTime;
    if (currentTime === undefined) {
      return;
    }
    const previousRamp = this.mixerRamps.get(parameter);
    const currentValue = previousRamp === undefined || currentTime >= previousRamp.endTime
      ? previousRamp?.endValue ?? parameter.value
      : previousRamp.startValue +
        (previousRamp.endValue - previousRamp.startValue) *
        Math.max(0, (currentTime - previousRamp.startTime) / (previousRamp.endTime - previousRamp.startTime));
    if (typeof parameter.cancelAndHoldAtTime === "function") {
      parameter.cancelAndHoldAtTime(currentTime);
    } else {
      parameter.cancelScheduledValues(currentTime);
      parameter.setValueAtTime(currentValue, currentTime);
    }
    const endTime = currentTime + MIXER_RAMP_SECONDS;
    parameter.linearRampToValueAtTime(value, endTime);
    this.mixerRamps.set(parameter, {
      startTime: currentTime,
      startValue: currentValue,
      endTime,
      endValue: value,
    });
  }

  private synchronizeMixer(): void {
    if (this.context === undefined || this.master === undefined || this.project === undefined) {
      return;
    }

    const currentTrackIds = new Set(this.project.tracks.map(({ id }) => id));
    for (const [trackId, bus] of this.trackBuses) {
      if (currentTrackIds.has(trackId)) {
        continue;
      }
      this.synth?.stopTrack(trackId, this.context.currentTime);
      this.stopTrackSources(trackId, this.context.currentTime);
      bus.gain.disconnect();
      bus.panner.disconnect();
      bus.analyser.disconnect();
      this.trackBuses.delete(trackId);
    }

    const hasSolo = this.project.tracks.some(({ soloed }) => soloed);
    this.ramp(this.master.gain, dbToGain(this.project.masterVolumeDb));
    for (const track of this.project.tracks) {
      let bus = this.trackBuses.get(track.id);
      if (bus === undefined) {
        const gain = this.context.createGain();
        const panner = this.context.createStereoPanner();
        const analyser = this.context.createAnalyser();
        analyser.fftSize = this.meterSamples.length;
        gain.connect(panner);
        panner.connect(analyser);
        analyser.connect(this.master);
        bus = { gain, panner, analyser };
        this.trackBuses.set(track.id, bus);
      }
      this.ramp(bus.gain.gain, targetGain(track, hasSolo));
      this.ramp(bus.panner.pan, track.pan);
    }
  }

  private initializeRuntime(): void {
    if (this.context !== undefined) {
      return;
    }
    this.context = this.platform.createContext();
    this.master = this.context.createGain();
    this.masterAnalyser = this.context.createAnalyser();
    this.masterAnalyser.fftSize = this.meterSamples.length;
    this.master.connect(this.masterAnalyser);
    this.masterAnalyser.connect(this.context.destination);
    this.sampler = new Sampler({
      context: this.context,
      kit: BASIC_DRUM_KIT,
      loadArrayBuffer: this.platform.loadArrayBuffer,
    });
    this.synth = new Synth({
      context: this.context,
      presets: SYNTH_PRESETS,
      voiceCap: 64,
      stopRampSeconds: MIXER_RAMP_SECONDS,
    });
  }

  private scheduleRange(startStep: number, endStep: number): void {
    if (
      this.project === undefined ||
      this.context === undefined ||
      this.sampler === undefined ||
      this.synth === undefined ||
      endStep <= startStep
    ) {
      return;
    }

    const expansion = expandTimeline(this.project, startStep, endStep);
    for (const issue of expansion.issues) {
      if (issue.code === "missing_pattern" || issue.code === "missing_track") {
        this.lastIssue = {
          code: issue.code,
          message: issue.message,
          ...(issue.relatedId === undefined ? {} : { relatedId: issue.relatedId }),
        };
      }
    }

    for (const event of expansion.events) {
      if (this.eventTombstones.get(event.key)?.generation === this.generation) {
        continue;
      }
      const bus = this.trackBuses.get(event.trackId);
      if (bus === undefined) {
        this.lastIssue = {
          code: "missing_track",
          message: "Timeline event references a missing mixer track",
          relatedId: event.trackId,
        };
        continue;
      }

      let source: DrumSource | SynthVoice | undefined;
      try {
        const audioTime = audioTimeForStep(
          event.startStep,
          this.anchorStep,
          this.anchorAudioTime,
          this.project.bpm,
        );
        source = event.kind === "drum"
          ? this.sampler.schedule(event, audioTime, bus.gain)
          : this.synth.schedule(
            event,
            audioTime,
            event.durationSteps * secondsPerStep(this.project.bpm),
            bus.gain,
          );
      } catch (error) {
        if (!(error instanceof DOMException)) {
          throw error;
        }
        this.lastIssue = {
          code: "source_failed",
          message: "Audio source could not be scheduled",
          relatedId: event.key,
        };
        continue;
      }

      if (source === undefined) {
        this.lastIssue = event.kind === "drum"
          ? {
            code: "missing_sample",
            message: "Drum sample is unavailable",
            relatedId: event.soundId,
          }
          : {
            code: "unknown_preset",
            message: "Synth preset is unavailable",
            relatedId: event.instrumentId,
          };
        continue;
      }

      const retained: RetainedSource = {
        trackId: event.trackId,
        source,
      };
      this.pendingSources.set(event.key, retained);
      this.eventTombstones.set(event.key, {
        generation: this.generation,
        endStep: event.kind === "synth"
          ? event.startStep + event.durationSteps
          : event.startStep,
      });
      void source.ended.then(() => {
        if (this.pendingSources.get(event.key)?.source === source) {
          this.pendingSources.delete(event.key);
        }
      });
    }
  }

  private finishArrangement(): void {
    this.clearSchedulerTimer();
    this.scheduledHorizonAudioTime = undefined;
    this.positionStep = this.projectArrangementEndStep;
    this.status = "stopped";
  }

  private enterBlockedState(): void {
    this.positionStep = this.currentPositionStep();
    this.cancelPlayback();
    this.status = "blocked";
  }

  private enterNonRunningContextState(): "blocked" | "closed" {
    if (this.context?.state === "closed") {
      this.closeEngine(false);
      return "closed";
    }
    this.enterBlockedState();
    return "blocked";
  }

  private pruneEventTombstones(currentStep: number): void {
    for (const [eventKey, { endStep }] of this.eventTombstones) {
      if (endStep < currentStep) {
        this.eventTombstones.delete(eventKey);
      }
    }
  }

  private schedulerTick(): void {
    if (this.status !== "playing" || this.context === undefined || this.project === undefined) {
      return;
    }
    if (this.context.state !== "running") {
      this.enterNonRunningContextState();
      return;
    }

    let currentStep = this.positionStep;
    try {
      const currentAudioTime = this.context.currentTime;
      currentStep = this.currentPositionStep();
      this.positionStep = currentStep;
      this.pruneEventTombstones(currentStep);
      if (currentStep >= this.projectArrangementEndStep) {
        this.finishArrangement();
        return;
      }

      const endStep = positionAtAudioTime(
        this.anchorStep,
        this.anchorAudioTime,
        currentAudioTime + SCHEDULER_LOOKAHEAD_SECONDS,
        this.project.bpm,
      );
      if (
        this.scheduledHorizonAudioTime !== undefined &&
        currentAudioTime > this.scheduledHorizonAudioTime
      ) {
        this.lateWakeups += 1;
        this.lastIssue = {
          code: "late_scheduler",
          message: "Scheduler woke after its look-ahead horizon",
        };
        this.stopPendingSources(currentAudioTime);
        this.generation += 1;
        this.scheduleRange(currentStep, endStep);
        this.scheduledHorizonAudioTime = currentAudioTime + SCHEDULER_LOOKAHEAD_SECONDS;
        return;
      }

      this.scheduleRange(currentStep, endStep);
      this.scheduledHorizonAudioTime = Math.max(
        this.scheduledHorizonAudioTime ?? 0,
        currentAudioTime + SCHEDULER_LOOKAHEAD_SECONDS,
      );
    } catch (error) {
      this.positionStep = currentStep;
      this.cancelPlayback();
      this.status = "stopped";
      throw error;
    }
  }

  private startPlayback(requestedStep: number): void {
    if (this.context === undefined || this.project === undefined) {
      throw new Error("Audio engine runtime did not initialize");
    }
    this.cancelPlayback();
    this.positionStep = this.clampStep(requestedStep);
    this.anchorStep = this.positionStep;
    this.anchorAudioTime = this.context.currentTime + PLAYBACK_START_LEAD_SECONDS;
    this.generation += 1;
    this.status = "playing";
    try {
      this.scheduleRange(
        this.positionStep,
        this.positionStep + SCHEDULER_LOOKAHEAD_SECONDS / secondsPerStep(this.project.bpm),
      );
      this.scheduledHorizonAudioTime = this.anchorAudioTime + SCHEDULER_LOOKAHEAD_SECONDS;
      this.schedulerTimer = {
        handle: this.platform.setInterval(() => this.schedulerTick(), SCHEDULER_TICK_MILLISECONDS),
      };
    } catch (error) {
      this.cancelPlayback();
      this.status = "stopped";
      throw error;
    }
  }

  private controlSuccess(
    successStatus: "playing" | "paused" | "stopped",
  ): AudioControlResult {
    return {
      ok: true,
      status: successStatus,
      positionStep: this.currentPositionStep(),
    };
  }

  private currentControlResult(): AudioControlResult {
    if (this.status === "closed") {
      return closedResult();
    }
    if (this.status === "blocked") {
      return blockedResult();
    }
    return this.controlSuccess(this.status);
  }

  prepare(): Promise<PrepareResult> {
    if (this.status === "closed") {
      return Promise.resolve(closedResult());
    }
    if (this.preparation !== undefined) {
      return this.preparation;
    }

    this.initializeRuntime();
    const runtimeContext = this.context;
    const runtimeSampler = this.sampler;
    if (runtimeContext === undefined || runtimeSampler === undefined) {
      throw new Error("Audio engine runtime did not initialize");
    }

    const pending: Promise<PrepareResult> = (async (): Promise<PrepareResult> => {
      try {
        await runtimeContext.resume();
      } catch (error) {
        if (this.disposal !== undefined) {
          return closedResult();
        }
        if (runtimeContext.state === "closed") {
          this.closeEngine(false);
          return closedResult();
        }
        if (!isAutoplayPolicyError(error)) {
          throw error;
        }
        this.enterBlockedState();
        return blockedResult();
      }
      if (this.disposal !== undefined) {
        return closedResult();
      }
      if (runtimeContext.state !== "running") {
        return this.enterNonRunningContextState() === "closed"
          ? closedResult()
          : blockedResult();
      }

      const samplePreparation = await runtimeSampler.prepare();
      if (this.disposal !== undefined) {
        return closedResult();
      }
      if (runtimeContext.state !== "running") {
        return this.enterNonRunningContextState() === "closed"
          ? closedResult()
          : blockedResult();
      }
      this.unavailableSoundIds = [...samplePreparation.unavailableSoundIds];
      this.lastIssue = this.unavailableSoundIds[0] === undefined
        ? undefined
        : {
          code: "missing_sample",
          message: "Drum sample is unavailable",
          relatedId: this.unavailableSoundIds[0],
        };
      if (this.status === "blocked") {
        this.status = "stopped";
      }
      this.synchronizeMixer();
      return {
        ok: true,
        status: this.unavailableSoundIds.length === 0 ? "ready" : "degraded",
        unavailableSoundIds: [...this.unavailableSoundIds],
      };
    })().finally(() => {
      if (this.preparation === pending) {
        this.preparation = undefined;
      }
    });
    this.preparation = pending;
    return pending;
  }

  replaceProject(nextProject: Project): void {
    if (this.status === "closed") {
      return;
    }
    const nextFingerprint = playbackFingerprint(nextProject);
    const compositionChanged = nextFingerprint !== this.projectFingerprint;
    const restartStep = this.status === "playing" && compositionChanged
      ? this.currentPositionStep()
      : undefined;
    if (restartStep !== undefined) {
      this.cancelPlayback();
    }
    this.project = nextProject;
    this.projectFingerprint = nextFingerprint;
    this.projectArrangementEndStep = arrangementEndStep(nextProject);
    this.positionStep = this.clampStep(restartStep ?? this.positionStep);
    this.synchronizeMixer();
    if (restartStep === undefined) {
      return;
    }
    if (this.positionStep >= this.projectArrangementEndStep) {
      this.status = "stopped";
      return;
    }
    this.startPlayback(this.positionStep);
  }

  async play(startStep: number): Promise<AudioControlResult> {
    const intentRevision = ++this.playIntentRevision;
    if (this.status === "closed") {
      return closedResult();
    }
    if (this.project === undefined) {
      return {
        ok: false,
        code: "no_project",
        message: "No project is loaded",
      };
    }
    if (this.project.arrangement.length === 0) {
      return {
        ok: false,
        code: "nothing_to_play",
        message: "Project arrangement is empty",
      };
    }

    const prepared = await this.prepare();
    if (intentRevision !== this.playIntentRevision) {
      return this.currentControlResult();
    }
    if (!prepared.ok) {
      return prepared;
    }
    if (this.project.arrangement.length === 0) {
      return {
        ok: false,
        code: "nothing_to_play",
        message: "Project arrangement is empty",
      };
    }
    this.startPlayback(startStep);
    return this.controlSuccess("playing");
  }

  pause(): AudioControlResult {
    this.playIntentRevision += 1;
    if (this.status === "closed") {
      return closedResult();
    }
    if (this.status === "blocked") {
      return blockedResult();
    }
    if (this.status !== "playing") {
      return this.controlSuccess(this.status);
    }
    this.positionStep = this.currentPositionStep();
    this.cancelPlayback();
    this.status = "paused";
    return this.controlSuccess("paused");
  }

  seek(step: number): AudioControlResult {
    this.playIntentRevision += 1;
    if (this.status === "closed") {
      return closedResult();
    }
    if (this.status === "blocked") {
      return blockedResult();
    }
    const wasPlaying = this.status === "playing";
    this.positionStep = this.clampStep(step);
    if (wasPlaying) {
      this.startPlayback(this.positionStep);
    }
    return this.controlSuccess(wasPlaying ? "playing" : this.status);
  }

  stop(): AudioControlResult {
    this.playIntentRevision += 1;
    if (this.status === "closed") {
      return closedResult();
    }
    if (this.status === "stopped" && this.positionStep === 0 && this.pendingSources.size === 0) {
      return this.controlSuccess("stopped");
    }
    this.cancelPlayback();
    this.positionStep = 0;
    this.status = "stopped";
    return this.controlSuccess("stopped");
  }

  getSnapshot(): AudioEngineSnapshot {
    const issue = this.lastIssue === undefined ? undefined : { ...this.lastIssue };
    const trackLevels: Record<string, number> = {};
    for (const [trackId, bus] of this.trackBuses) trackLevels[trackId] = this.readMeter(bus.analyser);
    return {
      status: this.status,
      positionStep: this.currentPositionStep(),
      arrangementEndStep: this.projectArrangementEndStep,
      unavailableSoundIds: [...this.unavailableSoundIds],
      activeVoices: this.synth?.activeVoiceCount() ?? 0,
      pendingSources: this.pendingSources.size,
      lateWakeups: this.lateWakeups,
      trackBusCount: this.trackBuses.size,
      trackLevels,
      masterLevel: this.masterAnalyser === undefined ? 0 : this.readMeter(this.masterAnalyser),
      ...(issue === undefined ? {} : { lastIssue: issue }),
    };
  }

  private readMeter(analyser: AnalyserNode): number {
    if (this.status !== "playing") return 0;
    analyser.getFloatTimeDomainData(this.meterSamples);
    let peak = 0;
    for (const sample of this.meterSamples) peak = Math.max(peak, Math.abs(sample));
    if (peak <= 10 ** (METER_FLOOR_DB / 20)) return 0;
    return Math.min(1, (20 * Math.log10(peak) - METER_FLOOR_DB) / -METER_FLOOR_DB);
  }

  dispose(): Promise<void> {
    if (this.disposal !== undefined) {
      return this.disposal;
    }
    return this.closeEngine(true);
  }
}
