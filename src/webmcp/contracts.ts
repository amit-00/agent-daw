export type WebMCPToolName =
  | "get_project" | "get_sound_catalog" | "get_history"
  | "play" | "pause" | "stop" | "seek"
  | "rename_project" | "set_tempo" | "set_master_volume"
  | "create_track" | "rename_track" | "set_track_instrument"
  | "reorder_track" | "set_track_mix" | "set_track_mute"
  | "set_track_solo" | "delete_track"
  | "create_pattern" | "rename_pattern" | "resize_pattern"
  | "duplicate_pattern" | "delete_pattern"
  | "place_pattern" | "move_clip" | "change_clip_pattern"
  | "set_clip_repeats" | "duplicate_clip" | "make_clip_unique"
  | "delete_clip" | "add_drum_hits" | "delete_drum_hits"
  | "add_notes" | "edit_notes" | "duplicate_notes" | "delete_notes"
  | "undo" | "redo" | "restore_history" | "apply_project_changes";

export type ToolErrorCode =
  | "INVALID_INPUT" | "INVALID_REFERENCE" | "INVALID_CURSOR" | "REVISION_CONFLICT"
  | "TRACK_NOT_FOUND" | "PATTERN_NOT_FOUND" | "CLIP_NOT_FOUND" | "HIT_NOT_FOUND" | "NOTE_NOT_FOUND"
  | "OUT_OF_RANGE" | "KIND_MISMATCH" | "INCOMPATIBLE_INSTRUMENT" | "CLIP_OVERLAP"
  | "CAPACITY_EXCEEDED" | "BATCH_TOO_SMALL" | "BATCH_TOO_LARGE"
  | "DEPENDENCIES_EXIST" | "FORWARD_REFERENCE" | "DUPLICATE_REFERENCE"
  | "NOTHING_TO_UNDO" | "NOTHING_TO_REDO" | "HISTORY_ENTRY_NOT_FOUND"
  | "AUDIO_BLOCKED" | "AUDIO_UNAVAILABLE" | "NOTHING_TO_PLAY"
  | "EXPORT_FAILED" | "EXECUTION_CANCELLED" | "INTERNAL_ERROR";

export interface ToolError {
  readonly code: ToolErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly field?: string;
  readonly change_index?: number;
  readonly current_revision?: number;
}

export type EntityReference =
  | { readonly id: string; readonly ref?: never }
  | { readonly ref: string; readonly id?: never };

