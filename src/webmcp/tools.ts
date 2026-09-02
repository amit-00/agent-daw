import { SOUND_CATALOG } from "@/audio/catalog";
import { getTrackColor, INSTRUMENT_NAMES, TRACK_COLOR_WHEEL } from "@/data/studio-data";
import {
  PROJECT_CAPS,
  ProjectValidationError,
  validateOperations,
  type ChangeSummary,
  type DispatchResult,
  type HistoryAction,
  type HistoryEntry,
  type DrumHit,
  type Operation,
  type Pattern,
  type Project,
  type SynthNote,
  type Track,
} from "@/project";
import type { StudioState } from "@/stores/studio-store";
import type { StoreApi } from "zustand/vanilla";

import {
  TOOL_CONTRACTS,
  type EntityReference,
  type ToolContract,
  type ToolErrorCode,
  type ToolResult,
  type WebMCPTool,
  type WebMCPToolName,
} from "./contracts.ts";

class InputError extends Error {
  constructor(readonly field: string, message: string) {
    super(message);
    this.name = "InputError";
  }
}

class ToolExecutionError extends Error {
  constructor(
    readonly code: ToolErrorCode,
    readonly field: string,
    message: string,
    readonly currentRevision?: number,
  ) {
    super(message);
    this.name = "ToolExecutionError";
  }
}

const invalid = (field: string, expectation: string): never => {
  throw new InputError(field, `${field} ${expectation}.`);
};

export const expectObject = (value: unknown, field: string): Readonly<Record<string, unknown>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(field, "must be an object");
  }
  return value as Readonly<Record<string, unknown>>;
};

export const expectAllowedKeys = (
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  field: string,
): void => {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected !== undefined) invalid(field === "$" ? unexpected : `${field}.${unexpected}`, "is not allowed");
};

export const expectString = (
  value: unknown,
  field: string,
  minimumLength = 1,
  maximumLength?: number,
): string => {
  if (typeof value !== "string") return invalid(field, "must be a string");
  const length = value.trim().length;
  if (length < minimumLength || (maximumLength !== undefined && length > maximumLength)) {
    return invalid(field, maximumLength === undefined
      ? `must contain at least ${minimumLength} non-whitespace character${minimumLength === 1 ? "" : "s"}`
      : `must contain ${minimumLength} to ${maximumLength} non-whitespace characters`);
  }
  return value;
};

export const expectBoolean = (value: unknown, field: string): boolean => {
  if (typeof value !== "boolean") return invalid(field, "must be a boolean");
  return value;
};

export const expectFiniteNumber = (
  value: unknown,
  field: string,
  minimum?: number,
  maximum?: number,
): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return invalid(field, "must be a finite number");
  if ((minimum !== undefined && value < minimum) || (maximum !== undefined && value > maximum)) {
    return invalid(field, `must be from ${minimum ?? "negative infinity"} to ${maximum ?? "infinity"}`);
  }
  return value;
};

export const expectInteger = (
  value: unknown,
  field: string,
  minimum?: number,
  maximum?: number,
): number => {
  const number = expectFiniteNumber(value, field, minimum, maximum);
  if (!Number.isInteger(number)) return invalid(field, "must be an integer");
  return number;
};

export const expectArray = (value: unknown, field: string): readonly unknown[] => {
  if (!Array.isArray(value)) return invalid(field, "must be an array");
  return value;
};

export const expectEnum = <T extends string | number>(
  value: unknown,
  field: string,
  values: readonly T[],
): T => {
  const matched = values.find((candidate) => candidate === value);
  if (matched === undefined) return invalid(field, `must be one of ${values.join(", ")}`);
  return matched;
};

export const expectEntityReference = (value: unknown, field: string): EntityReference => {
  const reference = expectObject(value, field);
  expectAllowedKeys(reference, ["id", "ref"], field);
  const hasId = Object.hasOwn(reference, "id");
  const hasRef = Object.hasOwn(reference, "ref");
  if (hasId === hasRef) return invalid(field, "must contain exactly one of id or ref");
  if (hasId) return { id: expectString(reference.id, `${field}.id`) };
  const ref = expectString(reference.ref, `${field}.ref`, 1, 64);
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(ref)) {
    return invalid(`${field}.ref`, "must start with a letter and contain only letters, digits, underscores, or hyphens");
  }
  return { ref };
};

type ToolFailure = Extract<ToolResult<never>, { readonly success: false }>;

const failure = (
  code: ToolErrorCode,
  message: string,
  retryable: boolean,
  field?: string,
  currentRevision?: number,
): ToolFailure => ({
  success: false, error: {
    code, message, retryable,
    ...(field === undefined ? {} : { field }),
    ...(currentRevision === undefined ? {} : { current_revision: currentRevision }),
  },
});

