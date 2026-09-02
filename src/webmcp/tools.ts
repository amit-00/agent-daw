import type { AudioControlResult } from "@/audio";
import { SOUND_CATALOG } from "@/audio/catalog";
import { getTrackColor, INSTRUMENT_NAMES, TRACK_COLOR_WHEEL } from "@/data/studio-data";
import {
  PROJECT_CAPS,
  ProjectValidationError,
  validateOperation,
  validateOperations,
  type ChangeSummary,
  type DispatchResult,
  type HistoryAction,
  type HistoryControlResult,
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
  LOCAL_REFERENCE_PATTERN,
  TOOL_CONTRACTS,
  type EntityReference,
  type PublicChange,
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
    readonly field: string | undefined,
    message: string,
    readonly currentRevision?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ToolExecutionError";
  }
}

class BatchChangeError extends Error {
  constructor(
    readonly changeType: WebMCPToolName,
    readonly changeIndex: number,
    readonly error: unknown,
  ) {
    super("A batch change failed.");
    this.name = "BatchChangeError";
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
  const unexpected = Object.keys(reference).find((key) => !["id", "ref"].includes(key));
  if (unexpected !== undefined) {
    return toolError("INVALID_REFERENCE", `${field}.${unexpected}`, `${field} contains an unsupported reference field.`);
  }
  const hasId = Object.hasOwn(reference, "id");
  const hasRef = Object.hasOwn(reference, "ref");
  if (hasId === hasRef) {
    return toolError("INVALID_REFERENCE", field, `${field} must contain exactly one of id or ref.`);
  }
  if (hasId) {
    if (typeof reference.id !== "string" || reference.id.trim().length === 0) {
      return toolError("INVALID_REFERENCE", `${field}.id`, `${field}.id must be a non-empty string.`);
    }
    return { id: reference.id };
  }
  if (typeof reference.ref !== "string" || !LOCAL_REFERENCE_PATTERN.test(reference.ref)) {
    return toolError(
      "INVALID_REFERENCE",
      `${field}.ref`,
      `${field}.ref must start with a letter and contain only letters, digits, underscores, or hyphens.`,
    );
  }
  return { ref: reference.ref };
};

type ToolFailure = Extract<ToolResult<never>, { readonly success: false }>;

const failure = (
  code: ToolErrorCode,
  message: string,
  retryable: boolean,
  field?: string,
  currentRevision?: number,
  changeIndex?: number,
): ToolFailure => ({
  success: false, error: {
    code, message, retryable,
    ...(field === undefined ? {} : { field }),
    ...(currentRevision === undefined ? {} : { current_revision: currentRevision }),
    ...(changeIndex === undefined ? {} : { change_index: changeIndex }),
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
    case "add_drum_hits": {
      const item = field.match(/^hits\[(\d+)\]\.(sound_id|step)$/);
      if (item !== null) return `hits.${item[1]}.${item[2]}`;
      return ["pattern_id", "hits"].includes(field) ? field : undefined;
    }
    case "delete_drum_hits": {
      const item = field.match(/^hit_ids\[(\d+)\]$/);
      return item === null ? (["pattern_id", "hit_ids"].includes(field) ? field : undefined) : `hit_ids.${item[1]}`;
    }
    case "add_notes": {
      const item = field.match(/^notes\[(\d+)\]\.(midi_note|step|length_steps)$/);
      if (item !== null) return `notes.${item[1]}.${item[2] === "step" ? "start_step" : item[2]}`;
      return ["pattern_id", "notes"].includes(field) ? field : undefined;
    }
    case "edit_notes": {
      const item = field.match(/^updates\[(\d+)\]\.(note_id|changes)$/);
      if (item !== null) return `notes.${item[1]}${item[2] === "note_id" ? ".note_id" : ""}`;
      if (/^events\[\d+\]\.(midi_note|step|length_steps)$/.test(field)) return "notes";
      return field === "pattern_id" ? field : undefined;
    }
    case "duplicate_notes":
      if (/^notes\[\d+\]\.midi_note$/.test(field)) return "pitch_offset";
      if (/^notes\[\d+\]\.(step|length_steps)$/.test(field)) return "step_offset";
      if (field === "notes") return "note_ids";
      return field === "pattern_id" ? field : undefined;
    case "delete_notes": {
      const item = field.match(/^note_ids\[(\d+)\]$/);
      return item === null ? (["pattern_id", "note_ids"].includes(field) ? field : undefined) : `note_ids.${item[1]}`;
    }
    default:
      return field;
  }
};

const mapKnownError = (toolName: WebMCPToolName, error: unknown): ToolFailure => {
  if (error instanceof BatchChangeError) {
    const mapped = mapKnownError(error.changeType, error.error);
    return failure(
      mapped.error.code,
      mapped.error.message,
      mapped.error.retryable,
      mapped.error.field,
      mapped.error.current_revision,
      error.changeIndex,
    );
  }
  if (error instanceof InputError) return failure("INVALID_INPUT", error.message, false, error.field);
  if (error instanceof ToolExecutionError) {
    return failure(error.code, error.message, error.retryable, error.field, error.currentRevision);
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

const expectEventItems = (value: unknown, field: string): readonly unknown[] => {
  const items = expectArray(value, field);
  if (items.length < 1 || items.length > PROJECT_CAPS.maxEventsPerPattern) {
    invalid(field, `must contain 1 to ${PROJECT_CAPS.maxEventsPerPattern} items`);
  }
  return items;
};

const expectUniqueIds = (value: unknown, field: string): readonly string[] => {
  const ids = expectEventItems(value, field).map((id, index) => expectString(id, `${field}.${index}`));
  if (new Set(ids).size !== ids.length) invalid(field, "must contain unique items");
  return ids;
};

const PUBLIC_CHANGE_TYPES: readonly PublicChange["type"][] = [
  "rename_project", "set_tempo", "set_master_volume", "create_track", "rename_track",
  "set_track_instrument", "reorder_track", "set_track_mix", "set_track_mute", "set_track_solo",
  "delete_track", "create_pattern", "rename_pattern", "resize_pattern", "duplicate_pattern",
  "delete_pattern", "place_pattern", "move_clip", "change_clip_pattern", "set_clip_repeats",
  "duplicate_clip", "make_clip_unique", "delete_clip", "add_drum_hits", "delete_drum_hits",
  "add_notes", "edit_notes", "duplicate_notes", "delete_notes",
];

const expectLocalReference = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !LOCAL_REFERENCE_PATTERN.test(value)) {
    toolError(
      "INVALID_REFERENCE",
      field,
      `${field} must start with a letter and contain only letters, digits, underscores, or hyphens.`,
    );
  }
  return value;
};

const optionalLocalReference = (
  input: Readonly<Record<string, unknown>>,
  field: string,
): string | undefined => input[field] === undefined ? undefined : expectLocalReference(input[field], field);

const parsePublicChange = (value: unknown): PublicChange => {
  const change = expectObject(value, "$");
  const type = expectEnum(change.type, "type", PUBLIC_CHANGE_TYPES);
  const allowed = (...keys: readonly string[]): void => expectAllowedKeys(change, ["type", ...keys], "$");
  const reference = (field: string): EntityReference => expectEntityReference(change[field], field);
  const optionalName = (field: string): string | undefined => change[field] === undefined
    ? undefined
    : expectString(change[field], field).trim();

  switch (type) {
    case "rename_project":
      allowed("name");
      return { type, name: expectString(change.name, "name").trim() };
    case "set_tempo":
      allowed("bpm");
      return { type, bpm: expectFiniteNumber(change.bpm, "bpm") };
    case "set_master_volume":
      allowed("volume_db");
      return { type, volume_db: expectFiniteNumber(change.volume_db, "volume_db") };
    case "create_track":
      allowed("ref", "kind", "instrument_id", "name");
      return {
        type,
        ref: optionalLocalReference(change, "ref"),
        kind: expectEnum(change.kind, "kind", ["drum", "synth"] as const),
        instrument_id: expectString(change.instrument_id, "instrument_id"),
        name: optionalName("name"),
      };
    case "rename_track":
      allowed("track_id", "name");
      return { type, track_id: reference("track_id"), name: expectString(change.name, "name").trim() };
    case "set_track_instrument":
      allowed("track_id", "instrument_id");
      return { type, track_id: reference("track_id"), instrument_id: expectString(change.instrument_id, "instrument_id") };
    case "reorder_track":
      allowed("track_id", "position");
      return { type, track_id: reference("track_id"), position: expectInteger(change.position, "position", 1) };
    case "set_track_mix": {
      allowed("track_id", "volume_db", "pan");
      const result: Extract<PublicChange, { type: "set_track_mix" }> = {
        type,
        track_id: reference("track_id"),
        volume_db: change.volume_db === undefined ? undefined : expectFiniteNumber(change.volume_db, "volume_db"),
        pan: change.pan === undefined ? undefined : expectFiniteNumber(change.pan, "pan"),
      };
      if (result.volume_db === undefined && result.pan === undefined) invalid("$", "must contain volume_db or pan");
      return result;
    }
    case "set_track_mute":
      allowed("track_id", "muted");
      return { type, track_id: reference("track_id"), muted: expectBoolean(change.muted, "muted") };
    case "set_track_solo":
      allowed("track_id", "soloed");
      return { type, track_id: reference("track_id"), soloed: expectBoolean(change.soloed, "soloed") };
    case "delete_track":
      allowed("track_id", "delete_clips");
      return { type, track_id: reference("track_id"),
        delete_clips: change.delete_clips === undefined ? false : expectBoolean(change.delete_clips, "delete_clips") };
    case "create_pattern": {
      allowed("ref", "kind", "name", "length_bars", "placement");
      const placement = change.placement === undefined ? undefined : expectObject(change.placement, "placement");
      if (placement !== undefined) {
        expectAllowedKeys(placement, ["clip_ref", "track_id", "start_bar", "repeat_count"], "placement");
      }
      return {
        type,
        ref: optionalLocalReference(change, "ref"),
        kind: expectEnum(change.kind, "kind", ["drum", "synth"] as const),
        name: optionalName("name"),
        length_bars: expectEnum(change.length_bars, "length_bars", [1, 2, 4] as const),
        placement: placement === undefined ? undefined : {
          clip_ref: optionalLocalReference(placement, "clip_ref"),
          track_id: expectEntityReference(placement.track_id, "placement.track_id"),
          start_bar: expectInteger(placement.start_bar, "placement.start_bar", 1),
          repeat_count: placement.repeat_count === undefined
            ? undefined
            : expectInteger(placement.repeat_count, "placement.repeat_count", 1, 64),
        },
      };
    }
    case "rename_pattern":
      allowed("pattern_id", "name");
      return { type, pattern_id: reference("pattern_id"), name: expectString(change.name, "name").trim() };
    case "resize_pattern":
      allowed("pattern_id", "length_bars");
      return { type, pattern_id: reference("pattern_id"),
        length_bars: expectEnum(change.length_bars, "length_bars", [1, 2, 4] as const) };
    case "duplicate_pattern":
      allowed("pattern_id", "ref", "name");
      return { type, pattern_id: reference("pattern_id"), ref: optionalLocalReference(change, "ref"),
        name: optionalName("name") };
    case "delete_pattern":
      allowed("pattern_id", "delete_clips");
      return { type, pattern_id: reference("pattern_id"),
        delete_clips: change.delete_clips === undefined ? false : expectBoolean(change.delete_clips, "delete_clips") };
    case "place_pattern":
      allowed("ref", "pattern_id", "track_id", "start_bar", "repeat_count");
      return { type, ref: optionalLocalReference(change, "ref"), pattern_id: reference("pattern_id"),
        track_id: reference("track_id"), start_bar: expectInteger(change.start_bar, "start_bar", 1),
        repeat_count: change.repeat_count === undefined ? undefined : expectInteger(change.repeat_count, "repeat_count", 1, 64) };
    case "move_clip": {
      allowed("clip_id", "track_id", "start_bar");
      const result: Extract<PublicChange, { type: "move_clip" }> = {
        type,
        clip_id: reference("clip_id"),
        track_id: change.track_id === undefined ? undefined : reference("track_id"),
        start_bar: change.start_bar === undefined ? undefined : expectInteger(change.start_bar, "start_bar", 1),
      };
      if (result.track_id === undefined && result.start_bar === undefined) invalid("$", "must contain track_id or start_bar");
      return result;
    }
    case "change_clip_pattern":
      allowed("clip_id", "pattern_id");
      return { type, clip_id: reference("clip_id"), pattern_id: reference("pattern_id") };
    case "set_clip_repeats":
      allowed("clip_id", "repeat_count");
      return { type, clip_id: reference("clip_id"), repeat_count: expectInteger(change.repeat_count, "repeat_count", 1, 64) };
    case "duplicate_clip":
      allowed("clip_id", "ref");
      return { type, clip_id: reference("clip_id"), ref: optionalLocalReference(change, "ref") };
    case "make_clip_unique":
      allowed("clip_id", "pattern_ref", "pattern_name");
      return { type, clip_id: reference("clip_id"), pattern_ref: optionalLocalReference(change, "pattern_ref"),
        pattern_name: optionalName("pattern_name") };
    case "delete_clip":
      allowed("clip_id");
      return { type, clip_id: reference("clip_id") };
    case "add_drum_hits": {
      allowed("pattern_id", "hits");
      const hits = expectEventItems(change.hits, "hits").map((value, index) => {
        const hit = expectObject(value, `hits.${index}`);
        expectAllowedKeys(hit, ["ref", "sound_id", "step"], `hits.${index}`);
        return { ref: hit.ref === undefined ? undefined : expectLocalReference(hit.ref, `hits.${index}.ref`),
          sound_id: expectString(hit.sound_id, `hits.${index}.sound_id`),
          step: expectInteger(hit.step, `hits.${index}.step`, 1) };
      });
      return { type, pattern_id: reference("pattern_id"), hits };
    }
    case "delete_drum_hits": {
      allowed("pattern_id", "hit_ids");
      const hit_ids = expectEventItems(change.hit_ids, "hit_ids")
        .map((item, index) => expectEntityReference(item, `hit_ids.${index}`));
      return { type, pattern_id: reference("pattern_id"), hit_ids };
    }
    case "add_notes": {
      allowed("pattern_id", "notes");
      const notes = expectEventItems(change.notes, "notes").map((value, index) => {
        const note = expectObject(value, `notes.${index}`);
        expectAllowedKeys(note, ["ref", "midi_note", "start_step", "length_steps"], `notes.${index}`);
        return { ref: note.ref === undefined ? undefined : expectLocalReference(note.ref, `notes.${index}.ref`),
          midi_note: expectInteger(note.midi_note, `notes.${index}.midi_note`, 24, 96),
          start_step: expectInteger(note.start_step, `notes.${index}.start_step`, 1),
          length_steps: expectInteger(note.length_steps, `notes.${index}.length_steps`, 1) };
      });
      return { type, pattern_id: reference("pattern_id"), notes };
    }
    case "edit_notes": {
      allowed("pattern_id", "notes");
      const notes = expectEventItems(change.notes, "notes").map((value, index) => {
        const note = expectObject(value, `notes.${index}`);
        expectAllowedKeys(note, ["note_id", "midi_note", "start_step", "length_steps"], `notes.${index}`);
        const result = {
          note_id: expectEntityReference(note.note_id, `notes.${index}.note_id`),
          midi_note: note.midi_note === undefined ? undefined : expectInteger(note.midi_note, `notes.${index}.midi_note`, 24, 96),
          start_step: note.start_step === undefined ? undefined : expectInteger(note.start_step, `notes.${index}.start_step`, 1),
          length_steps: note.length_steps === undefined ? undefined : expectInteger(note.length_steps, `notes.${index}.length_steps`, 1),
        };
        if (result.midi_note === undefined && result.start_step === undefined && result.length_steps === undefined) {
          invalid(`notes.${index}`, "must contain midi_note, start_step, or length_steps");
        }
        return result;
      });
      return { type, pattern_id: reference("pattern_id"), notes };
    }
    case "duplicate_notes": {
      allowed("pattern_id", "note_ids", "step_offset", "pitch_offset", "note_refs");
      const note_ids = expectEventItems(change.note_ids, "note_ids")
        .map((item, index) => expectEntityReference(item, `note_ids.${index}`));
      const note_refs = change.note_refs === undefined
        ? undefined
        : expectEventItems(change.note_refs, "note_refs")
          .map((item, index) => expectLocalReference(item, `note_refs.${index}`));
      if (note_refs !== undefined && note_refs.length !== note_ids.length) {
        invalid("note_refs", "must contain one ref for every note_id");
      }
      return { type, pattern_id: reference("pattern_id"), note_ids,
        step_offset: expectInteger(change.step_offset, "step_offset"),
        pitch_offset: expectInteger(change.pitch_offset, "pitch_offset"), note_refs };
    }
    case "delete_notes": {
      allowed("pattern_id", "note_ids");
      const note_ids = expectEventItems(change.note_ids, "note_ids")
        .map((item, index) => expectEntityReference(item, `note_ids.${index}`));
      return { type, pattern_id: reference("pattern_id"), note_ids };
    }
  }
};

interface ReferenceDeclaration {
  readonly ref: string;
  readonly field: string;
}

interface ReferenceContext {
  readonly references: Map<string, string>;
  readonly declaredReferences: Set<string>;
  readonly declarations: ReadonlyMap<string, readonly number[]>;
  readonly changeIndex: number;
  readonly createId: () => string;
}

const referenceDeclarations = (change: PublicChange): readonly ReferenceDeclaration[] => {
  switch (change.type) {
    case "create_track":
    case "duplicate_pattern":
    case "place_pattern":
    case "duplicate_clip":
      return change.ref === undefined ? [] : [{ ref: change.ref, field: "ref" }];
    case "create_pattern":
      return [
        ...(change.ref === undefined ? [] : [{ ref: change.ref, field: "ref" }]),
        ...(change.placement?.clip_ref === undefined
          ? []
          : [{ ref: change.placement.clip_ref, field: "placement.clip_ref" }]),
      ];
    case "make_clip_unique":
      return change.pattern_ref === undefined ? [] : [{ ref: change.pattern_ref, field: "pattern_ref" }];
    case "add_drum_hits":
      return change.hits.flatMap((hit, index) => hit.ref === undefined
        ? []
        : [{ ref: hit.ref, field: `hits.${index}.ref` }]);
    case "add_notes":
      return change.notes.flatMap((note, index) => note.ref === undefined
        ? []
        : [{ ref: note.ref, field: `notes.${index}.ref` }]);
    case "duplicate_notes":
      return change.note_refs?.map((ref, index) => ({ ref, field: `note_refs.${index}` })) ?? [];
    default:
      return [];
  }
};

const rawReferenceNames = (value: unknown): readonly string[] => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  const change = value as Readonly<Record<string, unknown>>;
  const stringValue = (candidate: unknown): readonly string[] => typeof candidate === "string" ? [candidate] : [];
  switch (change.type) {
    case "create_track":
    case "duplicate_pattern":
    case "place_pattern":
    case "duplicate_clip":
      return stringValue(change.ref);
    case "create_pattern": {
      const placement = typeof change.placement === "object" && change.placement !== null && !Array.isArray(change.placement)
        ? change.placement as Readonly<Record<string, unknown>>
        : undefined;
      return [...stringValue(change.ref), ...stringValue(placement?.clip_ref)];
    }
    case "make_clip_unique":
      return stringValue(change.pattern_ref);
    case "add_drum_hits":
      return Array.isArray(change.hits) ? change.hits.flatMap((hit) => rawReferenceNames({
        type: "create_track", ref: typeof hit === "object" && hit !== null ? Reflect.get(hit, "ref") : undefined,
      })) : [];
    case "add_notes":
      return Array.isArray(change.notes) ? change.notes.flatMap((note) => rawReferenceNames({
        type: "create_track", ref: typeof note === "object" && note !== null ? Reflect.get(note, "ref") : undefined,
      })) : [];
    case "duplicate_notes":
      return Array.isArray(change.note_refs) ? change.note_refs.flatMap(stringValue) : [];
    default:
      return [];
  }
};

const referenceDeclarationIndexes = (changes: readonly unknown[]): ReadonlyMap<string, readonly number[]> => {
  const indexes = new Map<string, number[]>();
  changes.forEach((change, index) => {
    for (const ref of rawReferenceNames(change)) indexes.set(ref, [...(indexes.get(ref) ?? []), index]);
  });
  return indexes;
};

const resolveReference = (reference: EntityReference, field: string, context: ReferenceContext): string => {
  if (reference.id !== undefined) return reference.id;
  const resolved = context.references.get(reference.ref);
  if (resolved !== undefined) return resolved;
  const future = context.declarations.get(reference.ref)?.some((index) => index >= context.changeIndex) ?? false;
  toolError(
    future ? "FORWARD_REFERENCE" : "INVALID_REFERENCE",
    `${field}.ref`,
    future ? `${field}.ref must be declared by an earlier change.` : `${field}.ref was not declared in this batch.`,
  );
};

const assertUniqueReferences = (change: PublicChange, context: ReferenceContext): void => {
  const current = new Set<string>();
  for (const declaration of referenceDeclarations(change)) {
    if (current.has(declaration.ref) || context.declaredReferences.has(declaration.ref)) {
      toolError("DUPLICATE_REFERENCE", declaration.field, `${declaration.field} must be unique within the batch.`);
    }
    current.add(declaration.ref);
  }
  for (const ref of current) context.declaredReferences.add(ref);
};

const createEntityId = (
  declaration: ReferenceDeclaration | undefined,
  context: ReferenceContext,
): string => {
  const id = context.createId();
  if (declaration !== undefined) context.references.set(declaration.ref, id);
  return id;
};

const uniqueResolvedReferences = (
  references: readonly EntityReference[],
  field: string,
  context: ReferenceContext,
): readonly string[] => {
  const ids = references.map((reference, index) => resolveReference(reference, `${field}.${index}`, context));
  if (new Set(ids).size !== ids.length) invalid(field, "must contain unique items");
  return ids;
};

const translateChange = (
  project: Project,
  change: PublicChange,
  context: ReferenceContext,
): readonly Operation[] => {
  assertUniqueReferences(change, context);
  const declaration = (ref: string | undefined, field: string): ReferenceDeclaration | undefined =>
    ref === undefined ? undefined : { ref, field };

  switch (change.type) {
    case "rename_project":
      return [{ type: "project.update", changes: { name: change.name } }];
    case "set_tempo":
      return [{ type: "project.update", changes: { bpm: change.bpm } }];
    case "set_master_volume":
      return [{ type: "project.update", changes: { masterVolumeDb: change.volume_db } }];
    case "create_track": {
      const lastTrack = project.tracks.at(-1);
      const colorIndex = lastTrack === undefined
        ? 0
        : (TRACK_COLOR_WHEEL.indexOf(getTrackColor(lastTrack)) + 1) % TRACK_COLOR_WHEEL.length;
      return [{ type: "track.create", track: {
        id: createEntityId(declaration(change.ref, "ref"), context),
        name: change.name ?? INSTRUMENT_NAMES[change.instrument_id] ?? change.instrument_id,
        kind: change.kind,
        instrumentId: change.instrument_id,
        volumeDb: 0,
        pan: 0,
        muted: false,
        soloed: false,
        color: TRACK_COLOR_WHEEL[colorIndex]!,
      } }];
    }
    case "rename_track":
      return [{ type: "track.update", trackId: resolveReference(change.track_id, "track_id", context),
        changes: { name: change.name } }];
    case "set_track_instrument":
      return [{ type: "track.update", trackId: resolveReference(change.track_id, "track_id", context),
        changes: { instrumentId: change.instrument_id } }];
    case "reorder_track":
      return [{ type: "track.reorder", trackId: resolveReference(change.track_id, "track_id", context),
        toIndex: change.position - 1 }];
    case "set_track_mix":
      return [{ type: "track.update", trackId: resolveReference(change.track_id, "track_id", context),
        changes: { volumeDb: change.volume_db, pan: change.pan } }];
    case "set_track_mute":
      return [{ type: "track.update", trackId: resolveReference(change.track_id, "track_id", context),
        changes: { muted: change.muted } }];
    case "set_track_solo":
      return [{ type: "track.update", trackId: resolveReference(change.track_id, "track_id", context),
        changes: { soloed: change.soloed } }];
    case "delete_track": {
      const trackId = resolveReference(change.track_id, "track_id", context);
      const clipIds = project.arrangement.filter(({ trackId: candidate }) => candidate === trackId).map(({ id }) => id);
      if (!change.delete_clips && clipIds.length > 0) {
        toolError("DEPENDENCIES_EXIST", "delete_clips", `Dependent clip IDs: ${clipIds.join(", ")}.`);
      }
      return [{ type: "track.delete", trackId }];
    }
    case "create_pattern": {
      const trackId = change.placement === undefined
        ? undefined
        : resolveReference(change.placement.track_id, "placement.track_id", context);
      const pattern: Pattern = {
        id: createEntityId(declaration(change.ref, "ref"), context),
        name: change.name ?? (change.kind === "drum" ? "New beat" : "New melody"),
        kind: change.kind,
        lengthBars: change.length_bars,
        events: [],
      };
      return change.placement === undefined
        ? [{ type: "pattern.create", pattern }]
        : [
            { type: "pattern.create", pattern },
            { type: "arrangement.place", clip: {
              id: createEntityId(declaration(change.placement.clip_ref, "placement.clip_ref"), context),
              patternId: pattern.id,
              trackId: trackId!,
              startBar: change.placement.start_bar - 1,
              repeatCount: change.placement.repeat_count ?? 1,
            } },
          ];
    }
    case "rename_pattern":
      return [{ type: "pattern.update", patternId: resolveReference(change.pattern_id, "pattern_id", context),
        changes: { name: change.name } }];
    case "resize_pattern":
      return [{ type: "pattern.update", patternId: resolveReference(change.pattern_id, "pattern_id", context),
        changes: { lengthBars: change.length_bars } }];
    case "duplicate_pattern": {
      const patternId = resolveReference(change.pattern_id, "pattern_id", context);
      const pattern = project.patterns.find(({ id }) => id === patternId);
      const duplicatePatternId = createEntityId(declaration(change.ref, "ref"), context);
      return [{
        type: "pattern.duplicate",
        patternId,
        duplicatePatternId,
        duplicateName: change.name ?? `${pattern?.name.slice(0, 35) ?? "Pattern"} copy`,
        duplicateEventIds: pattern?.events.map(() => context.createId()) ?? [],
      }];
    }
    case "delete_pattern": {
      const patternId = resolveReference(change.pattern_id, "pattern_id", context);
      const clipIds = project.arrangement.filter(({ patternId: candidate }) => candidate === patternId).map(({ id }) => id);
      if (!change.delete_clips && clipIds.length > 0) {
        toolError("DEPENDENCIES_EXIST", "delete_clips", `Dependent clip IDs: ${clipIds.join(", ")}.`);
      }
      return [{ type: "pattern.delete", patternId }];
    }
    case "place_pattern": {
      const patternId = resolveReference(change.pattern_id, "pattern_id", context);
      const trackId = resolveReference(change.track_id, "track_id", context);
      return [{ type: "arrangement.place", clip: {
        id: createEntityId(declaration(change.ref, "ref"), context),
        patternId,
        trackId,
        startBar: change.start_bar - 1,
        repeatCount: change.repeat_count ?? 1,
      } }];
    }
    case "move_clip":
      return [{ type: "arrangement.update", clipId: resolveReference(change.clip_id, "clip_id", context), changes: {
        ...(change.track_id === undefined ? {} : { trackId: resolveReference(change.track_id, "track_id", context) }),
        ...(change.start_bar === undefined ? {} : { startBar: change.start_bar - 1 }),
      } }];
    case "change_clip_pattern":
      return [{ type: "arrangement.update", clipId: resolveReference(change.clip_id, "clip_id", context),
        changes: { patternId: resolveReference(change.pattern_id, "pattern_id", context) } }];
    case "set_clip_repeats":
      return [{ type: "arrangement.update", clipId: resolveReference(change.clip_id, "clip_id", context),
        changes: { repeatCount: change.repeat_count } }];
    case "duplicate_clip": {
      const clipId = resolveReference(change.clip_id, "clip_id", context);
      const clip = project.arrangement.find(({ id }) => id === clipId);
      if (clip === undefined) toolError("CLIP_NOT_FOUND", "clip_id", `Clip ${clipId} was not found.`);
      const pattern = project.patterns.find(({ id }) => id === clip.patternId)!;
      return [{ type: "arrangement.place", clip: {
        ...clip,
        id: createEntityId(declaration(change.ref, "ref"), context),
        startBar: clip.startBar + pattern.lengthBars * clip.repeatCount,
      } }];
    }
    case "make_clip_unique": {
      const clipId = resolveReference(change.clip_id, "clip_id", context);
      const clip = project.arrangement.find(({ id }) => id === clipId);
      if (clip === undefined) toolError("CLIP_NOT_FOUND", "clip_id", `Clip ${clipId} was not found.`);
      const pattern = project.patterns.find(({ id }) => id === clip.patternId)!;
      const duplicatePatternId = createEntityId(declaration(change.pattern_ref, "pattern_ref"), context);
      return [
        { type: "pattern.duplicate", patternId: pattern.id, duplicatePatternId,
          duplicateName: change.pattern_name ?? `${pattern.name.slice(0, 35)} copy`,
          duplicateEventIds: pattern.events.map(() => context.createId()) },
        { type: "arrangement.update", clipId: clip.id, changes: { patternId: duplicatePatternId } },
      ];
    }
    case "delete_clip":
      return [{ type: "arrangement.delete", clipId: resolveReference(change.clip_id, "clip_id", context) }];
    case "add_drum_hits": {
      const patternId = resolveReference(change.pattern_id, "pattern_id", context);
      const pattern = project.patterns.find(({ id }) => id === patternId);
      const hitIdsByCell = new Map(pattern?.kind === "drum"
        ? pattern.events.map(({ id, soundId, startStep }) => [`${soundId}:${startStep}`, id])
        : []);
      const hits: DrumHit[] = [];
      for (const [index, hit] of change.hits.entries()) {
        const startStep = hit.step - 1;
        const cell = `${hit.sound_id}:${startStep}`;
        const existingId = hitIdsByCell.get(cell);
        if (existingId !== undefined) {
          if (hit.ref !== undefined) context.references.set(hit.ref, existingId);
          continue;
        }
        const created = { id: createEntityId(declaration(hit.ref, `hits.${index}.ref`), context),
          soundId: hit.sound_id, startStep };
        hitIdsByCell.set(cell, created.id);
        hits.push(created);
      }
      return hits.length === 0 ? [] : [{ type: "drum-hits.add", patternId, hits }];
    }
    case "delete_drum_hits":
      return [{ type: "drum-hits.delete", patternId: resolveReference(change.pattern_id, "pattern_id", context),
        hitIds: uniqueResolvedReferences(change.hit_ids, "hit_ids", context) }];
    case "add_notes":
      return [{ type: "synth-notes.add", patternId: resolveReference(change.pattern_id, "pattern_id", context),
        notes: change.notes.map((note, index) => ({
          id: createEntityId(declaration(note.ref, `notes.${index}.ref`), context),
          midiNote: note.midi_note,
          startStep: note.start_step - 1,
          lengthSteps: note.length_steps,
        })) }];
    case "edit_notes": {
      const noteIds = change.notes.map((note, index) => resolveReference(note.note_id, `notes.${index}.note_id`, context));
      if (new Set(noteIds).size !== noteIds.length) invalid("notes", "must contain unique note_id values");
      return [{ type: "synth-notes.update", patternId: resolveReference(change.pattern_id, "pattern_id", context),
        updates: change.notes.map((note, index) => ({ noteId: noteIds[index]!, changes: {
          midiNote: note.midi_note,
          startStep: note.start_step === undefined ? undefined : note.start_step - 1,
          lengthSteps: note.length_steps,
        } })) }];
    }
    case "duplicate_notes": {
      const patternId = resolveReference(change.pattern_id, "pattern_id", context);
      const noteIds = uniqueResolvedReferences(change.note_ids, "note_ids", context);
      const pattern = project.patterns.find(({ id }) => id === patternId);
      if (pattern === undefined) toolError("PATTERN_NOT_FOUND", "pattern_id", `Pattern ${patternId} was not found.`);
      if (pattern.kind !== "synth") toolError("KIND_MISMATCH", "pattern_id", `Pattern ${patternId} is not a synth pattern.`);
      const sources = noteIds.map((noteId, index) => {
        const note = pattern.events.find(({ id }) => id === noteId);
        if (note === undefined) toolError("NOTE_NOT_FOUND", `note_ids.${index}`, `Note ${noteId} was not found.`);
        return note;
      });
      return [{ type: "synth-notes.add", patternId, notes: sources.map((note, index) => ({
        ...note,
        id: createEntityId(declaration(change.note_refs?.[index], `note_refs.${index}`), context),
        midiNote: note.midiNote + change.pitch_offset,
        startStep: note.startStep + change.step_offset,
      })) }];
    }
    case "delete_notes":
      return [{ type: "synth-notes.delete", patternId: resolveReference(change.pattern_id, "pattern_id", context),
        noteIds: uniqueResolvedReferences(change.note_ids, "note_ids", context) }];
  }
};

export interface ResolvedBatch {
  readonly operations: readonly Operation[];
  readonly references: Readonly<Record<string, string>>;
}

export function resolveBatch(
  project: Project,
  changes: readonly unknown[],
  createId: () => string,
): ResolvedBatch {
  let temporaryProject = project;
  const operations: Operation[] = [];
  const references = new Map<string, string>();
  const declaredReferences = new Set<string>();
  const declarations = referenceDeclarationIndexes(changes);
  for (const [changeIndex, value] of changes.entries()) {
    let changeType: WebMCPToolName = "apply_project_changes";
    try {
      const change = parsePublicChange(value);
      changeType = change.type;
      const context: ReferenceContext = { references, declaredReferences, declarations, changeIndex, createId };
      const changeOperations = translateChange(temporaryProject, change, context);
      let candidate = temporaryProject;
      for (const operation of changeOperations) candidate = validateOperation(candidate, operation, SOUND_CATALOG).project;
      temporaryProject = candidate;
      operations.push(...changeOperations);
    } catch (error) {
      if (error instanceof InputError || error instanceof ToolExecutionError || error instanceof ProjectValidationError) {
        throw new BatchChangeError(changeType, changeIndex, error);
      }
      throw error;
    }
  }
  return { operations, references: Object.fromEntries(references) };
}

interface BatchResultMetadata {
  readonly appliedChanges: number;
  readonly references: Readonly<Record<string, string>>;
}

const batchResults = new WeakMap<ChangeSummary, BatchResultMetadata>();

const batchResultExtras = (result: DispatchResult): Readonly<Record<string, unknown>> => {
  const metadata = batchResults.get(result.changes);
  return metadata === undefined
    ? {}
    : { applied_changes: metadata.appliedChanges, references: metadata.references };
};

const retainBatchResult = (result: DispatchResult, metadata: BatchResultMetadata): void => {
  batchResults.set(result.changes, metadata);
};

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

const historyControlResult = (
  state: StudioState,
  result: Extract<HistoryControlResult, { readonly ok: true }>,
) => ({
  changed: result.changed,
  deduplicated: result.deduplicated,
  project_revision: state.revision,
  history_cursor: state.historyCursor,
  changes: publicChanges(result.changes),
});

const defineHistoryControlTool = (
  name: "undo" | "redo",
  store: Pick<StoreApi<StudioState>, "getState">,
): WebMCPTool => {
  const toolContract = contract(name);
  const allowedKeys = Object.keys(expectObject(toolContract.inputSchema.properties, "inputSchema.properties"));
  return {
    ...toolContract,
    execute: (input, { signal }) => executeSafely(name, signal, () => {
      const object = expectObject(input, "$");
      const requestId = expectString(object.request_id, "request_id", 1, 128);
      const commandId = `webmcp:${name}:${requestId}`;
      const replayed = store.getState().replayHistoryControl(commandId);
      if (replayed !== null && replayed.ok) return historyControlResult(store.getState(), replayed);
      expectAllowedKeys(object, allowedKeys, "$");
      const { baseRevision } = parseMutationMetadata(object);
      signal.throwIfAborted();
      let state = store.getState();
      if (baseRevision !== undefined && baseRevision !== state.revision) {
        toolError("REVISION_CONFLICT", "base_revision", "The project has changed; inspect it and retry.", state.revision);
      }
      const result = state.executeHistoryControl({ id: commandId, kind: name });
      if (!result.ok) {
        throw new ToolExecutionError(
          name === "undo" ? "NOTHING_TO_UNDO" : "NOTHING_TO_REDO",
          undefined,
          name === "undo" ? "There is nothing to undo." : "There is nothing to redo.",
          undefined,
          true,
        );
      }
      state = store.getState();
      return historyControlResult(state, result);
    }),
  };
};

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

const translateDirectChange = (
  project: Project,
  change: PublicChange,
  createId: () => string,
): readonly Operation[] => translateChange(project, change, {
  references: new Map(), declaredReferences: new Set(), declarations: new Map(), changeIndex: -1, createId,
});

const audioResult = (result: AudioControlResult | null): Extract<AudioControlResult, { readonly ok: true }> => {
  if (result === null || (!result.ok && result.code === "closed")) {
    throw new ToolExecutionError("AUDIO_UNAVAILABLE", undefined, "Audio is unavailable; reload the studio and try again.", undefined, true);
  }
  if (!result.ok && result.code === "blocked") {
    throw new ToolExecutionError("AUDIO_BLOCKED", undefined, "Audio is blocked; start playback from a browser gesture and retry.", undefined, true);
  }
  if (!result.ok) {
    throw new ToolExecutionError("NOTHING_TO_PLAY", undefined, "Add an arrangement clip before starting playback.");
  }
  return result;
};

const publicPlayback = (status: "playing" | "paused" | "stopped", positionStep: number) => ({
  status,
  bar: Math.floor(positionStep / 16) + 1,
  step: Math.floor(positionStep % 16) + 1,
});

const positionStep = (bar: number, step: number): number => (bar - 1) * 16 + step - 1;

const checkedPosition = (state: StudioState, bar: number, step: number, field: string): number => {
  const target = positionStep(bar, step);
  if (state.audio.snapshot.arrangementEndStep === 0) {
    throw new ToolExecutionError("NOTHING_TO_PLAY", undefined, "Add an arrangement clip before changing playback position.");
  }
  if (target >= state.audio.snapshot.arrangementEndStep) {
    throw new ToolExecutionError("OUT_OF_RANGE", field, "The requested position is beyond the arrangement.");
  }
  return target;
};

const playWithCancellation = async (
  store: Pick<StoreApi<StudioState>, "getState">,
  startStep: number,
  signal: AbortSignal,
): Promise<AudioControlResult | null> => {
  let cancel!: () => void;
  const cancelled = new Promise<null>((resolve) => {
    cancel = () => {
      store.getState().stopPlayback();
      resolve(null);
    };
    signal.addEventListener("abort", cancel, { once: true });
  });
  try {
    const result = await Promise.race([store.getState().playPlayback(startStep), cancelled]);
    signal.throwIfAborted();
    return result;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
};

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
    defineWebMCPTool(
      contract("play"),
      (input) => ({
        startBar: optionalInteger(input, "start_bar", 1, 256),
        startStep: optionalInteger(input, "start_step", 1, 16),
      }),
      async ({ startBar, startStep }, signal) => {
        const state = store.getState();
        const explicitPosition = startBar !== undefined || startStep !== undefined;
        const start = explicitPosition
          ? checkedPosition(state, startBar ?? 1, startStep ?? 1, startBar === undefined ? "start_step" : "start_bar")
          : state.audio.snapshot.positionStep >= state.audio.snapshot.arrangementEndStep
            ? 0
            : state.audio.snapshot.positionStep;
        const result = audioResult(await playWithCancellation(store, start, signal));
        return publicPlayback(result.status, result.positionStep);
      },
    ),
    defineWebMCPTool(contract("pause"), () => ({}), () => {
      const result = audioResult(store.getState().pausePlayback());
      return publicPlayback(result.status, result.positionStep);
    }),
    defineWebMCPTool(contract("stop"), () => ({}), () => {
      const result = audioResult(store.getState().stopPlayback());
      return publicPlayback(result.status, result.positionStep);
    }),
    defineWebMCPTool(
      contract("seek"),
      (input) => ({
        bar: expectInteger(input.bar, "bar", 1, 256),
        step: optionalInteger(input, "step", 1, 16) ?? 1,
      }),
      ({ bar, step }) => {
        const result = audioResult(store.getState().seekPlayback(checkedPosition(store.getState(), bar, step, "bar")));
        return publicPlayback(result.status, result.positionStep);
      },
    ),
    defineMutationTool(
      contract("rename_project"),
      store,
      (input) => ({ ...parseMutationMetadata(input), name: expectString(input.name, "name").trim() }),
      (input, signal) => runDirectMutation(store, "rename_project", input, signal, (project) =>
        translateDirectChange(project, { type: "rename_project", name: input.name }, createId)),
    ),
    defineMutationTool(
      contract("set_tempo"),
      store,
      (input) => ({ ...parseMutationMetadata(input), bpm: expectFiniteNumber(input.bpm, "bpm") }),
      (input, signal) => runDirectMutation(store, "set_tempo", input, signal, (project) =>
        translateDirectChange(project, { type: "set_tempo", bpm: input.bpm }, createId)),
    ),
    defineMutationTool(
      contract("set_master_volume"),
      store,
      (input) => ({
        ...parseMutationMetadata(input), volumeDb: expectFiniteNumber(input.volume_db, "volume_db"),
      }),
      (input, signal) => runDirectMutation(store, "set_master_volume", input, signal, (project) =>
        translateDirectChange(project, { type: "set_master_volume", volume_db: input.volumeDb }, createId)),
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
      (input, signal) => runDirectMutation(store, "create_track", input, signal, (project) =>
        translateDirectChange(project, {
          type: "create_track", kind: input.kind, instrument_id: input.instrumentId, name: input.name,
        }, createId), (result) => ({ track_id: result.changes.created.trackIds[0] })),
      (result) => ({ track_id: result.changes.created.trackIds[0] }),
    ),
    defineMutationTool(
      contract("rename_track"),
      store,
      (input) => ({ ...parseTrackId(input), name: expectString(input.name, "name").trim() }),
      (input, signal) => runDirectMutation(store, "rename_track", input, signal, (project) =>
        translateDirectChange(project, { type: "rename_track", track_id: { id: input.trackId }, name: input.name }, createId)),
    ),
    defineMutationTool(
      contract("set_track_instrument"),
      store,
      (input) => ({ ...parseTrackId(input), instrumentId: expectString(input.instrument_id, "instrument_id") }),
      (input, signal) => runDirectMutation(store, "set_track_instrument", input, signal, (project) =>
        translateDirectChange(project, { type: "set_track_instrument", track_id: { id: input.trackId },
          instrument_id: input.instrumentId }, createId)),
    ),
    defineMutationTool(
      contract("reorder_track"),
      store,
      (input) => ({ ...parseTrackId(input), position: expectInteger(input.position, "position", 1) }),
      (input, signal) => runDirectMutation(store, "reorder_track", input, signal, (project) =>
        translateDirectChange(project, { type: "reorder_track", track_id: { id: input.trackId },
          position: input.position }, createId)),
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
      (input, signal) => runDirectMutation(store, "set_track_mix", input, signal, (project) =>
        translateDirectChange(project, { type: "set_track_mix", track_id: { id: input.trackId },
          volume_db: input.volumeDb, pan: input.pan }, createId)),
    ),
    defineMutationTool(
      contract("set_track_mute"),
      store,
      (input) => ({ ...parseTrackId(input), muted: expectBoolean(input.muted, "muted") }),
      (input, signal) => runDirectMutation(store, "set_track_mute", input, signal, (project) =>
        translateDirectChange(project, { type: "set_track_mute", track_id: { id: input.trackId },
          muted: input.muted }, createId)),
    ),
    defineMutationTool(
      contract("set_track_solo"),
      store,
      (input) => ({ ...parseTrackId(input), soloed: expectBoolean(input.soloed, "soloed") }),
      (input, signal) => runDirectMutation(store, "set_track_solo", input, signal, (project) =>
        translateDirectChange(project, { type: "set_track_solo", track_id: { id: input.trackId },
          soloed: input.soloed }, createId)),
    ),
    defineMutationTool(
      contract("delete_track"),
      store,
      (input) => ({
        ...parseTrackId(input),
        deleteClips: input.delete_clips === undefined ? false : expectBoolean(input.delete_clips, "delete_clips"),
      }),
      (input, signal) => runDirectMutation(store, "delete_track", input, signal, (project) =>
        translateDirectChange(project, { type: "delete_track", track_id: { id: input.trackId },
          delete_clips: input.deleteClips }, createId)),
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
      (input, signal) => runDirectMutation(store, "create_pattern", input, signal, (project) =>
        translateDirectChange(project, {
          type: "create_pattern",
          kind: input.kind,
          name: input.name,
          length_bars: input.lengthBars,
          placement: input.placement === undefined ? undefined : {
            track_id: { id: input.placement.trackId },
            start_bar: input.placement.startBar + 1,
            repeat_count: input.placement.repeatCount,
          },
        }, createId), (result) => ({
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
      (input, signal) => runDirectMutation(store, "rename_pattern", input, signal, (project) =>
        translateDirectChange(project, { type: "rename_pattern", pattern_id: { id: input.patternId },
          name: input.name }, createId)),
    ),
    defineMutationTool(
      contract("resize_pattern"),
      store,
      (input) => ({
        ...parsePatternId(input),
        lengthBars: expectEnum(input.length_bars, "length_bars", [1, 2, 4] as const),
      }),
      (input, signal) => runDirectMutation(store, "resize_pattern", input, signal, (project) =>
        translateDirectChange(project, { type: "resize_pattern", pattern_id: { id: input.patternId },
          length_bars: input.lengthBars }, createId)),
    ),
    defineMutationTool(
      contract("duplicate_pattern"),
      store,
      (input) => ({
        ...parsePatternId(input),
        name: input.name === undefined ? undefined : expectString(input.name, "name").trim(),
      }),
      (input, signal) => runDirectMutation(store, "duplicate_pattern", input, signal, (project) =>
        translateDirectChange(project, { type: "duplicate_pattern", pattern_id: { id: input.patternId },
          name: input.name }, createId), (result) => ({ pattern_id: result.changes.created.patternIds[0] })),
      (result) => ({ pattern_id: result.changes.created.patternIds[0] }),
    ),
    defineMutationTool(
      contract("delete_pattern"),
      store,
      (input) => ({
        ...parsePatternId(input),
        deleteClips: input.delete_clips === undefined ? false : expectBoolean(input.delete_clips, "delete_clips"),
      }),
      (input, signal) => runDirectMutation(store, "delete_pattern", input, signal, (project) =>
        translateDirectChange(project, { type: "delete_pattern", pattern_id: { id: input.patternId },
          delete_clips: input.deleteClips }, createId)),
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
      (input, signal) => runDirectMutation(store, "place_pattern", input, signal, (project) =>
        translateDirectChange(project, { type: "place_pattern", pattern_id: { id: input.patternId },
          track_id: { id: input.trackId }, start_bar: input.startBar + 1,
          repeat_count: input.repeatCount }, createId),
      (result) => ({ clip_id: result.changes.created.arrangementClipIds[0] })),
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
      (input, signal) => runDirectMutation(store, "move_clip", input, signal, (project) =>
        translateDirectChange(project, { type: "move_clip", clip_id: { id: input.clipId },
          track_id: input.trackId === undefined ? undefined : { id: input.trackId },
          start_bar: input.startBar === undefined ? undefined : input.startBar + 1 }, createId)),
    ),
    defineMutationTool(
      contract("change_clip_pattern"),
      store,
      (input) => ({ ...parseClipId(input), patternId: expectString(input.pattern_id, "pattern_id") }),
      (input, signal) => runDirectMutation(store, "change_clip_pattern", input, signal, (project) =>
        translateDirectChange(project, { type: "change_clip_pattern", clip_id: { id: input.clipId },
          pattern_id: { id: input.patternId } }, createId)),
    ),
    defineMutationTool(
      contract("set_clip_repeats"),
      store,
      (input) => ({ ...parseClipId(input), repeatCount: expectInteger(input.repeat_count, "repeat_count", 1, 64) }),
      (input, signal) => runDirectMutation(store, "set_clip_repeats", input, signal, (project) =>
        translateDirectChange(project, { type: "set_clip_repeats", clip_id: { id: input.clipId },
          repeat_count: input.repeatCount }, createId)),
    ),
    defineMutationTool(
      contract("duplicate_clip"),
      store,
      parseClipId,
      (input, signal) => runDirectMutation(store, "duplicate_clip", input, signal, (project) =>
        translateDirectChange(project, { type: "duplicate_clip", clip_id: { id: input.clipId } }, createId),
      (result) => ({ clip_id: result.changes.created.arrangementClipIds[0] })),
      (result) => ({ clip_id: result.changes.created.arrangementClipIds[0] }),
    ),
    defineMutationTool(
      contract("make_clip_unique"),
      store,
      (input) => ({
        ...parseClipId(input),
        name: input.pattern_name === undefined ? undefined : expectString(input.pattern_name, "pattern_name").trim(),
      }),
      (input, signal) => runDirectMutation(store, "make_clip_unique", input, signal, (project) =>
        translateDirectChange(project, { type: "make_clip_unique", clip_id: { id: input.clipId },
          pattern_name: input.name }, createId),
      (result) => ({ pattern_id: result.changes.created.patternIds[0] })),
      (result) => ({ pattern_id: result.changes.created.patternIds[0] }),
    ),
    defineMutationTool(
      contract("delete_clip"),
      store,
      parseClipId,
      (input, signal) => runDirectMutation(store, "delete_clip", input, signal, (project) =>
        translateDirectChange(project, { type: "delete_clip", clip_id: { id: input.clipId } }, createId)),
    ),
    defineMutationTool(
      contract("add_drum_hits"),
      store,
      (input) => ({
        ...parsePatternId(input),
        hits: expectEventItems(input.hits, "hits").map((value, index) => {
          const hit = expectObject(value, `hits.${index}`);
          expectAllowedKeys(hit, ["sound_id", "step"], `hits.${index}`);
          return {
            soundId: expectString(hit.sound_id, `hits.${index}.sound_id`),
            startStep: expectInteger(hit.step, `hits.${index}.step`, 1) - 1,
          };
        }),
      }),
      (input, signal) => runDirectMutation(store, "add_drum_hits", input, signal, (project) =>
        translateDirectChange(project, { type: "add_drum_hits", pattern_id: { id: input.patternId },
          hits: input.hits.map(({ soundId, startStep }) => ({ sound_id: soundId, step: startStep + 1 })) }, createId),
      (result) => ({ hit_ids: [...result.changes.created.drumHitIds] })),
      (result) => ({ hit_ids: [...result.changes.created.drumHitIds] }),
    ),
    defineMutationTool(
      contract("delete_drum_hits"),
      store,
      (input) => ({ ...parsePatternId(input), hitIds: expectUniqueIds(input.hit_ids, "hit_ids") }),
      (input, signal) => runDirectMutation(store, "delete_drum_hits", input, signal, (project) =>
        translateDirectChange(project, { type: "delete_drum_hits", pattern_id: { id: input.patternId },
          hit_ids: input.hitIds.map((id) => ({ id })) }, createId)),
    ),
    defineMutationTool(
      contract("add_notes"),
      store,
      (input) => ({
        ...parsePatternId(input),
        notes: expectEventItems(input.notes, "notes").map((value, index) => {
          const note = expectObject(value, `notes.${index}`);
          expectAllowedKeys(note, ["midi_note", "start_step", "length_steps"], `notes.${index}`);
          return {
            midiNote: expectInteger(note.midi_note, `notes.${index}.midi_note`, 24, 96),
            startStep: expectInteger(note.start_step, `notes.${index}.start_step`, 1) - 1,
            lengthSteps: expectInteger(note.length_steps, `notes.${index}.length_steps`, 1),
          };
        }),
      }),
      (input, signal) => runDirectMutation(store, "add_notes", input, signal, (project) =>
        translateDirectChange(project, { type: "add_notes", pattern_id: { id: input.patternId },
          notes: input.notes.map(({ midiNote, startStep, lengthSteps }) => ({
            midi_note: midiNote, start_step: startStep + 1, length_steps: lengthSteps,
          })) }, createId), (result) => ({ note_ids: [...result.changes.created.synthNoteIds] })),
      (result) => ({ note_ids: [...result.changes.created.synthNoteIds] }),
    ),
    defineMutationTool(
      contract("edit_notes"),
      store,
      (input) => {
        const notes = expectEventItems(input.notes, "notes").map((value, index) => {
          const note = expectObject(value, `notes.${index}`);
          expectAllowedKeys(note, ["note_id", "midi_note", "start_step", "length_steps"], `notes.${index}`);
          const parsed = {
            noteId: expectString(note.note_id, `notes.${index}.note_id`),
            midiNote: note.midi_note === undefined
              ? undefined
              : expectInteger(note.midi_note, `notes.${index}.midi_note`, 24, 96),
            startStep: note.start_step === undefined
              ? undefined
              : expectInteger(note.start_step, `notes.${index}.start_step`, 1) - 1,
            lengthSteps: note.length_steps === undefined
              ? undefined
              : expectInteger(note.length_steps, `notes.${index}.length_steps`, 1),
          };
          if (parsed.midiNote === undefined && parsed.startStep === undefined && parsed.lengthSteps === undefined) {
            invalid(`notes.${index}`, "must contain midi_note, start_step, or length_steps");
          }
          return parsed;
        });
        if (new Set(notes.map(({ noteId }) => noteId)).size !== notes.length) {
          invalid("notes", "must contain unique note_id values");
        }
        return { ...parsePatternId(input), notes };
      },
      (input, signal) => runDirectMutation(store, "edit_notes", input, signal, (project) =>
        translateDirectChange(project, { type: "edit_notes", pattern_id: { id: input.patternId },
          notes: input.notes.map(({ noteId, midiNote, startStep, lengthSteps }) => ({
            note_id: { id: noteId },
            midi_note: midiNote,
            start_step: startStep === undefined ? undefined : startStep + 1,
            length_steps: lengthSteps,
          })) }, createId)),
    ),
    defineMutationTool(
      contract("duplicate_notes"),
      store,
      (input) => ({
        ...parsePatternId(input),
        noteIds: expectUniqueIds(input.note_ids, "note_ids"),
        stepOffset: expectInteger(input.step_offset, "step_offset"),
        pitchOffset: expectInteger(input.pitch_offset, "pitch_offset"),
      }),
      (input, signal) => runDirectMutation(store, "duplicate_notes", input, signal, (project) =>
        translateDirectChange(project, { type: "duplicate_notes", pattern_id: { id: input.patternId },
          note_ids: input.noteIds.map((id) => ({ id })), step_offset: input.stepOffset,
          pitch_offset: input.pitchOffset }, createId),
      (result) => ({ note_ids: [...result.changes.created.synthNoteIds] })),
      (result) => ({ note_ids: [...result.changes.created.synthNoteIds] }),
    ),
    defineMutationTool(
      contract("delete_notes"),
      store,
      (input) => ({ ...parsePatternId(input), noteIds: expectUniqueIds(input.note_ids, "note_ids") }),
      (input, signal) => runDirectMutation(store, "delete_notes", input, signal, (project) =>
        translateDirectChange(project, { type: "delete_notes", pattern_id: { id: input.patternId },
          note_ids: input.noteIds.map((id) => ({ id })) }, createId)),
    ),
    defineHistoryControlTool("undo", store),
    defineHistoryControlTool("redo", store),
    defineMutationTool(
      contract("restore_history"),
      store,
      (input) => ({
        ...parseMutationMetadata(input),
        historyEntryId: expectString(input.history_entry_id, "history_entry_id"),
      }),
      (input, signal) => {
        signal.throwIfAborted();
        let state = store.getState();
        if (input.baseRevision !== undefined && input.baseRevision !== state.revision) {
          toolError("REVISION_CONFLICT", "base_revision", "The project has changed; inspect it and retry.", state.revision);
        }
        if (!state.history.some(({ id }) => id === input.historyEntryId)) {
          toolError("HISTORY_ENTRY_NOT_FOUND", "history_entry_id", "That retained history entry was not found.");
        }
        const result = state.executeRestore({
          id: `webmcp:restore_history:${input.requestId}`,
          source: "agent",
          toolName: "restore_history",
          label: "Restore history",
          targetEntryId: input.historyEntryId,
        });
        state = store.getState();
        return mutationResult(state, result);
      },
    ),
    defineMutationTool(
      contract("apply_project_changes"),
      store,
      (input) => {
        const changes = expectArray(input.changes, "changes");
        if (changes.length < 2) toolError("BATCH_TOO_SMALL", "changes", "A batch requires at least 2 changes.");
        if (changes.length > 100) toolError("BATCH_TOO_LARGE", "changes", "A batch supports at most 100 changes.");
        return {
          requestId: expectString(input.request_id, "request_id", 1, 128),
          baseRevision: expectInteger(input.base_revision, "base_revision", 0),
          label: expectString(input.label, "label", 1, 80).trim(),
          changes,
        };
      },
      (input, signal) => {
        signal.throwIfAborted();
        let state = store.getState();
        if (input.baseRevision !== state.revision) {
          toolError("REVISION_CONFLICT", "base_revision", "The project has changed; inspect it and retry.", state.revision);
        }
        const resolved = resolveBatch(state.project, input.changes, createId);
        const result = state.dispatch({
          id: `webmcp:apply_project_changes:${input.requestId}`,
          source: "agent",
          toolName: "apply_project_changes",
          label: input.label,
          kind: "batch",
          operations: resolved.operations,
        });
        retainBatchResult(result, { appliedChanges: input.changes.length, references: resolved.references });
        state = store.getState();
        return mutationResult(state, result, batchResultExtras(result));
      },
      batchResultExtras,
    ),
  ];
}