export type PublicChange =
  | { readonly type: "rename_project"; readonly name: string }
  | { readonly type: "set_tempo"; readonly bpm: number }
  | { readonly type: "set_master_volume"; readonly volume_db: number }
  | { readonly type: "create_track"; readonly ref?: string; readonly kind: "drum" | "synth"; readonly instrument_id: string; readonly name?: string }
  | { readonly type: "rename_track"; readonly track_id: EntityReference; readonly name: string }
  | { readonly type: "set_track_instrument"; readonly track_id: EntityReference; readonly instrument_id: string }
  | { readonly type: "reorder_track"; readonly track_id: EntityReference; readonly position: number }
  | { readonly type: "set_track_mix"; readonly track_id: EntityReference; readonly volume_db?: number; readonly pan?: number }
  | { readonly type: "set_track_mute"; readonly track_id: EntityReference; readonly muted: boolean }
  | { readonly type: "set_track_solo"; readonly track_id: EntityReference; readonly soloed: boolean }
  | { readonly type: "delete_track"; readonly track_id: EntityReference; readonly delete_clips?: boolean }
  | {
      readonly type: "create_pattern";
      readonly ref?: string;
      readonly kind: "drum" | "synth";
      readonly name?: string;
      readonly length_bars: 1 | 2 | 4;
      readonly placement?: {
        readonly clip_ref?: string;
        readonly track_id: EntityReference;
        readonly start_bar: number;
        readonly repeat_count?: number;
      };
    }
  | { readonly type: "rename_pattern"; readonly pattern_id: EntityReference; readonly name: string }
  | { readonly type: "resize_pattern"; readonly pattern_id: EntityReference; readonly length_bars: 1 | 2 | 4 }
  | { readonly type: "duplicate_pattern"; readonly pattern_id: EntityReference; readonly ref?: string; readonly name?: string }
  | { readonly type: "delete_pattern"; readonly pattern_id: EntityReference; readonly delete_clips?: boolean }
  | {
      readonly type: "place_pattern";
      readonly ref?: string;
      readonly pattern_id: EntityReference;
      readonly track_id: EntityReference;
      readonly start_bar: number;
      readonly repeat_count?: number;
    }
  | { readonly type: "move_clip"; readonly clip_id: EntityReference; readonly track_id?: EntityReference; readonly start_bar?: number }
  | { readonly type: "change_clip_pattern"; readonly clip_id: EntityReference; readonly pattern_id: EntityReference }
  | { readonly type: "set_clip_repeats"; readonly clip_id: EntityReference; readonly repeat_count: number }
  | { readonly type: "duplicate_clip"; readonly clip_id: EntityReference; readonly ref?: string }
  | { readonly type: "make_clip_unique"; readonly clip_id: EntityReference; readonly pattern_ref?: string; readonly pattern_name?: string }
  | { readonly type: "delete_clip"; readonly clip_id: EntityReference }
  | {
      readonly type: "add_drum_hits";
      readonly pattern_id: EntityReference;
      readonly hits: readonly { readonly ref?: string; readonly sound_id: string; readonly step: number }[];
    }
  | { readonly type: "delete_drum_hits"; readonly pattern_id: EntityReference; readonly hit_ids: readonly EntityReference[] }
  | {
      readonly type: "add_notes";
      readonly pattern_id: EntityReference;
      readonly notes: readonly { readonly ref?: string; readonly midi_note: number; readonly start_step: number; readonly length_steps: number }[];
    }
  | {
      readonly type: "edit_notes";
      readonly pattern_id: EntityReference;
      readonly notes: readonly {
        readonly note_id: EntityReference;
        readonly midi_note?: number;
        readonly start_step?: number;
        readonly length_steps?: number;
      }[];
    }
  | {
      readonly type: "duplicate_notes";
      readonly pattern_id: EntityReference;
      readonly note_ids: readonly EntityReference[];
      readonly step_offset: number;
      readonly pitch_offset: number;
      readonly note_refs?: readonly string[];
    }
  | { readonly type: "delete_notes"; readonly pattern_id: EntityReference; readonly note_ids: readonly EntityReference[] };

export interface ToolAnnotations {
  readonly readOnlyHint: boolean;
  readonly untrustedContentHint: boolean;
}

export interface ToolContract {
  readonly name: WebMCPToolName;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly annotations: ToolAnnotations;
}

export interface WebMCPTool extends ToolContract {
  execute(
    input: Readonly<Record<string, unknown>>,
    options: { readonly signal: AbortSignal },
  ): Promise<unknown>;
}

export type ToolResult<T> =
  | { readonly success: true; readonly result: T }
  | { readonly success: false; readonly error: ToolError };

type Schema = Readonly<Record<string, unknown>>;

export const LOCAL_REFERENCE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

const string = (minimum = 1, maximum?: number): Schema => ({
  type: "string",
  minLength: minimum,
  ...(maximum === undefined ? {} : { maxLength: maximum }),
});
const number = (minimum: number, maximum: number): Schema => ({ type: "number", minimum, maximum });
const integer = (minimum: number, maximum?: number): Schema => ({
  type: "integer",
  minimum,
  ...(maximum === undefined ? {} : { maximum }),
});
const enumOf = (...values: readonly (string | number)[]): Schema => ({ enum: values });
const arrayOf = (items: Schema, minItems?: number, maxItems?: number, uniqueItems = false): Schema => ({
  type: "array",
  items,
  ...(minItems === undefined ? {} : { minItems }),
  ...(maxItems === undefined ? {} : { maxItems }),
  ...(uniqueItems ? { uniqueItems: true } : {}),
});
const object = (properties: Readonly<Record<string, Schema>>, required: readonly string[] = []): Schema => ({
  type: "object",
  properties,
  ...(required.length === 0 ? {} : { required }),
  additionalProperties: false,
});