const publicValidationField = (toolName: WebMCPToolName, field: string): string | undefined => {
  switch (toolName) {
    case "reorder_track":
      return field === "to_index" ? "position" : field;
    case "set_master_volume":
      return field === "master_volume_db" ? "volume_db" : field;
    case "create_pattern":
      if (field === "track_id" || field === "start_bar" || field === "repeat_count") return `placement.${field}`;
      return ["kind", "name", "length_bars"].includes(field) ? field : undefined;
    case "rename_pattern":
      return ["pattern_id", "name"].includes(field) ? field : undefined;
    case "resize_pattern":
      if (field === "pattern_id") return field;
      return ["length_bars", "start_bar", "repeat_count"].includes(field) ? "length_bars" : undefined;
    case "duplicate_pattern":
      if (field === "duplicate_name") return "name";
      return field === "pattern_id" ? field : undefined;
    case "delete_pattern":
      return field === "pattern_id" ? field : undefined;
    case "place_pattern":
      return ["pattern_id", "track_id", "start_bar", "repeat_count"].includes(field) ? field : undefined;
    case "move_clip":
      if (field === "repeat_count") return "start_bar";
      return ["clip_id", "track_id", "start_bar"].includes(field) ? field : undefined;
    case "change_clip_pattern":
      if (["pattern_id", "track_id", "start_bar", "repeat_count"].includes(field)) return "pattern_id";
      return field === "clip_id" ? field : undefined;
    case "set_clip_repeats":
      if (field === "start_bar") return "repeat_count";
      return ["clip_id", "repeat_count"].includes(field) ? field : undefined;
    case "duplicate_clip":
      return undefined;
    case "make_clip_unique":
      if (field === "duplicate_name") return "pattern_name";
      return field === "clip_id" ? field : undefined;
    case "delete_clip":
      return field === "clip_id" ? field : undefined;
    default:
      return field;
  }
};

const mapKnownError = (toolName: WebMCPToolName, error: unknown): ToolFailure => {
  if (error instanceof InputError) return failure("INVALID_INPUT", error.message, false, error.field);
  if (error instanceof ToolExecutionError) {
    return failure(error.code, error.message, false, error.field, error.currentRevision);
  }
  if (error instanceof ProjectValidationError) {
    const field = publicValidationField(toolName, error.field);
    const message = field === undefined || field === error.field
      ? error.message
      : error.message.replace(error.field, field);
    return failure(error.code, message, false, field);
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return failure("EXECUTION_CANCELLED", "The tool call was cancelled.", true);
  }
  console.error("WebMCP tool failed", toolName, error instanceof Error ? error : new Error("Non-Error thrown"));
  return failure("INTERNAL_ERROR", "The tool could not complete because of an internal error.", false);
};

async function executeSafely<T>(
  toolName: WebMCPToolName,
  signal: AbortSignal,
  run: () => T | Promise<T>,
): Promise<ToolResult<T>> {
  const startedAt = performance.now();
  try {
    if (signal.aborted) {
      return failure("EXECUTION_CANCELLED", "The tool call was cancelled.", true);
    }
    const result = await run();
    console.debug("WebMCP tool", {
      toolName,
      outcome: "success",
      elapsedMs: Math.round(performance.now() - startedAt),
    });
    return { success: true, result };
  } catch (error) {
    const result = mapKnownError(toolName, error);
    console.debug("WebMCP tool", {
      toolName,
      outcome: result.error.code,
      elapsedMs: Math.round(performance.now() - startedAt),
    });
    return result;
  }
}

