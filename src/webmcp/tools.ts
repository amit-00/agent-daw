import { SOUND_CATALOG } from "@/audio/catalog";
import { getTrackColor } from "@/data/studio-data";
import {
  PROJECT_CAPS,
  type ChangeSummary,
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
): ToolFailure => ({
  success: false,
  error: { code, message, retryable, ...(field === undefined ? {} : { field }) },
});

const mapKnownError = (toolName: WebMCPToolName, error: unknown): ToolFailure => {
  if (error instanceof InputError) return failure("INVALID_INPUT", error.message, false, error.field);
  if (error instanceof ToolExecutionError) return failure(error.code, error.message, false, error.field);
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

function toolError(code: ToolErrorCode, field: string, message: string): never {
  throw new ToolExecutionError(code, field, message);
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

export function createWebMCPTools(
  store: Pick<StoreApi<StudioState>, "getState">,
  createId: () => string,
): readonly WebMCPTool[] {
  void createId;
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
  ];
}