const ID = string();
const LOCAL_REF: Schema = {
  type: "string",
  minLength: 1,
  maxLength: 64,
  pattern: LOCAL_REFERENCE_PATTERN.source,
};
const NAME_40 = string(1, 40);
const NAME_80 = string(1, 80);
const KIND = enumOf("drum", "synth");
const LENGTH_BARS = enumOf(1, 2, 4);
const ONE_BASED_POSITION = integer(1);
const REPEAT_COUNT = integer(1, 64);
const ENTITY_REFERENCE: Schema = {
  oneOf: [object({ id: ID }, ["id"]), object({ ref: LOCAL_REF }, ["ref"])],
};
const STRING_IDS = arrayOf(ID, 1, 512, true);
const ENTITY_REFERENCES = arrayOf(ENTITY_REFERENCE, 1, 512, true);
const COMMON_MUTATION_PROPERTIES = {
  request_id: string(1, 128),
  base_revision: integer(0),
} as const;
const READ_ANNOTATIONS = { readOnlyHint: true, untrustedContentHint: false } as const;
const UNTRUSTED_READ_ANNOTATIONS = { readOnlyHint: true, untrustedContentHint: true } as const;
const MUTATION_ANNOTATIONS = { readOnlyHint: false, untrustedContentHint: false } as const;
const BATCH_ADVICE = " Use apply_project_changes when this edit must be atomic with other edits.";

const directSchema = (
  properties: Readonly<Record<string, Schema>> = {},
  required: readonly string[] = [],
): Schema => object({ ...COMMON_MUTATION_PROPERTIES, ...properties }, ["request_id", ...required]);

const read = (
  name: WebMCPToolName,
  title: string,
  description: string,
  inputSchema: Schema,
  untrustedContentHint = false,
): ToolContract => ({
  name,
  title,
  description,
  inputSchema,
  annotations: untrustedContentHint ? UNTRUSTED_READ_ANNOTATIONS : READ_ANNOTATIONS,
});

const mutation = (
  name: WebMCPToolName,
  title: string,
  description: string,
  inputSchema: Schema,
): ToolContract => ({ name, title, description, inputSchema, annotations: MUTATION_ANNOTATIONS });

const PLACEMENT = object({
  track_id: ID,
  start_bar: ONE_BASED_POSITION,
  repeat_count: REPEAT_COUNT,
}, ["track_id", "start_bar"]);
const BATCH_PLACEMENT = object({
  clip_ref: LOCAL_REF,
  track_id: ENTITY_REFERENCE,
  start_bar: ONE_BASED_POSITION,
  repeat_count: REPEAT_COUNT,
}, ["track_id", "start_bar"]);
const DRUM_HIT = object({ sound_id: ID, step: ONE_BASED_POSITION }, ["sound_id", "step"]);
const BATCH_DRUM_HIT = object({ ref: LOCAL_REF, sound_id: ID, step: ONE_BASED_POSITION }, ["sound_id", "step"]);
const NOTE = object({
  midi_note: integer(24, 96),
  start_step: ONE_BASED_POSITION,
  length_steps: integer(1),
}, ["midi_note", "start_step", "length_steps"]);
const BATCH_NOTE = object({
  ref: LOCAL_REF,
  midi_note: integer(24, 96),
  start_step: ONE_BASED_POSITION,
  length_steps: integer(1),
}, ["midi_note", "start_step", "length_steps"]);
const NOTE_EDIT = object({
  note_id: ID,
  midi_note: integer(24, 96),
  start_step: ONE_BASED_POSITION,
  length_steps: integer(1),
}, ["note_id"]);
const BATCH_NOTE_EDIT = object({
  note_id: ENTITY_REFERENCE,
  midi_note: integer(24, 96),
  start_step: ONE_BASED_POSITION,
  length_steps: integer(1),
}, ["note_id"]);
const EVENT_LIST = (items: Schema): Schema => arrayOf(items, 1, 512);

const batchChange = (
  type: PublicChange["type"],
  properties: Readonly<Record<string, Schema>>,
  required: readonly string[],
): Schema => object({ type: { const: type }, ...properties }, ["type", ...required]);