export function defineWebMCPTool<T>(
  contract: ToolContract,
  parse: (input: Readonly<Record<string, unknown>>) => T,
  run: (input: T, signal: AbortSignal) => unknown | Promise<unknown>,
): WebMCPTool {
  const schemaProperties = expectObject(contract.inputSchema.properties, "inputSchema.properties");
  const allowedKeys = Object.keys(schemaProperties);
  return {
    ...contract,
    execute: (input, { signal }) => executeSafely(contract.name, signal, () => {
      const object = expectObject(input, "$");
      expectAllowedKeys(object, allowedKeys, "$");
      return run(parse(object), signal);
    }),
  };
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

interface Cursor {
  readonly revision: number;
  readonly view: string;
  readonly offset: number;
}

function toolError(code: ToolErrorCode, field: string, message: string, currentRevision?: number): never {
  throw new ToolExecutionError(code, field, message, currentRevision);
}

const optionalString = (input: Readonly<Record<string, unknown>>, field: string): string | undefined =>
  input[field] === undefined ? undefined : expectString(input[field], field);

const optionalInteger = (
  input: Readonly<Record<string, unknown>>,
  field: string,
  minimum: number,
  maximum?: number,
): number | undefined => input[field] === undefined
  ? undefined
  : expectInteger(input[field], field, minimum, maximum);

const optionalEnum = <T extends string>(
  input: Readonly<Record<string, unknown>>,
  field: string,
  values: readonly T[],
): T | undefined => input[field] === undefined ? undefined : expectEnum(input[field], field, values);

const optionalIds = (input: Readonly<Record<string, unknown>>, field: string): readonly string[] | undefined => {
  if (input[field] === undefined) return undefined;
  const ids = expectArray(input[field], field).map((id, index) => expectString(id, `${field}.${index}`));
  if (ids.length < 1 || ids.length > 16) invalid(field, "must contain 1 to 16 items");
  if (new Set(ids).size !== ids.length) invalid(field, "must contain unique items");
  return ids;
};

const decodeCursor = (value: string | undefined, revision: number, view: string): number => {
  if (value === undefined) return 0;
  if (value.length > 256) toolError("INVALID_CURSOR", "cursor", "The cursor is invalid.");
  try {
    const decoded = JSON.parse(atob(value)) as unknown;
    const cursor = expectObject(decoded, "cursor");
    const keys = Object.keys(cursor).sort();
    if (
      keys.join(",") !== "offset,revision,view"
      || !Number.isInteger(cursor.revision)
      || typeof cursor.view !== "string"
      || !Number.isInteger(cursor.offset)
      || (cursor.offset as number) < 0
      || cursor.revision !== revision
      || cursor.view !== view
    ) toolError("INVALID_CURSOR", "cursor", "The cursor is invalid or stale.");
    return cursor.offset as number;
  } catch (error) {
    if (error instanceof ToolExecutionError) throw error;
    return toolError("INVALID_CURSOR", "cursor", "The cursor is invalid.");
  }
};

const page = <T>(
  items: readonly T[],
  revision: number,
  view: string,
  cursor: string | undefined,
  limit: number,
): { readonly project_revision: number; readonly items: readonly T[]; readonly next_cursor?: string } => {
  const offset = decodeCursor(cursor, revision, view);
  const selected = items.slice(offset, offset + limit);
  const nextOffset = offset + selected.length;
  return {
    project_revision: revision,
    items: selected,
    ...(nextOffset < items.length
      ? { next_cursor: btoa(JSON.stringify({ revision, view, offset: nextOffset } satisfies Cursor)) }
      : {}),
  };
};

const projectMetadata = (project: Project) => ({
  id: project.id,
  name: project.name,
  bpm: project.bpm,
  master_volume_db: project.masterVolumeDb,
});

const publicTrack = (track: Track) => ({
  id: track.id,
  name: track.name,
  kind: track.kind,
  instrument_id: track.instrumentId,
  volume_db: track.volumeDb,
  pan: track.pan,
  muted: track.muted,
  soloed: track.soloed,
  color: getTrackColor(track),
});

const patternHeader = (pattern: Pattern, project?: Project) => ({
  id: pattern.id,
  name: pattern.name,
  kind: pattern.kind,
  length_bars: pattern.lengthBars,
  event_count: pattern.events.length,
  ...(project === undefined
    ? {}
    : { placement_count: project.arrangement.filter(({ patternId }) => patternId === pattern.id).length }),
});

const publicEvent = (event: DrumHit | SynthNote) => "soundId" in event
  ? { id: event.id, sound_id: event.soundId, step: event.startStep + 1 }
  : {
      id: event.id,
      midi_note: event.midiNote,
      start_step: event.startStep + 1,
      length_steps: event.lengthSteps,
    };

const publicClip = (project: Project, clip: Project["arrangement"][number]) => {
  const pattern = project.patterns.find(({ id }) => id === clip.patternId)!;
  return {
    id: clip.id,
    track_id: clip.trackId,
    pattern_id: clip.patternId,
    pattern_name: pattern.name,
    pattern_kind: pattern.kind,
    pattern_length_bars: pattern.lengthBars,
    start_bar: clip.startBar + 1,
    repeat_count: clip.repeatCount,
  };
};

const publicChanges = (changes: ChangeSummary) => {
  const category = (ids: ChangeSummary["created"]) => Object.fromEntries([
    ["project_ids", ids.projectIds],
    ["track_ids", ids.trackIds],
    ["pattern_ids", ids.patternIds],
    ["drum_hit_ids", ids.drumHitIds],
    ["synth_note_ids", ids.synthNoteIds],
    ["arrangement_clip_ids", ids.arrangementClipIds],
  ].filter(([, values]) => (values as readonly string[]).length > 0)
    .map(([key, values]) => [key, [...values as readonly string[]]]));
  return {
    created: category(changes.created),
    updated: category(changes.updated),
    deleted: category(changes.deleted),
  };
};

const snakeCase = (key: string): string => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

const normalizeOperation = (operation: Operation): unknown => {
  const drumSteps = operation.type.startsWith("drum-hits.")
    || (operation.type === "pattern.create" && operation.pattern.kind === "drum");
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (typeof value !== "object" || value === null) return value;
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => {
      if (key === "startBar") return ["start_bar", (nested as number) + 1];
      if (key === "startStep") return [drumSteps ? "step" : "start_step", (nested as number) + 1];
      if (key === "toIndex") return ["position", (nested as number) + 1];
      return [snakeCase(key), visit(nested)];
    }));
  };
  return visit(operation);
};

const normalizeAction = (action: HistoryAction) => action.kind === "restore"
  ? { type: "restore_history", history_entry_id: action.targetEntryId }
  : {
      kind: action.kind,
      operations: (action.kind === "operation" ? [action.operation] : action.operations).map(normalizeOperation),
    };

const affectedEntities = (project: Project, ids: ChangeSummary["created"]) => {
  const findEvents = (eventIds: readonly string[], kind: Pattern["kind"]) => project.patterns
    .filter((pattern) => pattern.kind === kind)
    .flatMap((pattern) => pattern.events
      .filter(({ id }) => eventIds.includes(id))
      .map((event) => ({ pattern_id: pattern.id, ...publicEvent(event) })));
  const result = {
    ...(ids.projectIds.includes(project.id) ? { project: projectMetadata(project) } : {}),
    ...(ids.trackIds.length > 0
      ? { tracks: project.tracks.filter(({ id }) => ids.trackIds.includes(id)).map(publicTrack) }
      : {}),
    ...(ids.patternIds.length > 0
      ? { patterns: project.patterns.filter(({ id }) => ids.patternIds.includes(id)).map((pattern) => patternHeader(pattern)) }
      : {}),
    ...(ids.drumHitIds.length > 0 ? { drum_hits: findEvents(ids.drumHitIds, "drum") } : {}),
    ...(ids.synthNoteIds.length > 0 ? { synth_notes: findEvents(ids.synthNoteIds, "synth") } : {}),
    ...(ids.arrangementClipIds.length > 0
      ? { arrangement_clips: project.arrangement
        .filter(({ id }) => ids.arrangementClipIds.includes(id))
        .map((clip) => publicClip(project, clip)) }
      : {}),
  };
  return result;
};