const PUBLIC_CHANGE_SCHEMAS: readonly Schema[] = [
  batchChange("rename_project", { name: NAME_80 }, ["name"]),
  batchChange("set_tempo", { bpm: number(40, 240) }, ["bpm"]),
  batchChange("set_master_volume", { volume_db: number(-60, 0) }, ["volume_db"]),
  batchChange("create_track", { ref: LOCAL_REF, kind: KIND, instrument_id: ID, name: NAME_40 }, ["kind", "instrument_id"]),
  batchChange("rename_track", { track_id: ENTITY_REFERENCE, name: NAME_40 }, ["track_id", "name"]),
  batchChange("set_track_instrument", { track_id: ENTITY_REFERENCE, instrument_id: ID }, ["track_id", "instrument_id"]),
  batchChange("reorder_track", { track_id: ENTITY_REFERENCE, position: ONE_BASED_POSITION }, ["track_id", "position"]),
  batchChange("set_track_mix", { track_id: ENTITY_REFERENCE, volume_db: number(-60, 6), pan: number(-1, 1) }, ["track_id"]),
  batchChange("set_track_mute", { track_id: ENTITY_REFERENCE, muted: { type: "boolean" } }, ["track_id", "muted"]),
  batchChange("set_track_solo", { track_id: ENTITY_REFERENCE, soloed: { type: "boolean" } }, ["track_id", "soloed"]),
  batchChange("delete_track", { track_id: ENTITY_REFERENCE, delete_clips: { type: "boolean" } }, ["track_id"]),
  batchChange("create_pattern", { ref: LOCAL_REF, kind: KIND, name: NAME_40, length_bars: LENGTH_BARS, placement: BATCH_PLACEMENT }, ["kind", "length_bars"]),
  batchChange("rename_pattern", { pattern_id: ENTITY_REFERENCE, name: NAME_40 }, ["pattern_id", "name"]),
  batchChange("resize_pattern", { pattern_id: ENTITY_REFERENCE, length_bars: LENGTH_BARS }, ["pattern_id", "length_bars"]),
  batchChange("duplicate_pattern", { pattern_id: ENTITY_REFERENCE, ref: LOCAL_REF, name: NAME_40 }, ["pattern_id"]),
  batchChange("delete_pattern", { pattern_id: ENTITY_REFERENCE, delete_clips: { type: "boolean" } }, ["pattern_id"]),
  batchChange("place_pattern", { ref: LOCAL_REF, pattern_id: ENTITY_REFERENCE, track_id: ENTITY_REFERENCE, start_bar: ONE_BASED_POSITION, repeat_count: REPEAT_COUNT }, ["pattern_id", "track_id", "start_bar"]),
  batchChange("move_clip", { clip_id: ENTITY_REFERENCE, track_id: ENTITY_REFERENCE, start_bar: ONE_BASED_POSITION }, ["clip_id"]),
  batchChange("change_clip_pattern", { clip_id: ENTITY_REFERENCE, pattern_id: ENTITY_REFERENCE }, ["clip_id", "pattern_id"]),
  batchChange("set_clip_repeats", { clip_id: ENTITY_REFERENCE, repeat_count: REPEAT_COUNT }, ["clip_id", "repeat_count"]),
  batchChange("duplicate_clip", { clip_id: ENTITY_REFERENCE, ref: LOCAL_REF }, ["clip_id"]),
  batchChange("make_clip_unique", { clip_id: ENTITY_REFERENCE, pattern_ref: LOCAL_REF, pattern_name: NAME_40 }, ["clip_id"]),
  batchChange("delete_clip", { clip_id: ENTITY_REFERENCE }, ["clip_id"]),
  batchChange("add_drum_hits", { pattern_id: ENTITY_REFERENCE, hits: EVENT_LIST(BATCH_DRUM_HIT) }, ["pattern_id", "hits"]),
  batchChange("delete_drum_hits", { pattern_id: ENTITY_REFERENCE, hit_ids: ENTITY_REFERENCES }, ["pattern_id", "hit_ids"]),
  batchChange("add_notes", { pattern_id: ENTITY_REFERENCE, notes: EVENT_LIST(BATCH_NOTE) }, ["pattern_id", "notes"]),
  batchChange("edit_notes", { pattern_id: ENTITY_REFERENCE, notes: EVENT_LIST(BATCH_NOTE_EDIT) }, ["pattern_id", "notes"]),
  batchChange("duplicate_notes", { pattern_id: ENTITY_REFERENCE, note_ids: ENTITY_REFERENCES, step_offset: { type: "integer" }, pitch_offset: { type: "integer" }, note_refs: arrayOf(LOCAL_REF, 1, 512, true) }, ["pattern_id", "note_ids", "step_offset", "pitch_offset"]),
  batchChange("delete_notes", { pattern_id: ENTITY_REFERENCE, note_ids: ENTITY_REFERENCES }, ["pattern_id", "note_ids"]),
];