const historySummary = (entry: HistoryEntry, index: number, historyCursor: number) => ({
  id: entry.id,
  source: entry.source,
  ...(entry.toolName === undefined ? {} : { tool_name: entry.toolName }),
  label: entry.label,
  created_at: entry.createdAt,
  state: index > historyCursor ? "undone" : index === historyCursor ? "current" : "applied",
  changes: publicChanges(entry.changes),
});

const historyDetail = (entry: HistoryEntry, index: number, historyCursor: number) => ({
  ...historySummary(entry, index, historyCursor),
  action: normalizeAction(entry.action),
  affected: {
    created: affectedEntities(entry.after, entry.changes.created),
    updated: affectedEntities(entry.after, entry.changes.updated),
    deleted: affectedEntities(entry.before, entry.changes.deleted),
  },
});

const contract = (name: WebMCPToolName): ToolContract =>
  TOOL_CONTRACTS.find((candidate) => candidate.name === name)!;

const parseProjectInput = (input: Readonly<Record<string, unknown>>) => ({
  view: expectEnum(input.view, "view", ["overview", "tracks", "patterns", "pattern", "arrangement"] as const),
  trackIds: optionalIds(input, "track_ids"),
  patternId: optionalString(input, "pattern_id"),
  kind: optionalEnum(input, "kind", ["drum", "synth"] as const),
  startBar: optionalInteger(input, "start_bar", 1),
  endBar: optionalInteger(input, "end_bar", 1),
  cursor: optionalString(input, "cursor"),
  limit: optionalInteger(input, "limit", 1, MAX_LIMIT) ?? DEFAULT_LIMIT,
});

const getProject = (
  state: StudioState,
  input: ReturnType<typeof parseProjectInput>,
) => {
  const { project, revision } = state;
  if (input.startBar !== undefined && input.endBar !== undefined && input.startBar > input.endBar) {
    invalid("end_bar", "must be greater than or equal to start_bar");
  }
  switch (input.view) {
    case "overview":
      return page([{
        ...projectMetadata(project),
        caps: PROJECT_CAPS,
        history_cursor: state.historyCursor,
        history_count: state.history.length,
        counts: {
          tracks: project.tracks.length,
          patterns: project.patterns.length,
          events: project.patterns.reduce((total, pattern) => total + pattern.events.length, 0),
          arrangement_clips: project.arrangement.length,
        },
      }], revision, "get_project:overview", input.cursor, input.limit);
    case "tracks": {
      const tracks = input.trackIds === undefined
        ? project.tracks
        : project.tracks.filter(({ id }) => input.trackIds!.includes(id));
      return page(tracks.map(publicTrack), revision, "get_project:tracks", input.cursor, input.limit);
    }
    case "patterns": {
      const patterns = input.kind === undefined
        ? project.patterns
        : project.patterns.filter(({ kind }) => kind === input.kind);
      return page(
        patterns.map((pattern) => patternHeader(pattern, project)),
        revision,
        "get_project:patterns",
        input.cursor,
        input.limit,
      );
    }
    case "pattern": {
      if (input.patternId === undefined) invalid("pattern_id", "is required for the pattern view");
      const pattern = project.patterns.find(({ id }) => id === input.patternId);
      if (pattern === undefined) toolError("PATTERN_NOT_FOUND", "pattern_id", `Pattern ${input.patternId} was not found.`);
      return {
        ...page(
          pattern.events.map(publicEvent),
          revision,
          "get_project:pattern",
          input.cursor,
          input.limit,
        ),
        pattern: patternHeader(pattern),
      };
    }
    case "arrangement": {
      const trackOrder = new Map(project.tracks.map(({ id }, index) => [id, index]));
      const patternById = new Map(project.patterns.map((pattern) => [pattern.id, pattern]));
      const clips = project.arrangement
        .map((clip, index) => ({ clip, index, pattern: patternById.get(clip.patternId)! }))
        .filter(({ clip, pattern }) => {
          const firstBar = clip.startBar + 1;
          const lastBar = clip.startBar + pattern.lengthBars * clip.repeatCount;
          return (input.trackIds === undefined || input.trackIds.includes(clip.trackId))
            && (input.startBar === undefined || lastBar >= input.startBar)
            && (input.endBar === undefined || firstBar <= input.endBar);
        })
        .sort((left, right) => (trackOrder.get(left.clip.trackId)! - trackOrder.get(right.clip.trackId)!)
          || left.clip.startBar - right.clip.startBar
          || left.index - right.index)
        .map(({ clip }) => publicClip(project, clip));
      return page(clips, revision, "get_project:arrangement", input.cursor, input.limit);
    }
  }
};

const parseHistoryInput = (input: Readonly<Record<string, unknown>>) => ({
  view: expectEnum(input.view, "view", ["list", "entry"] as const),
  historyEntryId: optionalString(input, "history_entry_id"),
  cursor: optionalString(input, "cursor"),
  limit: optionalInteger(input, "limit", 1, MAX_LIMIT) ?? DEFAULT_LIMIT,
});

const parseMutationMetadata = (input: Readonly<Record<string, unknown>>) => ({
  requestId: expectString(input.request_id, "request_id", 1, 128),
  baseRevision: optionalInteger(input, "base_revision", 0),
});

const parseTrackId = (input: Readonly<Record<string, unknown>>) => ({
  ...parseMutationMetadata(input),
  trackId: expectString(input.track_id, "track_id"),
});

const parsePatternId = (input: Readonly<Record<string, unknown>>) => ({
  ...parseMutationMetadata(input),
  patternId: expectString(input.pattern_id, "pattern_id"),
});

const parseClipId = (input: Readonly<Record<string, unknown>>) => ({
  ...parseMutationMetadata(input),
  clipId: expectString(input.clip_id, "clip_id"),
});

const mutationResult = (
  state: StudioState,
  result: DispatchResult,
  extra: Readonly<Record<string, unknown>> = {},
) => ({
  changed: result.changed,
  deduplicated: result.deduplicated,
  project_revision: state.revision,
  ...(result.historyEntry === undefined ? {} : { history_entry_id: result.historyEntry.id }),
  history_cursor: state.historyCursor,
  changes: publicChanges(result.changes),
  ...extra,
});

const defineMutationTool = <T>(
  toolContract: ToolContract,
  store: Pick<StoreApi<StudioState>, "getState">,
  parse: (input: Readonly<Record<string, unknown>>) => T,
  run: (input: T, signal: AbortSignal) => unknown | Promise<unknown>,
  extras: (result: DispatchResult) => Readonly<Record<string, unknown>> = () => ({}),
): WebMCPTool => {
  const schemaProperties = expectObject(toolContract.inputSchema.properties, "inputSchema.properties");
  const allowedKeys = Object.keys(schemaProperties);
  return {
    ...toolContract,
    execute: (input, { signal }) => executeSafely(toolContract.name, signal, () => {
      const object = expectObject(input, "$");
      const requestId = expectString(object.request_id, "request_id", 1, 128);
      const replayed = store.getState().replayDispatch(`webmcp:${toolContract.name}:${requestId}`);
      if (replayed !== null) return mutationResult(store.getState(), replayed, extras(replayed));
      expectAllowedKeys(object, allowedKeys, "$");
      return run(parse(object), signal);
    }),
  };
};

const runDirectMutation = (
  store: Pick<StoreApi<StudioState>, "getState">,
  toolName: WebMCPToolName,
  input: ReturnType<typeof parseMutationMetadata>,
  signal: AbortSignal,
  build: (project: Project) => readonly Operation[],
  extras: (result: DispatchResult) => Readonly<Record<string, unknown>> = () => ({}),
) => {
  signal.throwIfAborted();
  const commandId = `webmcp:${toolName}:${input.requestId}`;
  let state = store.getState();
  if (input.baseRevision !== undefined && input.baseRevision !== state.revision) {
    toolError("REVISION_CONFLICT", "base_revision", "The project has changed; inspect it and retry.", state.revision);
  }
  const operations = build(state.project);
  validateOperations(state.project, operations, SOUND_CATALOG);
  const result = state.dispatch(operations.length === 1
    ? {
        id: commandId, source: "agent", toolName, label: contract(toolName).title,
        kind: "operation", operation: operations[0]!,
      }
    : { id: commandId, source: "agent", toolName, label: contract(toolName).title, kind: "batch", operations });
  state = store.getState();
  return mutationResult(state, result, extras(result));
};

const projectUpdate = (
  store: Pick<StoreApi<StudioState>, "getState">,
  toolName: "rename_project" | "set_tempo" | "set_master_volume",
  input: ReturnType<typeof parseMutationMetadata>,
  signal: AbortSignal,
  changes: Extract<Operation, { type: "project.update" }>["changes"],
) => runDirectMutation(store, toolName, input, signal, () => [{ type: "project.update", changes }]);

const trackUpdate = (
  store: Pick<StoreApi<StudioState>, "getState">,
  toolName: "rename_track" | "set_track_instrument" | "set_track_mix" | "set_track_mute" | "set_track_solo",
  input: ReturnType<typeof parseTrackId>,
  signal: AbortSignal,
  changes: Extract<Operation, { type: "track.update" }>["changes"],
) => runDirectMutation(store, toolName, input, signal,
  () => [{ type: "track.update", trackId: input.trackId, changes }]);