export const TOOL_CONTRACTS: readonly ToolContract[] = [
  read("get_project", "Get project", "Gets the requested current-project view with stable pagination and the current revision.", object({
    view: enumOf("overview", "tracks", "patterns", "pattern", "arrangement"),
    track_ids: arrayOf(ID, 1, 16, true),
    pattern_id: ID,
    kind: KIND,
    start_bar: ONE_BASED_POSITION,
    end_bar: ONE_BASED_POSITION,
    cursor: string(1, 256),
    limit: integer(1, 100),
  }, ["view"]), true),
  read("get_sound_catalog", "Get sound catalog", "Gets stable drum-kit, sound, and synth-preset identifiers, optionally filtered by kind.", object({ kind: KIND })),
  read("get_history", "Get history", "Gets history summaries or one retained entry's affected values with stable pagination.", object({
    view: enumOf("list", "entry"),
    history_entry_id: ID,
    cursor: string(1, 256),
    limit: integer(1, 100),
  }, ["view"]), true),

  mutation("play", "Play", "Starts or resumes playback, optionally from a one-based bar and step.", object({
    start_bar: integer(1, 256),
    start_step: integer(1, 16),
  })),
  mutation("pause", "Pause", "Pauses playback at the current musical position.", object({})),
  mutation("stop", "Stop", "Stops playback and returns to the start.", object({})),
  mutation("seek", "Seek", "Moves playback to a one-based bar and optional step within that bar.", object({
    bar: integer(1, 256),
    step: integer(1, 16),
  }, ["bar"])),

  mutation("rename_project", "Rename project", "Renames the current project." + BATCH_ADVICE, directSchema({ name: NAME_80 }, ["name"])),
  mutation("set_tempo", "Set tempo", "Sets the project tempo in beats per minute." + BATCH_ADVICE, directSchema({ bpm: number(40, 240) }, ["bpm"])),
  mutation("set_master_volume", "Set master volume", "Sets the project master volume in decibels." + BATCH_ADVICE, directSchema({ volume_db: number(-60, 0) }, ["volume_db"])),
  mutation("create_track", "Create track", "Appends a drum or synth track and returns its generated ID." + BATCH_ADVICE, directSchema({ kind: KIND, instrument_id: ID, name: NAME_40 }, ["kind", "instrument_id"])),
  mutation("rename_track", "Rename track", "Renames one existing track." + BATCH_ADVICE, directSchema({ track_id: ID, name: NAME_40 }, ["track_id", "name"])),
  mutation("set_track_instrument", "Set track instrument", "Sets a compatible instrument and validates every placed drum pattern." + BATCH_ADVICE, directSchema({ track_id: ID, instrument_id: ID }, ["track_id", "instrument_id"])),
  mutation("reorder_track", "Reorder track", "Moves a track to a one-based position in the track list." + BATCH_ADVICE, directSchema({ track_id: ID, position: ONE_BASED_POSITION }, ["track_id", "position"])),
  mutation("set_track_mix", "Set track mix", "Sets at least one of a track's volume or pan values." + BATCH_ADVICE, directSchema({ track_id: ID, volume_db: number(-60, 6), pan: number(-1, 1) }, ["track_id"])),
  mutation("set_track_mute", "Set track mute", "Sets a track's mute state explicitly." + BATCH_ADVICE, directSchema({ track_id: ID, muted: { type: "boolean" } }, ["track_id", "muted"])),
  mutation("set_track_solo", "Set track solo", "Sets a track's solo state explicitly." + BATCH_ADVICE, directSchema({ track_id: ID, soloed: { type: "boolean" } }, ["track_id", "soloed"])),
  mutation("delete_track", "Delete track", "Deletes a track, preserving patterns; dependent clips are deleted only when delete_clips is true." + BATCH_ADVICE, directSchema({ track_id: ID, delete_clips: { type: "boolean" } }, ["track_id"])),

  mutation("create_pattern", "Create pattern", "Creates an empty pattern and optionally places it at a one-based start bar, returning generated IDs." + BATCH_ADVICE, directSchema({ kind: KIND, name: NAME_40, length_bars: LENGTH_BARS, placement: PLACEMENT }, ["kind", "length_bars"])),
  mutation("rename_pattern", "Rename pattern", "Renames one existing pattern." + BATCH_ADVICE, directSchema({ pattern_id: ID, name: NAME_40 }, ["pattern_id", "name"])),
  mutation("resize_pattern", "Resize pattern", "Changes a pattern to 1, 2, or 4 bars without truncating events or invalidating placements." + BATCH_ADVICE, directSchema({ pattern_id: ID, length_bars: LENGTH_BARS }, ["pattern_id", "length_bars"])),
  mutation("duplicate_pattern", "Duplicate pattern", "Copies a pattern and all events with fresh IDs." + BATCH_ADVICE, directSchema({ pattern_id: ID, name: NAME_40 }, ["pattern_id"])),
  mutation("delete_pattern", "Delete pattern", "Deletes a pattern; dependent clips are deleted only when delete_clips is true." + BATCH_ADVICE, directSchema({ pattern_id: ID, delete_clips: { type: "boolean" } }, ["pattern_id"])),

  mutation("place_pattern", "Place pattern", "Places a pattern on a compatible track at a one-based start bar and returns the clip ID." + BATCH_ADVICE, directSchema({ pattern_id: ID, track_id: ID, start_bar: ONE_BASED_POSITION, repeat_count: REPEAT_COUNT }, ["pattern_id", "track_id", "start_bar"])),
  mutation("move_clip", "Move clip", "Moves a clip to a track or one-based start bar without changing its pattern or repeats." + BATCH_ADVICE, directSchema({ clip_id: ID, track_id: ID, start_bar: ONE_BASED_POSITION }, ["clip_id"])),
  mutation("change_clip_pattern", "Change clip pattern", "Changes a clip's pattern while preserving its track, start bar, and repeats." + BATCH_ADVICE, directSchema({ clip_id: ID, pattern_id: ID }, ["clip_id", "pattern_id"])),
  mutation("set_clip_repeats", "Set clip repeats", "Sets a clip's repeat count from 1 to 64." + BATCH_ADVICE, directSchema({ clip_id: ID, repeat_count: REPEAT_COUNT }, ["clip_id", "repeat_count"])),
  mutation("duplicate_clip", "Duplicate clip", "Copies a clip with the shared pattern immediately after its source." + BATCH_ADVICE, directSchema({ clip_id: ID }, ["clip_id"])),
  mutation("make_clip_unique", "Make clip unique", "Copies a clip's pattern and redirects only that clip to the generated pattern." + BATCH_ADVICE, directSchema({ clip_id: ID, pattern_name: NAME_40 }, ["clip_id"])),
  mutation("delete_clip", "Delete clip", "Deletes one clip while preserving its pattern." + BATCH_ADVICE, directSchema({ clip_id: ID }, ["clip_id"])),

  mutation("add_drum_hits", "Add drum hits", "Adds drum hits at one-based steps and returns generated hit IDs." + BATCH_ADVICE, directSchema({ pattern_id: ID, hits: EVENT_LIST(DRUM_HIT) }, ["pattern_id", "hits"])),
  mutation("delete_drum_hits", "Delete drum hits", "Deletes identified hits from one drum pattern." + BATCH_ADVICE, directSchema({ pattern_id: ID, hit_ids: STRING_IDS }, ["pattern_id", "hit_ids"])),
  mutation("add_notes", "Add notes", "Adds notes at one-based start steps and returns generated note IDs." + BATCH_ADVICE, directSchema({ pattern_id: ID, notes: EVENT_LIST(NOTE) }, ["pattern_id", "notes"])),
  mutation("edit_notes", "Edit notes", "Edits pitch, one-based start step, or duration for identified notes." + BATCH_ADVICE, directSchema({ pattern_id: ID, notes: EVENT_LIST(NOTE_EDIT) }, ["pattern_id", "notes"])),
  mutation("duplicate_notes", "Duplicate notes", "Duplicates identified notes using whole-step and pitch offsets and returns generated IDs." + BATCH_ADVICE, directSchema({ pattern_id: ID, note_ids: STRING_IDS, step_offset: { type: "integer" }, pitch_offset: { type: "integer" } }, ["pattern_id", "note_ids", "step_offset", "pitch_offset"])),
  mutation("delete_notes", "Delete notes", "Deletes identified notes from one synth pattern." + BATCH_ADVICE, directSchema({ pattern_id: ID, note_ids: STRING_IDS }, ["pattern_id", "note_ids"])),

  mutation("undo", "Undo", "Moves history backward once without creating a history entry.", directSchema()),
  mutation("redo", "Redo", "Moves history forward once without creating a history entry.", directSchema()),
  mutation("restore_history", "Restore history", "Restores a retained history entry's after-state as one new project edit.", directSchema({ history_entry_id: ID }, ["history_entry_id"])),
  mutation("apply_project_changes", "Apply project changes", "Applies 2 to 100 ordered project changes atomically with one history entry.", object({
    ...COMMON_MUTATION_PROPERTIES,
    label: string(1, 80),
    changes: { type: "array", items: { oneOf: PUBLIC_CHANGE_SCHEMAS }, minItems: 2, maxItems: 100 },
  }, ["request_id", "base_revision", "label", "changes"])),
];