export function createWebMCPTools(
  store: Pick<StoreApi<StudioState>, "getState">,
  createId: () => string,
): readonly WebMCPTool[] {
  return [
    defineWebMCPTool(contract("get_project"), parseProjectInput, (input) => getProject(store.getState(), input)),
    defineWebMCPTool(
      contract("get_sound_catalog"),
      (input) => ({ kind: optionalEnum(input, "kind", ["drum", "synth"] as const) }),
      ({ kind }) => {
        const state = store.getState();
        const drumKits = kind === "synth" ? [] : SOUND_CATALOG.drumKits.map(({ id, soundIds }) => ({
          kind: "drum" as const, id, sound_ids: [...soundIds],
        }));
        const synthPresets = kind === "drum" ? [] : SOUND_CATALOG.synthPresets.map(({ id }) => ({
          kind: "synth" as const, id,
        }));
        return page([...drumKits, ...synthPresets], state.revision, "get_sound_catalog", undefined, MAX_LIMIT);
      },
    ),
    defineWebMCPTool(contract("get_history"), parseHistoryInput, (input) => {
      const state = store.getState();
      if (input.view === "list") {
        const items = state.history
          .map((entry, index) => historySummary(entry, index, state.historyCursor))
          .reverse();
        return page(items, state.revision, "get_history:list", input.cursor, input.limit);
      }
      if (input.historyEntryId === undefined) invalid("history_entry_id", "is required for the entry view");
      const index = state.history.findIndex(({ id }) => id === input.historyEntryId);
      const entry = state.history[index];
      if (entry === undefined) {
        toolError("HISTORY_ENTRY_NOT_FOUND", "history_entry_id", `History entry ${input.historyEntryId} was not found.`);
      }
      return page(
        [historyDetail(entry, index, state.historyCursor)],
        state.revision,
        "get_history:entry",
        input.cursor,
        input.limit,
      );
    }),
    defineMutationTool(
      contract("rename_project"),
      store,
      (input) => ({ ...parseMutationMetadata(input), name: expectString(input.name, "name").trim() }),
      (input, signal) => projectUpdate(store, "rename_project", input, signal, { name: input.name }),
    ),
    defineMutationTool(
      contract("set_tempo"),
      store,
      (input) => ({ ...parseMutationMetadata(input), bpm: expectFiniteNumber(input.bpm, "bpm") }),
      (input, signal) => projectUpdate(store, "set_tempo", input, signal, { bpm: input.bpm }),
    ),
    defineMutationTool(
      contract("set_master_volume"),
      store,
      (input) => ({
        ...parseMutationMetadata(input), volumeDb: expectFiniteNumber(input.volume_db, "volume_db"),
      }),
      (input, signal) => projectUpdate(store, "set_master_volume", input, signal,
        { masterVolumeDb: input.volumeDb }),
    ),
    defineMutationTool(
      contract("create_track"),
      store,
      (input) => ({
        ...parseMutationMetadata(input),
        kind: expectEnum(input.kind, "kind", ["drum", "synth"] as const),
        instrumentId: expectString(input.instrument_id, "instrument_id"),
        name: input.name === undefined ? undefined : expectString(input.name, "name").trim(),
      }),
      (input, signal) => runDirectMutation(store, "create_track", input, signal, (project) => {
        const id = createId();
        const lastTrack = project.tracks.at(-1);
        const colorIndex = lastTrack === undefined
          ? 0
          : (TRACK_COLOR_WHEEL.indexOf(getTrackColor(lastTrack)) + 1) % TRACK_COLOR_WHEEL.length;
        return [{ type: "track.create", track: {
          id, name: input.name ?? INSTRUMENT_NAMES[input.instrumentId] ?? input.instrumentId,
          kind: input.kind, instrumentId: input.instrumentId, volumeDb: 0, pan: 0,
          muted: false, soloed: false, color: TRACK_COLOR_WHEEL[colorIndex]!,
        } }];
      }, (result) => ({ track_id: result.changes.created.trackIds[0] })),
      (result) => ({ track_id: result.changes.created.trackIds[0] }),
    ),
    defineMutationTool(
      contract("rename_track"),
      store,
      (input) => ({ ...parseTrackId(input), name: expectString(input.name, "name").trim() }),
      (input, signal) => trackUpdate(store, "rename_track", input, signal, { name: input.name }),
    ),
    defineMutationTool(
      contract("set_track_instrument"),
      store,
      (input) => ({ ...parseTrackId(input), instrumentId: expectString(input.instrument_id, "instrument_id") }),
      (input, signal) => trackUpdate(store, "set_track_instrument", input, signal,
        { instrumentId: input.instrumentId }),
    ),
    defineMutationTool(
      contract("reorder_track"),
      store,
      (input) => ({ ...parseTrackId(input), position: expectInteger(input.position, "position", 1) }),
      (input, signal) => runDirectMutation(store, "reorder_track", input, signal,
        () => [{ type: "track.reorder", trackId: input.trackId, toIndex: input.position - 1 }]),
    ),
    defineMutationTool(
      contract("set_track_mix"),
      store,
      (input) => {
        const parsed = {
          ...parseTrackId(input),
          volumeDb: input.volume_db === undefined ? undefined : expectFiniteNumber(input.volume_db, "volume_db"),
          pan: input.pan === undefined ? undefined : expectFiniteNumber(input.pan, "pan"),
        };
        if (parsed.volumeDb === undefined && parsed.pan === undefined) invalid("$", "must contain volume_db or pan");
        return parsed;
      },
      (input, signal) => trackUpdate(store, "set_track_mix", input, signal,
        { volumeDb: input.volumeDb, pan: input.pan }),
    ),
    defineMutationTool(
      contract("set_track_mute"),
      store,
      (input) => ({ ...parseTrackId(input), muted: expectBoolean(input.muted, "muted") }),
      (input, signal) => trackUpdate(store, "set_track_mute", input, signal, { muted: input.muted }),
    ),
    defineMutationTool(
      contract("set_track_solo"),
      store,
      (input) => ({ ...parseTrackId(input), soloed: expectBoolean(input.soloed, "soloed") }),
      (input, signal) => trackUpdate(store, "set_track_solo", input, signal, { soloed: input.soloed }),
    ),
    defineMutationTool(
      contract("delete_track"),
      store,
      (input) => ({
        ...parseTrackId(input),
        deleteClips: input.delete_clips === undefined ? false : expectBoolean(input.delete_clips, "delete_clips"),
      }),
      (input, signal) => runDirectMutation(store, "delete_track", input, signal, (project) => {
        const clipIds = project.arrangement.filter(({ trackId }) => trackId === input.trackId).map(({ id }) => id);
        if (!input.deleteClips && clipIds.length > 0) {
          toolError("DEPENDENCIES_EXIST", "delete_clips", `Dependent clip IDs: ${clipIds.join(", ")}.`);
        }
        return [{ type: "track.delete", trackId: input.trackId }];
      }),
    ),
    defineMutationTool(
      contract("create_pattern"),
      store,
      (input) => {
        const placement = input.placement === undefined ? undefined : expectObject(input.placement, "placement");
        if (placement !== undefined) expectAllowedKeys(placement, ["track_id", "start_bar", "repeat_count"], "placement");
        return {
          ...parseMutationMetadata(input),
          kind: expectEnum(input.kind, "kind", ["drum", "synth"] as const),
          name: input.name === undefined ? undefined : expectString(input.name, "name").trim(),
          lengthBars: expectEnum(input.length_bars, "length_bars", [1, 2, 4] as const),
          placement: placement === undefined ? undefined : {
            trackId: expectString(placement.track_id, "placement.track_id"),
            startBar: expectInteger(placement.start_bar, "placement.start_bar", 1) - 1,
            repeatCount: placement.repeat_count === undefined
              ? 1
              : expectInteger(placement.repeat_count, "placement.repeat_count", 1, 64),
          },
        };
      },
      (input, signal) => runDirectMutation(store, "create_pattern", input, signal, () => {
        const pattern: Pattern = {
          id: createId(), name: input.name ?? (input.kind === "drum" ? "New beat" : "New melody"),
          kind: input.kind, lengthBars: input.lengthBars, events: [],
        };
        return input.placement === undefined
          ? [{ type: "pattern.create", pattern }]
          : [
              { type: "pattern.create", pattern },
              { type: "arrangement.place", clip: {
                id: createId(), patternId: pattern.id, trackId: input.placement.trackId,
                startBar: input.placement.startBar, repeatCount: input.placement.repeatCount,
              } },
            ];
      }, (result) => ({
        pattern_id: result.changes.created.patternIds[0],
        ...(result.changes.created.arrangementClipIds[0] === undefined
          ? {}
          : { clip_id: result.changes.created.arrangementClipIds[0] }),
      })),
      (result) => ({
        pattern_id: result.changes.created.patternIds[0],
        ...(result.changes.created.arrangementClipIds[0] === undefined
          ? {}
          : { clip_id: result.changes.created.arrangementClipIds[0] }),
      }),
    ),
    defineMutationTool(
      contract("rename_pattern"),
      store,
      (input) => ({ ...parsePatternId(input), name: expectString(input.name, "name").trim() }),
      (input, signal) => runDirectMutation(store, "rename_pattern", input, signal,
        () => [{ type: "pattern.update", patternId: input.patternId, changes: { name: input.name } }]),
    ),
    defineMutationTool(
      contract("resize_pattern"),
      store,
      (input) => ({
        ...parsePatternId(input),
        lengthBars: expectEnum(input.length_bars, "length_bars", [1, 2, 4] as const),
      }),
      (input, signal) => runDirectMutation(store, "resize_pattern", input, signal,
        () => [{ type: "pattern.update", patternId: input.patternId, changes: { lengthBars: input.lengthBars } }]),
    ),
    defineMutationTool(
      contract("duplicate_pattern"),
      store,
      (input) => ({
        ...parsePatternId(input),
        name: input.name === undefined ? undefined : expectString(input.name, "name").trim(),
      }),
      (input, signal) => runDirectMutation(store, "duplicate_pattern", input, signal, (project) => {
        const duplicatePatternId = createId();
        const pattern = project.patterns.find(({ id }) => id === input.patternId);
        const duplicateEventIds = pattern?.events.map(() => createId()) ?? [];
        return [{
          type: "pattern.duplicate", patternId: input.patternId, duplicatePatternId,
          duplicateName: input.name ?? `${pattern?.name.slice(0, 35) ?? "Pattern"} copy`, duplicateEventIds,
        }];
      }, (result) => ({ pattern_id: result.changes.created.patternIds[0] })),
      (result) => ({ pattern_id: result.changes.created.patternIds[0] }),
    ),
    defineMutationTool(
      contract("delete_pattern"),
      store,
      (input) => ({
        ...parsePatternId(input),
        deleteClips: input.delete_clips === undefined ? false : expectBoolean(input.delete_clips, "delete_clips"),
      }),
      (input, signal) => runDirectMutation(store, "delete_pattern", input, signal, (project) => {
        const clipIds = project.arrangement.filter(({ patternId }) => patternId === input.patternId).map(({ id }) => id);
        if (!input.deleteClips && clipIds.length > 0) {
          toolError("DEPENDENCIES_EXIST", "delete_clips", `Dependent clip IDs: ${clipIds.join(", ")}.`);
        }
        return [{ type: "pattern.delete", patternId: input.patternId }];
      }),
    ),
    defineMutationTool(
      contract("place_pattern"),
      store,
      (input) => ({
        ...parsePatternId(input),
        trackId: expectString(input.track_id, "track_id"),
        startBar: expectInteger(input.start_bar, "start_bar", 1) - 1,
        repeatCount: input.repeat_count === undefined ? 1 : expectInteger(input.repeat_count, "repeat_count", 1, 64),
      }),
      (input, signal) => runDirectMutation(store, "place_pattern", input, signal,
        () => [{ type: "arrangement.place", clip: {
          id: createId(), patternId: input.patternId, trackId: input.trackId,
          startBar: input.startBar, repeatCount: input.repeatCount,
        } }], (result) => ({ clip_id: result.changes.created.arrangementClipIds[0] })),
      (result) => ({ clip_id: result.changes.created.arrangementClipIds[0] }),
    ),
    defineMutationTool(
      contract("move_clip"),
      store,
      (input) => {
        const parsed = {
          ...parseClipId(input),
          trackId: optionalString(input, "track_id"),
          startBar: input.start_bar === undefined ? undefined : expectInteger(input.start_bar, "start_bar", 1) - 1,
        };
        if (parsed.trackId === undefined && parsed.startBar === undefined) {
          invalid("$", "must contain track_id or start_bar");
        }
        return parsed;
      },
      (input, signal) => runDirectMutation(store, "move_clip", input, signal,
        () => [{ type: "arrangement.update", clipId: input.clipId, changes: {
          ...(input.trackId === undefined ? {} : { trackId: input.trackId }),
          ...(input.startBar === undefined ? {} : { startBar: input.startBar }),
        } }]),
    ),
    defineMutationTool(
      contract("change_clip_pattern"),
      store,
      (input) => ({ ...parseClipId(input), patternId: expectString(input.pattern_id, "pattern_id") }),
      (input, signal) => runDirectMutation(store, "change_clip_pattern", input, signal,
        () => [{ type: "arrangement.update", clipId: input.clipId, changes: { patternId: input.patternId } }]),
    ),
    defineMutationTool(
      contract("set_clip_repeats"),
      store,
      (input) => ({ ...parseClipId(input), repeatCount: expectInteger(input.repeat_count, "repeat_count", 1, 64) }),
      (input, signal) => runDirectMutation(store, "set_clip_repeats", input, signal,
        () => [{ type: "arrangement.update", clipId: input.clipId, changes: { repeatCount: input.repeatCount } }]),
    ),
    defineMutationTool(
      contract("duplicate_clip"),
      store,
      parseClipId,
      (input, signal) => runDirectMutation(store, "duplicate_clip", input, signal, (project) => {
        const id = createId();
        const clip = project.arrangement.find((candidate) => candidate.id === input.clipId);
        if (clip === undefined) toolError("CLIP_NOT_FOUND", "clip_id", `Clip ${input.clipId} was not found.`);
        const pattern = project.patterns.find((candidate) => candidate.id === clip.patternId)!;
        return [{ type: "arrangement.place", clip: {
          ...clip, id, startBar: clip.startBar + pattern.lengthBars * clip.repeatCount,
        } }];
      }, (result) => ({ clip_id: result.changes.created.arrangementClipIds[0] })),
      (result) => ({ clip_id: result.changes.created.arrangementClipIds[0] }),
    ),
    defineMutationTool(
      contract("make_clip_unique"),
      store,
      (input) => ({
        ...parseClipId(input),
        name: input.pattern_name === undefined ? undefined : expectString(input.pattern_name, "pattern_name").trim(),
      }),
      (input, signal) => runDirectMutation(store, "make_clip_unique", input, signal, (project) => {
        const duplicatePatternId = createId();
        const clip = project.arrangement.find((candidate) => candidate.id === input.clipId);
        if (clip === undefined) toolError("CLIP_NOT_FOUND", "clip_id", `Clip ${input.clipId} was not found.`);
        const pattern = project.patterns.find((candidate) => candidate.id === clip.patternId)!;
        const duplicateEventIds = pattern.events.map(() => createId());
        return [
          { type: "pattern.duplicate", patternId: pattern.id, duplicatePatternId,
            duplicateName: input.name ?? `${pattern.name.slice(0, 35)} copy`, duplicateEventIds },
          { type: "arrangement.update", clipId: clip.id, changes: { patternId: duplicatePatternId } },
        ];
      }, (result) => ({ pattern_id: result.changes.created.patternIds[0] })),
      (result) => ({ pattern_id: result.changes.created.patternIds[0] }),
    ),
    defineMutationTool(
      contract("delete_clip"),
      store,
      parseClipId,
      (input, signal) => runDirectMutation(store, "delete_clip", input, signal,
        () => [{ type: "arrangement.delete", clipId: input.clipId }]),
    ),
  ];
}
