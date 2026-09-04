import { describe, expect, test, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";

import { AudioEngine } from "@/audio";
import { PROJECT_CAPS, type Project } from "@/project";
import { DEMO_PROJECT } from "@/data/studio-data";
import { createStudioStore as createStudioStoreBase, type StudioState } from "@/stores/studio-store";
import { audioProject } from "../../test/audio-fixtures";
import { FakeAudioContext, FakeOfflineAudioContext, FakeTimers } from "../../test/audio-fakes";

import { TOOL_CONTRACTS } from "./contracts.ts";
import type { WebMCPToolName } from "./contracts.ts";
import toolSelectionCases from "./evals/tool-selection.json";
import { createWebMCPTools, defineWebMCPTool, expectString } from "./tools.ts";

const createStudioStore = (project: Project): StoreApi<StudioState> => createStudioStoreBase(
  project,
  () => null,
  { status: "unsaved", updatedAt: null, errorMessage: null },
);

const createAudioStore = (project: Project, context: FakeAudioContext): {
  readonly engine: AudioEngine;
  readonly store: StoreApi<StudioState>;
} => {
  const timers = new FakeTimers();
  const engine = new AudioEngine({
    createContext: () => context.asAudioContext(),
    loadArrayBuffer: async () => new ArrayBuffer(8),
    setInterval: (callback, milliseconds) => timers.setInterval(callback, milliseconds),
    clearInterval: (handle) => timers.clearInterval(handle),
  });
  engine.replaceProject(project);
  return {
    engine,
    store: createStudioStoreBase(
      project,
      () => engine,
      { status: "unsaved", updatedAt: null, errorMessage: null },
    ),
  };
};

const readNames = ["get_project", "get_sound_catalog", "get_history"];
const runtimeNames = ["play", "pause", "stop", "seek", "export_wav"];
const futureAndDeferredNames = [
  "duplicate_track",
  "quantize_notes", "transpose_notes", "humanize_notes", "edit_drum_hits",
  "update_track", "apply_operations", "toggle_mute", "get_tracks",
];
type ToolSelectionCase = {
  readonly id: string;
  readonly messages: readonly { readonly role: "user" | "assistant"; readonly content: string }[];
  readonly expectedCall: {
    readonly name: WebMCPToolName;
    readonly arguments: Readonly<Record<string, unknown>>;
  };
};

const schemaOf = (name: string) => {
  const contract = TOOL_CONTRACTS.find((candidate) => candidate.name === name);
  expect(contract).toBeDefined();
  return contract!.inputSchema as {
    additionalProperties?: unknown;
    properties: Record<string, Record<string, unknown>>;
    required?: string[];
  };
};

describe("WebMCP tool contracts", () => {
  test("tool-selection fixture has unique typed cases for registered tools", () => {
    const cases = toolSelectionCases as readonly ToolSelectionCase[];
    const registeredNames: readonly string[] = TOOL_CONTRACTS.map(({ name }) => name);

    expect(cases.length).toBeGreaterThanOrEqual(16);
    expect(new Set(cases.map(({ id }) => id)).size).toBe(cases.length);
    for (const selectionCase of cases) {
      expect(selectionCase.id).toEqual(expect.any(String));
      expect(selectionCase.id).not.toBe("");
      expect(selectionCase.messages.length, selectionCase.id).toBeGreaterThan(0);
      for (const message of selectionCase.messages) {
        expect(["user", "assistant"], selectionCase.id).toContain(message.role);
        expect(message.content, selectionCase.id).toEqual(expect.any(String));
      }
      expect(registeredNames, selectionCase.id).toContain(selectionCase.expectedCall.name);
      expect(selectionCase.expectedCall.arguments, selectionCase.id).toEqual(expect.any(Object));
      expect(Array.isArray(selectionCase.expectedCall.arguments), selectionCase.id).toBe(false);
    }
  });

  test("publish exactly the 41 approved unique tool names", () => {
    const names = TOOL_CONTRACTS.map(({ name }) => name);
    expect(names).toHaveLength(41);
    expect(new Set(names)).toHaveLength(41);
    expect(names).toEqual([
      "get_project", "get_sound_catalog", "get_history",
      "play", "pause", "stop", "seek", "export_wav",
      "rename_project", "set_tempo", "set_master_volume",
      "create_track", "rename_track", "set_track_instrument",
      "reorder_track", "set_track_mix", "set_track_mute",
      "set_track_solo", "delete_track", "create_pattern",
      "rename_pattern", "resize_pattern", "duplicate_pattern",
      "delete_pattern", "place_pattern", "move_clip",
      "change_clip_pattern", "set_clip_repeats", "duplicate_clip",
      "make_clip_unique", "delete_clip", "add_drum_hits",
      "delete_drum_hits", "add_notes", "edit_notes", "duplicate_notes",
      "delete_notes", "undo", "redo", "restore_history",
      "apply_project_changes",
    ]);
  });

  test("give every contract user-facing intent metadata and a closed root schema", () => {
    for (const contract of TOOL_CONTRACTS) {
      expect(contract.title.trim(), contract.name).not.toBe("");
      expect(contract.description.trim(), contract.name).not.toBe("");
      expect(contract.description, contract.name).not.toMatch(/dispatch|canonical operation/i);
      expect(contract.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
    }
  });

  test("require bounded request IDs for mutations and only require batch revisions", () => {
    for (const contract of TOOL_CONTRACTS.filter(({ name }) =>
      !readNames.includes(name) && !runtimeNames.includes(name))) {
      const schema = schemaOf(contract.name);
      expect(schema.required, contract.name).toContain("request_id");
      expect(schema.properties.request_id, contract.name).toMatchObject({
        type: "string", minLength: 1, maxLength: 128,
      });
      expect(schema.properties.base_revision, contract.name).toMatchObject({
        type: "integer", minimum: 0,
      });
      expect(schema.required?.includes("base_revision"), contract.name)
        .toBe(contract.name === "apply_project_changes");
    }
  });

  test("require placements when creating or duplicating patterns", () => {
    expect(schemaOf("create_pattern")).toMatchObject({
      required: expect.arrayContaining(["request_id", "kind", "length_bars", "placement"]),
    });
    expect(schemaOf("duplicate_pattern")).toMatchObject({
      required: expect.arrayContaining(["request_id", "pattern_id", "placement"]),
    });
  });

  test("mark only inspection tools read-only and user-authored reads untrusted", () => {
    expect(TOOL_CONTRACTS.map(({ name, annotations }) => [name, annotations])).toEqual(
      expect.arrayContaining([
        ["get_project", { readOnlyHint: true, untrustedContentHint: true }],
        ["get_sound_catalog", { readOnlyHint: true, untrustedContentHint: false }],
        ["get_history", { readOnlyHint: true, untrustedContentHint: true }],
      ]),
    );
    for (const contract of TOOL_CONTRACTS.filter(({ name }) => !readNames.includes(name))) {
      expect(contract.annotations, contract.name).toEqual({
        readOnlyHint: false,
        untrustedContentHint: false,
      });
    }
  });

  test("publish bounded one-based playback position schemas without request IDs", () => {
    expect(schemaOf("play")).toMatchObject({
      additionalProperties: false,
      properties: {
        start_bar: { type: "integer", minimum: 1, maximum: 256 },
        start_step: { type: "integer", minimum: 1, maximum: 16 },
      },
    });
    expect(schemaOf("pause").properties).toEqual({});
    expect(schemaOf("stop").properties).toEqual({});
    expect(schemaOf("seek")).toMatchObject({
      required: ["bar"],
      properties: {
        bar: { type: "integer", minimum: 1, maximum: 256 },
        step: { type: "integer", minimum: 1, maximum: 16 },
      },
    });
  });

  test("publishes optional bounded WAV filenames without request IDs", () => {
    expect(schemaOf("export_wav")).toMatchObject({
      additionalProperties: false,
      properties: {
        file_name: { type: "string", minLength: 1, maxLength: 120 },
      },
    });
    expect(schemaOf("export_wav").required ?? []).not.toContain("file_name");
  });

  test("omit future and deferred tool names", () => {
    const names: readonly string[] = TOOL_CONTRACTS.map(({ name }) => name);
    for (const name of futureAndDeferredNames) expect(names).not.toContain(name);
  });
});

describe("defineWebMCPTool", () => {
  const contract = {
    name: "rename_project" as const,
    title: "Rename project",
    description: "Renames the current project.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
  };

  test("returns INVALID_INPUT with a field path for malformed root input", async () => {
    const tool = defineWebMCPTool(contract, (input) => ({
      name: expectString(input.name, "name"),
    }), ({ name }) => name);

    await expect(tool.execute(null as never, { signal: new AbortController().signal }))
      .resolves.toMatchObject({
        success: false,
        error: { code: "INVALID_INPUT", field: "$", retryable: false },
      });
    await expect(tool.execute({ extra: true }, { signal: new AbortController().signal }))
      .resolves.toMatchObject({
        success: false,
        error: { code: "INVALID_INPUT", field: "extra", retryable: false },
      });
  });

  test("returns EXECUTION_CANCELLED without parsing an already-aborted call", async () => {
    const parse = vi.fn(() => ({}));
    const run = vi.fn();
    const tool = defineWebMCPTool(contract, parse, run);
    const controller = new AbortController();
    controller.abort();

    await expect(tool.execute({}, { signal: controller.signal })).resolves.toEqual({
      success: false,
      error: {
        code: "EXECUTION_CANCELLED",
        message: "The tool call was cancelled.",
        retryable: true,
      },
    });
    expect(parse).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  test("maps unexpected executor errors without exposing their message", async () => {
    const secret = "database password leaked";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const tool = defineWebMCPTool(contract, () => ({ name: "New name" }), () => {
      throw new Error(secret);
    });

    const result = await tool.execute({ name: "New name" }, { signal: new AbortController().signal });

    expect(result).toEqual({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "The tool could not complete because of an internal error.",
        retryable: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });
});

const execute = async (
  store: ReturnType<typeof createStudioStore>,
  name: "get_project" | "get_sound_catalog" | "get_history",
  input: Record<string, unknown>,
) => {
  const tool = createWebMCPTools(store, () => "unused").find((candidate) => candidate.name === name)!;
  return tool.execute(input, { signal: new AbortController().signal }) as Promise<{
    success: boolean;
    result?: Record<string, unknown>;
    error?: { code: string; field?: string };
  }>;
};

describe("inspection tools", () => {
  test("get_project overview returns compact project metadata and counts", async () => {
    const store = createStudioStore(DEMO_PROJECT);

    const response = await execute(store, "get_project", { view: "overview" });

    expect(response).toEqual({
      success: true,
      result: {
        project_revision: 0,
        items: [{
          id: "demo",
          name: "Midnight Polaroid",
          bpm: 118,
          master_volume_db: -3,
          caps: PROJECT_CAPS,
          history_cursor: -1,
          history_count: 0,
          persistence: { status: "unsaved" },
          counts: { tracks: 5, patterns: 5, events: 26, arrangement_clips: 8 },
        }],
      },
    });
    expect(JSON.stringify(response)).not.toContain('"tracks":[');
    expect(JSON.stringify(response)).not.toContain('"patterns":[');
    expect(JSON.stringify(response)).not.toContain('"arrangement":[');
  });

  test("get_project overview exposes public persistence state without internal tokens or errors", async () => {
    const saved = createStudioStoreBase(
      DEMO_PROJECT,
      () => null,
      { status: "saved", updatedAt: 1_700_000_000_000, errorMessage: null },
    );
    const memoryOnly = createStudioStoreBase(
      DEMO_PROJECT,
      () => null,
      { status: "memory-only", updatedAt: null, errorMessage: "private storage detail" },
    );

    await expect(execute(saved, "get_project", { view: "overview" })).resolves.toMatchObject({
      success: true,
      result: { items: [{ persistence: { status: "saved", updated_at: 1_700_000_000_000 } }] },
    });
    const memoryResponse = await execute(memoryOnly, "get_project", { view: "overview" });
    expect(memoryResponse).toMatchObject({
      success: true,
      result: { items: [{ persistence: { status: "memory-only" } }] },
    });
    expect(JSON.stringify(memoryResponse)).not.toContain("latestSaveToken");
    expect(JSON.stringify(memoryResponse)).not.toContain("private storage detail");
  });

  test("get_project tracks preserves project order while filtering and paginating", async () => {
    const store = createStudioStore(DEMO_PROJECT);

    const first = await execute(store, "get_project", {
      view: "tracks", track_ids: ["melody", "drums", "missing"], limit: 1,
    });
    expect(first).toMatchObject({
      success: true,
      result: { project_revision: 0, items: [{
        id: "drums", name: "Neon Kit", kind: "drum", instrument_id: "kit.basic",
        volume_db: -6, pan: 0, muted: false, soloed: false,
      }] },
    });
    expect(first.result).toHaveProperty("next_cursor");

    const second = await execute(store, "get_project", {
      view: "tracks", track_ids: ["melody", "drums", "missing"], limit: 1,
      cursor: first.result!.next_cursor,
    });
    expect(second).toMatchObject({
      success: true,
      result: { project_revision: 0, items: [{ id: "melody" }] },
    });
    expect(second.result).not.toHaveProperty("next_cursor");
  });

  test("get_project patterns keeps project order, filters kind, and enforces page limits", async () => {
    const patterns = [
      { id: "drum-pattern", name: "Drum", kind: "drum" as const, lengthBars: 1 as const, events: [] },
      ...Array.from({ length: 101 }, (_, index) => ({
        id: `pattern-${index}`, name: `Pattern ${index}`, kind: "synth" as const,
        lengthBars: 1 as const, events: [],
      })),
    ];
    const project: Project = { ...DEMO_PROJECT, patterns, arrangement: [] };
    const store = createStudioStore(project);

    const defaultPage = await execute(store, "get_project", { view: "patterns", kind: "synth" });
    expect((defaultPage.result!.items as unknown[])).toHaveLength(20);
    expect((defaultPage.result!.items as Record<string, unknown>[])[0]).toEqual({
      id: "pattern-0", name: "Pattern 0", kind: "synth", length_bars: 1,
      event_count: 0, placement_count: 0,
    });

    const maxPage = await execute(store, "get_project", { view: "patterns", limit: 100 });
    expect((maxPage.result!.items as unknown[])).toHaveLength(100);
    expect(maxPage.result).toHaveProperty("next_cursor");
    await expect(execute(store, "get_project", { view: "patterns", limit: 101 }))
      .resolves.toMatchObject({ success: false, error: { code: "INVALID_INPUT", field: "limit" } });
  });

  test("get_project pattern returns one-based paginated events and a not-found error", async () => {
    const store = createStudioStore(DEMO_PROJECT);

    const first = await execute(store, "get_project", {
      view: "pattern", pattern_id: "neon", limit: 2,
    });
    expect(first).toMatchObject({
      success: true,
      result: {
        project_revision: 0,
        pattern: { id: "neon", name: "Neon beat", kind: "drum", length_bars: 1, event_count: 10 },
        items: [
          { id: "kick-0", sound_id: "kick", step: 1 },
          { id: "kick-4", sound_id: "kick", step: 5 },
        ],
      },
    });

    const second = await execute(store, "get_project", {
      view: "pattern", pattern_id: "neon", limit: 2, cursor: first.result!.next_cursor,
    });
    expect(second).toMatchObject({ success: true, result: { items: [
      { id: "kick-8", step: 9 }, { id: "kick-12", step: 13 },
    ] } });
    await expect(execute(store, "get_project", { view: "pattern", pattern_id: "missing" }))
      .resolves.toMatchObject({ success: false, error: { code: "PATTERN_NOT_FOUND", field: "pattern_id" } });
  });

  test("get_project arrangement orders by track and position and applies inclusive filters", async () => {
    const project: Project = {
      ...DEMO_PROJECT,
      arrangement: [
        { id: "drums-before", trackId: "drums", patternId: "neon", startBar: 0, repeatCount: 1 },
        { id: "bass-late", trackId: "bass", patternId: "orbit", startBar: 4, repeatCount: 1 },
        { id: "drums-second", trackId: "drums", patternId: "neon", startBar: 2, repeatCount: 1 },
        { id: "drums-first", trackId: "drums", patternId: "neon", startBar: 2, repeatCount: 2 },
        { id: "bass-early", trackId: "bass", patternId: "orbit", startBar: 0, repeatCount: 2 },
        { id: "drums-after", trackId: "drums", patternId: "neon", startBar: 6, repeatCount: 1 },
        { id: "melody-filtered", trackId: "melody", patternId: "afterglow", startBar: 2, repeatCount: 1 },
      ],
    };
    const store = createStudioStore(project);

    const response = await execute(store, "get_project", {
      view: "arrangement", track_ids: ["bass", "drums"], start_bar: 3, end_bar: 5,
    });

    expect(response).toMatchObject({ success: true, result: { items: [
      { id: "drums-second", track_id: "drums", pattern_id: "neon", pattern_name: "Neon beat",
        pattern_kind: "drum", pattern_length_bars: 1, start_bar: 3, repeat_count: 1 },
      { id: "drums-first", track_id: "drums", start_bar: 3 },
      { id: "bass-early", track_id: "bass", start_bar: 1 },
      { id: "bass-late", track_id: "bass", start_bar: 5 },
    ] } });
  });

  test("get_sound_catalog filters kinds without changing source order", async () => {
    const store = createStudioStore(DEMO_PROJECT);
    const all = await execute(store, "get_sound_catalog", {});
    const drum = await execute(store, "get_sound_catalog", { kind: "drum" });
    const synth = await execute(store, "get_sound_catalog", { kind: "synth" });

    expect(all).toEqual({ success: true, result: { project_revision: 0, items: [
      { kind: "drum", id: "kit.basic", sound_ids: ["kick", "snare", "hat"] },
      { kind: "synth", id: "synth.bass" },
      { kind: "synth", id: "synth.chord" },
      { kind: "synth", id: "synth.lead" },
      { kind: "synth", id: "synth.pad" },
    ] } });
    expect(drum).toMatchObject({ success: true, result: { items: [
      { kind: "drum", id: "kit.basic", sound_ids: ["kick", "snare", "hat"] },
    ] } });
    expect(synth).toMatchObject({ success: true, result: { items: [
      { id: "synth.bass" }, { id: "synth.chord" }, { id: "synth.lead" }, { id: "synth.pad" },
    ] } });
  });

  test("get_history lists newest first without snapshots and marks replay state", async () => {
    const store = createStudioStore(DEMO_PROJECT);
    store.getState().dispatch({
      id: "command-1", source: "manual", label: "Rename project", kind: "operation",
      operation: { type: "project.update", changes: { name: "First" } },
    });
    store.getState().dispatch({
      id: "command-2", source: "agent", toolName: "set_tempo", label: "Set tempo", kind: "operation",
      operation: { type: "project.update", changes: { bpm: 120 } },
    });
    store.getState().executeHistoryControl({ id: "undo-1", kind: "undo" });
    const [firstId, secondId] = store.getState().history.map(({ id }) => id);

    const response = await execute(store, "get_history", { view: "list" });

    expect(response).toMatchObject({ success: true, result: { project_revision: 3, items: [
      { id: secondId, source: "agent", tool_name: "set_tempo", label: "Set tempo", state: "undone",
        changes: { updated: { project_ids: ["demo"] } } },
      { id: firstId, source: "manual", label: "Rename project", state: "current",
        changes: { updated: { project_ids: ["demo"] } } },
    ] } });
    expect(typeof (response.result!.items as Record<string, unknown>[])[0]!.created_at).toBe("number");
    expect(JSON.stringify(response)).not.toContain('"before"');
    expect(JSON.stringify(response)).not.toContain('"after"');
  });

  test("get_history entry projects only affected entities from the relevant snapshots", async () => {
    const store = createStudioStore(DEMO_PROJECT);
    store.getState().dispatch({
      id: "batch", source: "agent", toolName: "apply_project_changes", label: "Mixed edit", kind: "batch",
      operations: [
        { type: "project.update", changes: { name: "Edited" } },
        { type: "track.create", track: { id: "new-track", name: "New", kind: "synth",
          instrumentId: "synth.pad", volumeDb: 0, pan: 0, muted: false, soloed: false } },
        { type: "synth-notes.update", patternId: "afterglow", updates: [
          { noteId: "lead-1", changes: { midiNote: 74 } },
        ] },
        { type: "drum-hits.delete", patternId: "neon", hitIds: ["kick-0"] },
        { type: "arrangement.delete", clipId: "drums-a" },
      ],
    });
    const entryId = store.getState().history[0]!.id;

    const response = await execute(store, "get_history", { view: "entry", history_entry_id: entryId });

    expect(response).toMatchObject({ success: true, result: { items: [{
      id: entryId,
      action: { kind: "batch", operations: [
        { type: "project.update" }, { type: "track.create" }, { type: "synth-notes.update" },
        { type: "drum-hits.delete" }, { type: "arrangement.delete" },
      ] },
      affected: {
        created: { tracks: [{ id: "new-track", name: "New" }] },
        updated: {
          project: { id: "demo", name: "Edited", bpm: 118, master_volume_db: -3 },
          synth_notes: [{ id: "lead-1", pattern_id: "afterglow", midi_note: 74, start_step: 1, length_steps: 3 }],
        },
        deleted: {
          drum_hits: [{ id: "kick-0", pattern_id: "neon", sound_id: "kick", step: 1 }],
          arrangement_clips: [{ id: "drums-a", track_id: "drums", pattern_id: "neon", start_bar: 1, repeat_count: 4 }],
        },
      },
    }] } });
    expect(JSON.stringify(response)).not.toContain('"before"');
    expect(JSON.stringify(response)).not.toContain('"after"');
    await expect(execute(store, "get_history", { view: "entry", history_entry_id: "missing" }))
      .resolves.toMatchObject({ success: false, error: { code: "HISTORY_ENTRY_NOT_FOUND", field: "history_entry_id" } });
  });

  test("get_history normalizes project, track, and pattern actions for public output", async () => {
    const store = createStudioStore(DEMO_PROJECT);
    store.getState().dispatch({
      id: "structural-batch", source: "agent", label: "Structural batch", kind: "batch",
      operations: [
        { type: "project.update", changes: { name: "Public", bpm: 121, masterVolumeDb: -4 } },
        { type: "track.create", track: { id: "new-track", name: "New track", kind: "synth",
          instrumentId: "synth.pad", volumeDb: -2, pan: 0.25, muted: true, soloed: false, color: "#123456" } },
        { type: "track.update", trackId: "bass", changes: { name: "Bass two", instrumentId: "synth.lead",
          volumeDb: -5, pan: -0.25, muted: true, soloed: true } },
        { type: "track.reorder", trackId: "bass", toIndex: 0 },
        { type: "track.delete", trackId: "pad" },
        { type: "pattern.create", pattern: { id: "new-pattern", name: "New pattern", kind: "drum",
          lengthBars: 1, events: [{ id: "new-hit", soundId: "kick", startStep: 0 }] } },
        { type: "pattern.duplicate", patternId: "afterglow", duplicatePatternId: "afterglow-copy",
          duplicateName: "Afterglow copy", duplicateEventIds: ["copy-1", "copy-2", "copy-3", "copy-4"] },
        { type: "pattern.update", patternId: "orbit", changes: { name: "Orbit two", lengthBars: 4 } },
        { type: "pattern.delete", patternId: "orbit" },
      ],
    });
    const entryId = store.getState().history[0]!.id;

    const response = await execute(store, "get_history", { view: "entry", history_entry_id: entryId });
    const action = (response.result!.items as { action: unknown }[])[0]!.action;

    expect(action).toEqual({ kind: "batch", operations: [
      { type: "project.update", changes: { name: "Public", bpm: 121, master_volume_db: -4 } },
      { type: "track.create", track: { id: "new-track", name: "New track", kind: "synth",
        instrument_id: "synth.pad", volume_db: -2, pan: 0.25, muted: true, soloed: false, color: "#123456" } },
      { type: "track.update", track_id: "bass", changes: { name: "Bass two", instrument_id: "synth.lead",
        volume_db: -5, pan: -0.25, muted: true, soloed: true } },
      { type: "track.reorder", track_id: "bass", position: 1 },
      { type: "track.delete", track_id: "pad" },
      { type: "pattern.create", pattern: { id: "new-pattern", name: "New pattern", kind: "drum",
        length_bars: 1, events: [{ id: "new-hit", sound_id: "kick", step: 1 }] } },
      { type: "pattern.duplicate", pattern_id: "afterglow", duplicate_pattern_id: "afterglow-copy",
        duplicate_name: "Afterglow copy", duplicate_event_ids: ["copy-1", "copy-2", "copy-3", "copy-4"] },
      { type: "pattern.update", pattern_id: "orbit", changes: { name: "Orbit two", length_bars: 4 } },
      { type: "pattern.delete", pattern_id: "orbit" },
    ] });
    expect(JSON.stringify(action)).not.toMatch(/masterVolumeDb|instrumentId|trackId|toIndex|lengthBars|startStep/);
  });

  test("get_history normalizes arrangement and event action coordinates", async () => {
    const store = createStudioStore(DEMO_PROJECT);
    store.getState().dispatch({
      id: "event-batch", source: "agent", label: "Event batch", kind: "batch",
      operations: [
        { type: "arrangement.place", clip: { id: "new-clip", patternId: "neon", trackId: "drums",
          startBar: 8, repeatCount: 2 } },
        { type: "arrangement.update", clipId: "bass-a", changes: {
          patternId: "afterglow", trackId: "melody", startBar: 9, repeatCount: 3,
        } },
        { type: "arrangement.delete", clipId: "drums-b" },
        { type: "drum-hits.add", patternId: "neon", hits: [{ id: "hit-add", soundId: "hat", startStep: 1 }] },
        { type: "drum-hits.update", patternId: "neon", updates: [
          { hitId: "kick-0", changes: { soundId: "snare", startStep: 2 } },
        ] },
        { type: "drum-hits.delete", patternId: "neon", hitIds: ["kick-4"] },
        { type: "synth-notes.add", patternId: "afterglow", notes: [
          { id: "note-add", midiNote: 80, startStep: 1, lengthSteps: 2 },
        ] },
        { type: "synth-notes.update", patternId: "afterglow", updates: [
          { noteId: "lead-1", changes: { midiNote: 74, startStep: 3, lengthSteps: 5 } },
        ] },
        { type: "synth-notes.delete", patternId: "afterglow", noteIds: ["lead-2"] },
      ],
    });
    const entryId = store.getState().history[0]!.id;

    const response = await execute(store, "get_history", { view: "entry", history_entry_id: entryId });
    const action = (response.result!.items as { action: unknown }[])[0]!.action;

    expect(action).toEqual({ kind: "batch", operations: [
      { type: "arrangement.place", clip: { id: "new-clip", pattern_id: "neon", track_id: "drums",
        start_bar: 9, repeat_count: 2 } },
      { type: "arrangement.update", clip_id: "bass-a", changes: {
        pattern_id: "afterglow", track_id: "melody", start_bar: 10, repeat_count: 3,
      } },
      { type: "arrangement.delete", clip_id: "drums-b" },
      { type: "drum-hits.add", pattern_id: "neon", hits: [{ id: "hit-add", sound_id: "hat", step: 2 }] },
      { type: "drum-hits.update", pattern_id: "neon", updates: [
        { hit_id: "kick-0", changes: { sound_id: "snare", step: 3 } },
      ] },
      { type: "drum-hits.delete", pattern_id: "neon", hit_ids: ["kick-4"] },
      { type: "synth-notes.add", pattern_id: "afterglow", notes: [
        { id: "note-add", midi_note: 80, start_step: 2, length_steps: 2 },
      ] },
      { type: "synth-notes.update", pattern_id: "afterglow", updates: [
        { note_id: "lead-1", changes: { midi_note: 74, start_step: 4, length_steps: 5 } },
      ] },
      { type: "synth-notes.delete", pattern_id: "afterglow", note_ids: ["lead-2"] },
    ] });
    expect(JSON.stringify(action)).not.toMatch(/patternId|trackId|clipId|startBar|repeatCount|soundId|startStep|lengthSteps|midiNote|hitId|noteId/);
  });

  test("get_history exposes single and restore actions in public form", async () => {
    const store = createStudioStore(DEMO_PROJECT);
    store.getState().dispatch({
      id: "rename", source: "manual", label: "Rename", kind: "operation",
      operation: { type: "project.update", changes: { name: "Target" } },
    });
    const targetEntryId = store.getState().history[0]!.id;
    store.getState().dispatch({
      id: "tempo", source: "manual", label: "Tempo", kind: "operation",
      operation: { type: "project.update", changes: { bpm: 130 } },
    });
    const singleEntryId = store.getState().history[1]!.id;

    const single = await execute(store, "get_history", { view: "entry", history_entry_id: singleEntryId });
    expect((single.result!.items as { action: unknown }[])[0]!.action).toEqual({
      kind: "operation", operations: [{ type: "project.update", changes: { bpm: 130 } }],
    });

    store.getState().executeRestore({
      id: "restore", source: "agent", toolName: "restore_history", label: "Restore", targetEntryId,
    });
    const restoreEntryId = store.getState().history.at(-1)!.id;
    const restored = await execute(store, "get_history", { view: "entry", history_entry_id: restoreEntryId });
    expect((restored.result!.items as { action: unknown }[])[0]!.action).toEqual({
      type: "restore_history", history_entry_id: targetEntryId,
    });
  });

  test("inspection cursors reject corruption, wrong views, and stale revisions", async () => {
    const store = createStudioStore(DEMO_PROJECT);
    const page = await execute(store, "get_project", { view: "tracks", limit: 1 });
    const cursor = page.result!.next_cursor;

    await expect(execute(store, "get_project", { view: "patterns", cursor }))
      .resolves.toMatchObject({ success: false, error: { code: "INVALID_CURSOR", field: "cursor" } });
    await expect(execute(store, "get_project", { view: "tracks", cursor: "not-base64" }))
      .resolves.toMatchObject({ success: false, error: { code: "INVALID_CURSOR", field: "cursor" } });
    for (const invalidCursor of [
      btoa(JSON.stringify({ revision: 0, view: "get_project:tracks", offset: -1 })),
      btoa(JSON.stringify({ revision: 0, view: "get_project:tracks", offset: 1, extra: true })),
    ]) {
      await expect(execute(store, "get_project", { view: "tracks", cursor: invalidCursor }))
        .resolves.toMatchObject({ success: false, error: { code: "INVALID_CURSOR", field: "cursor" } });
    }
    await expect(execute(store, "get_project", { view: "tracks", cursor: "x".repeat(257) }))
      .resolves.toMatchObject({ success: false, error: { code: "INVALID_CURSOR", field: "cursor" } });

    store.getState().dispatch({
      id: "revise", source: "manual", label: "Rename", kind: "operation",
      operation: { type: "project.update", changes: { name: "Revised" } },
    });
    await expect(execute(store, "get_project", { view: "tracks", cursor }))
      .resolves.toMatchObject({ success: false, error: { code: "INVALID_CURSOR", field: "cursor" } });
  });

  test("inspection calls leave project, selection, history, revision, and status unchanged", async () => {
    const store = createStudioStore(DEMO_PROJECT);
    store.getState().setWebMCPStatus("ready");
    const before = store.getState();
    const snapshot = {
      project: before.project, history: before.history, revision: before.revision,
      historyCursor: before.historyCursor, selectedClipId: before.selectedClipId,
      selectedPatternId: before.selectedPatternId, selectedTrackId: before.selectedTrackId,
      webMCPStatus: before.webMCPStatus,
    };

    await execute(store, "get_project", { view: "overview" });
    await execute(store, "get_sound_catalog", {});
    await execute(store, "get_history", { view: "list" });

    expect(store.getState()).toMatchObject(snapshot);
    expect(store.getState().project).toBe(snapshot.project);
    expect(store.getState().history).toBe(snapshot.history);
  });
});

const executeMutation = async (
  store: ReturnType<typeof createStudioStore>,
  name: WebMCPToolName,
  input: Record<string, unknown>,
  createId: () => string = () => "generated-id",
) => {
  const tool = createWebMCPTools(store, createId).find((candidate) => candidate.name === name)!;
  return tool.execute(input, { signal: new AbortController().signal }) as Promise<{
    success: boolean;
    result?: Record<string, unknown>;
    error?: { code: string; field?: string; message?: string; change_index?: number; current_revision?: number };
  }>;
};

describe("playback controls", () => {
  test("play, pause, seek, and stop share the store audio authority", async () => {
    const { store } = createAudioStore(DEMO_PROJECT, new FakeAudioContext());

    await expect(executeMutation(store, "play", { start_bar: 2, start_step: 3 }))
      .resolves.toEqual({ success: true, result: { status: "playing", bar: 2, step: 3 } });
    await expect(executeMutation(store, "pause", {}))
      .resolves.toEqual({ success: true, result: { status: "paused", bar: 2, step: 3 } });
    await expect(executeMutation(store, "seek", { bar: 1, step: 5 }))
      .resolves.toEqual({ success: true, result: { status: "paused", bar: 1, step: 5 } });
    await expect(executeMutation(store, "stop", {}))
      .resolves.toEqual({ success: true, result: { status: "stopped", bar: 1, step: 1 } });
    expect(store.getState()).toMatchObject({ revision: 0, history: [] });
  });

  test("maps unusable audio and invalid positions to actionable public errors", async () => {
    const empty = createAudioStore({ ...DEMO_PROJECT, arrangement: [] }, new FakeAudioContext());
    await expect(executeMutation(empty.store, "play", {}))
      .resolves.toMatchObject({ success: false, error: { code: "NOTHING_TO_PLAY" } });

    const closed = createAudioStore(DEMO_PROJECT, new FakeAudioContext());
    await closed.engine.dispose();
    await expect(executeMutation(closed.store, "play", {}))
      .resolves.toMatchObject({ success: false, error: { code: "AUDIO_UNAVAILABLE" } });

    const blockedContext = new FakeAudioContext();
    blockedContext.resume = async () => { throw new DOMException("blocked", "NotAllowedError"); };
    const blocked = createAudioStore(DEMO_PROJECT, blockedContext);
    await expect(executeMutation(blocked.store, "play", {}))
      .resolves.toMatchObject({ success: false, error: { code: "AUDIO_BLOCKED" } });

    const available = createAudioStore(DEMO_PROJECT, new FakeAudioContext());
    await expect(executeMutation(available.store, "seek", { bar: 9 }))
      .resolves.toMatchObject({ success: false, error: { code: "OUT_OF_RANGE", field: "bar" } });
    await expect(executeMutation(available.store, "play", { start_step: 17 }))
      .resolves.toMatchObject({ success: false, error: { code: "INVALID_INPUT", field: "start_step" } });
  });

  test("cancelled play invalidates late audio preparation", async () => {
    let finishResume!: () => void;
    const context = new FakeAudioContext();
    context.resume = () => new Promise<void>((resolve) => { finishResume = resolve; });
    const { engine, store } = createAudioStore(DEMO_PROJECT, context);
    const play = createWebMCPTools(store, () => "unused").find((candidate) => candidate.name === "play")!;
    const controller = new AbortController();

    const result = play.execute({}, { signal: controller.signal });
    await vi.waitFor(() => expect(store.getState().audio.pending).toBe(true));
    controller.abort();

    await expect(result).resolves.toMatchObject({ success: false, error: { code: "EXECUTION_CANCELLED" } });
    context.state = "running";
    finishResume();
    await vi.waitFor(() => expect(engine.getSnapshot().status).toBe("stopped"));
  });
});

describe("WAV export", () => {
  test("downloads a frozen project under a sanitized optional filename without changing state", async () => {
    const project = { ...audioProject(), name: "Original" };
    const store = createStudioStore(project);
    vi.stubGlobal("OfflineAudioContext", FakeOfflineAudioContext);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ArrayBuffer(8))));
    vi.stubGlobal("URL", { createObjectURL: () => "blob:wav", revokeObjectURL: vi.fn() });
    let downloadedName = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloadedName = this.download;
    });

    const before = store.getState();
    await expect(executeMutation(
      store,
      "export_wav" as WebMCPToolName,
      { file_name: "  Custom Mix.WAV  " },
    )).resolves.toEqual({ success: true, result: { file_name: "Custom Mix.wav" } });

    expect(downloadedName).toBe("Custom Mix.wav");
    expect(store.getState().project).toBe(before.project);
    expect(store.getState()).toMatchObject({ revision: before.revision, history: before.history });
  });

  test("maps invalid names, cancellation, and render failures to public errors", async () => {
    const store = createStudioStore(audioProject());
    const cancelled = new AbortController();
    cancelled.abort();
    const tool = createWebMCPTools(store, () => "unused")
      .find((candidate) => candidate.name === ("export_wav" as WebMCPToolName));

    await expect(tool?.execute({ file_name: "   " }, { signal: new AbortController().signal }))
      .resolves.toMatchObject({ success: false, error: { code: "INVALID_INPUT", field: "file_name" } });
    await expect(tool?.execute({}, { signal: cancelled.signal }))
      .resolves.toMatchObject({ success: false, error: { code: "EXECUTION_CANCELLED" } });

    vi.stubGlobal("OfflineAudioContext", class extends FakeOfflineAudioContext {
      override startRendering(): Promise<AudioBuffer> {
        return Promise.reject(new Error("render stopped"));
      }
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ArrayBuffer(8))));
    await expect(tool?.execute({}, { signal: new AbortController().signal }))
      .resolves.toMatchObject({ success: false, error: { code: "EXPORT_FAILED", retryable: true } });
  });

  test("cancellation during rendering suppresses the browser download", async () => {
    let resolveRender!: (buffer: AudioBuffer) => void;
    vi.stubGlobal("OfflineAudioContext", class extends FakeOfflineAudioContext {
      override startRendering(): Promise<AudioBuffer> {
        return new Promise((resolve) => { resolveRender = resolve; });
      }
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ArrayBuffer(8))));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const tool = createWebMCPTools(createStudioStore(audioProject()), () => "unused")
      .find((candidate) => candidate.name === "export_wav")!;
    const controller = new AbortController();

    const result = tool.execute({}, { signal: controller.signal });
    await vi.waitFor(() => expect(resolveRender).toBeTypeOf("function"));
    controller.abort();
    resolveRender({
      duration: 1,
      length: 1,
      numberOfChannels: 2,
      sampleRate: 44_100,
      getChannelData: () => new Float32Array(1),
    } as unknown as AudioBuffer);

    await expect(result).resolves.toMatchObject({ success: false, error: { code: "EXECUTION_CANCELLED" } });
    expect(click).not.toHaveBeenCalled();
  });
});

describe("project and track mutations", () => {
  test.each([
    ["rename_project", { name: "  New project  " },
      { type: "project.update", changes: { name: "New project" } }, "Rename project"],
    ["set_tempo", { bpm: 126 },
      { type: "project.update", changes: { bpm: 126 } }, "Set tempo"],
    ["set_master_volume", { volume_db: -8 },
      { type: "project.update", changes: { masterVolumeDb: -8 } }, "Set master volume"],
    ["rename_track", { track_id: "bass", name: "  Sub bass  " },
      { type: "track.update", trackId: "bass", changes: { name: "Sub bass" } }, "Rename track"],
    ["set_track_instrument", { track_id: "bass", instrument_id: "synth.pad" },
      { type: "track.update", trackId: "bass", changes: { instrumentId: "synth.pad" } }, "Set track instrument"],
    ["reorder_track", { track_id: "bass", position: 1 },
      { type: "track.reorder", trackId: "bass", toIndex: 0 }, "Reorder track"],
    ["set_track_mix", { track_id: "bass", volume_db: -4, pan: 0.5 },
      { type: "track.update", trackId: "bass", changes: { volumeDb: -4, pan: 0.5 } }, "Set track mix"],
    ["set_track_mute", { track_id: "bass", muted: true },
      { type: "track.update", trackId: "bass", changes: { muted: true } }, "Set track mute"],
    ["set_track_solo", { track_id: "bass", soloed: true },
      { type: "track.update", trackId: "bass", changes: { soloed: true } }, "Set track solo"],
  ] as const)("%s translates to one attributed canonical operation", async (name, input, operation, label) => {
    const store = createStudioStore(DEMO_PROJECT);

    const response = await executeMutation(store, name, { request_id: "request", base_revision: 0, ...input });

    expect(response).toMatchObject({ success: true, result: {
      changed: true, deduplicated: false, project_revision: 1, history_cursor: 0,
    } });
    expect(response.result).toHaveProperty("history_entry_id");
    expect(store.getState().history[0]).toMatchObject({
      commandId: `webmcp:${name}:request`, source: "agent", toolName: name, label,
      action: { kind: "operation", operation },
    });
  });

  test("create_track appends one initialized track with a generated ID, trimmed/default name, and next color", async () => {
    const store = createStudioStore(DEMO_PROJECT);
    const ids = ["track-custom", "track-default"];
    const createId = vi.fn(() => ids.shift()!);

    const first = await executeMutation(store, "create_track", {
      request_id: "custom", kind: "synth", instrument_id: "synth.pad", name: "  Atmosphere  ",
    }, createId);
    const second = await executeMutation(store, "create_track", {
      request_id: "default", kind: "drum", instrument_id: "kit.basic",
    }, createId);

    expect(first).toMatchObject({ success: true, result: {
      track_id: "track-custom", changes: { created: { track_ids: ["track-custom"] }, updated: {}, deleted: {} },
    } });
    expect(second).toMatchObject({ success: true, result: { track_id: "track-default" } });
    expect(store.getState().project.tracks.slice(-2)).toEqual([
      { id: "track-custom", name: "Atmosphere", kind: "synth", instrumentId: "synth.pad",
        volumeDb: 0, pan: 0, muted: false, soloed: false, color: "#70bd72" },
      { id: "track-default", name: "Basic drums", kind: "drum", instrumentId: "kit.basic",
        volumeDb: 0, pan: 0, muted: false, soloed: false, color: "#50b8b1" },
    ]);
    expect(store.getState().history.map(({ label, source, toolName }) => ({ label, source, toolName }))).toEqual([
      { label: "Create track", source: "agent", toolName: "create_track" },
      { label: "Create track", source: "agent", toolName: "create_track" },
    ]);
  });

  test("delete_track reports dependent clip IDs unless cascading is explicitly authorized", async () => {
    const blockedStore = createStudioStore(DEMO_PROJECT);

    const blocked = await executeMutation(blockedStore, "delete_track", {
      request_id: "blocked", track_id: "drums",
    });

    expect(blocked).toMatchObject({ success: false, error: {
      code: "DEPENDENCIES_EXIST", field: "delete_clips",
    } });
    expect(blocked.error!.message).toContain("drums-a");
    expect(blocked.error!.message).toContain("drums-b");
    expect(blockedStore.getState()).toMatchObject({ revision: 0, history: [] });

    const deleted = await executeMutation(blockedStore, "delete_track", {
      request_id: "cascade", base_revision: 0, track_id: "drums", delete_clips: true,
    });

    expect(deleted).toMatchObject({ success: true, result: {
      changed: true, project_revision: 1,
      changes: { created: {}, updated: {}, deleted: {
        track_ids: ["drums"], pattern_ids: ["neon"],
        arrangement_clip_ids: ["drums-a", "drums-b"],
      } },
    } });
    expect(blockedStore.getState().history[0]).toMatchObject({
      commandId: "webmcp:delete_track:cascade", source: "agent", toolName: "delete_track",
      label: "Delete track", action: { kind: "operation",
        operation: { type: "track.delete", trackId: "drums" } },
    });
  });

  test("explicit mute and solo setters are no-ops when already equal", async () => {
    const store = createStudioStore(DEMO_PROJECT);

    for (const [name, input] of [
      ["set_track_mute", { track_id: "bass", muted: false }],
      ["set_track_solo", { track_id: "bass", soloed: false }],
    ] as const) {
      await expect(executeMutation(store, name, { request_id: name, ...input })).resolves.toEqual({
        success: true,
        result: {
          changed: false, deduplicated: false, project_revision: 0, history_cursor: -1,
          changes: { created: {}, updated: {}, deleted: {} },
        },
      });
    }
    expect(store.getState()).toMatchObject({ revision: 0, history: [] });
  });

  test("replays a successful creation before stale revision checks or ID generation", async () => {
    const store = createStudioStore(DEMO_PROJECT);
    const createId = vi.fn(() => "created-once");
    const input = { request_id: "retry", base_revision: 0, kind: "synth", instrument_id: "synth.pad" };
    const first = await executeMutation(store, "create_track", input, createId);
    store.getState().dispatch({
      id: "manual", source: "manual", label: "Manual edit", kind: "operation",
      operation: { type: "project.update", changes: { bpm: 130 } },
    });

    const retried = await executeMutation(store, "create_track", input, createId);

    expect(first).toMatchObject({ success: true, result: { track_id: "created-once", deduplicated: false } });
    expect(retried).toMatchObject({ success: true, result: {
      track_id: "created-once", changed: true, deduplicated: true, project_revision: 2,
    } });
    expect(createId).toHaveBeenCalledOnce();
    expect(store.getState().project.tracks.filter(({ id }) => id === "created-once")).toHaveLength(1);
  });

  test("replays a successful creation before validating action fields or unknown keys", async () => {
    const store = createStudioStore(DEMO_PROJECT);
    const createId = vi.fn(() => "retained-track");
    const first = await executeMutation(store, "create_track", {
      request_id: "retained", kind: "synth", instrument_id: "synth.pad",
    }, createId);

    for (const retry of [
      { request_id: "retained" },
      { request_id: "retained", kind: 42, instrument_id: [] },
      { request_id: "retained", kind: "drum", instrument_id: "kit.basic", extra: true },
    ]) {
      await expect(executeMutation(store, "create_track", retry, createId)).resolves.toMatchObject({
        success: true, result: { track_id: "retained-track", changed: true, deduplicated: true },
      });
    }
    expect(first).toMatchObject({ success: true, result: { track_id: "retained-track" } });
    expect(createId).toHaveBeenCalledOnce();
    expect(store.getState().project.tracks.filter(({ id }) => id === "retained-track")).toHaveLength(1);
  });

  test("rejects stale revisions before mutation construction for every project and track tool", async () => {
    const cases = [
      ["rename_project", { name: "New" }], ["set_tempo", { bpm: 126 }],
      ["set_master_volume", { volume_db: -4 }],
      ["create_track", { kind: "synth", instrument_id: "synth.pad" }],
      ["rename_track", { track_id: "bass", name: "New" }],
      ["set_track_instrument", { track_id: "bass", instrument_id: "synth.pad" }],
      ["reorder_track", { track_id: "bass", position: 1 }],
      ["set_track_mix", { track_id: "bass", pan: 0.5 }],
      ["set_track_mute", { track_id: "bass", muted: true }],
      ["set_track_solo", { track_id: "bass", soloed: true }],
      ["delete_track", { track_id: "unused" }],
    ] as const;
    const createId = vi.fn(() => "must-not-generate");

    for (const [name, input] of cases) {
      const store = createStudioStore({ ...DEMO_PROJECT, tracks: [...DEMO_PROJECT.tracks, {
        id: "unused", name: "Unused", kind: "synth", instrumentId: "synth.pad",
        volumeDb: 0, pan: 0, muted: false, soloed: false,
      }] });
      store.getState().dispatch({ id: "revise", source: "manual", label: "Revise", kind: "operation",
        operation: { type: "project.update", changes: { bpm: 119 } } });
      await expect(executeMutation(store, name, {
        request_id: `stale-${name}`, base_revision: 0, ...input,
      }, createId)).resolves.toMatchObject({ success: false, error: {
        code: "REVISION_CONFLICT", field: "base_revision", current_revision: 1,
      } });
      expect(store.getState()).toMatchObject({ revision: 1 });
    }
    expect(createId).not.toHaveBeenCalled();
  });

  test("maps canonical domain errors and rejects an empty track mix", async () => {
    const store = createStudioStore(DEMO_PROJECT);

    await expect(executeMutation(store, "set_track_instrument", {
      request_id: "bad-kit", track_id: "drums", instrument_id: "synth.pad",
    })).resolves.toMatchObject({ success: false, error: {
      code: "INCOMPATIBLE_INSTRUMENT", field: "instrument_id", retryable: false,
    } });
    await expect(executeMutation(store, "rename_track", {
      request_id: "missing", track_id: "missing", name: "Do not echo this name",
    })).resolves.toMatchObject({ success: false, error: { code: "TRACK_NOT_FOUND", field: "track_id" } });
    const reorder = await executeMutation(store, "reorder_track", {
      request_id: "bad-position", track_id: "bass", position: 99,
    });
    expect(reorder).toMatchObject({ success: false, error: { code: "OUT_OF_RANGE", field: "position" } });
    expect(JSON.stringify(reorder)).not.toContain("to_index");
    const masterVolume = await executeMutation(store, "set_master_volume", {
      request_id: "bad-master-volume", volume_db: -61,
    });
    expect(masterVolume).toMatchObject({
      success: false, error: { code: "OUT_OF_RANGE", field: "volume_db" },
    });
    expect(JSON.stringify(masterVolume)).not.toContain("master_volume_db");
    const mix = await executeMutation(store, "set_track_mix", { request_id: "empty", track_id: "bass" });
    expect(mix).toMatchObject({ success: false, error: { code: "INVALID_INPUT", field: "$" } });
    expect(JSON.stringify(mix)).not.toContain("Low Orbit");
    expect(store.getState()).toMatchObject({ revision: 0, history: [] });
  });
});

describe("pattern and arrangement mutations", () => {
  test.each([
    ["rename_pattern", { pattern_id: "orbit", name: "  Renamed phrase  " },
      { type: "pattern.update", patternId: "orbit", changes: { name: "Renamed phrase" } }],
    ["resize_pattern", { pattern_id: "afterglow", length_bars: 4 },
      { type: "pattern.update", patternId: "afterglow", changes: { lengthBars: 4 } }],
    ["move_clip", { clip_id: "bass-a", start_bar: 9 },
      { type: "arrangement.update", clipId: "bass-a", changes: { startBar: 8 } }],
    ["change_clip_pattern", { clip_id: "bass-a", pattern_id: "afterglow" },
      { type: "arrangement.update", clipId: "bass-a", changes: { patternId: "afterglow" } }],
    ["set_clip_repeats", { clip_id: "bass-a", repeat_count: 1 },
      { type: "arrangement.update", clipId: "bass-a", changes: { repeatCount: 1 } }],
  ] as const)("%s translates to one attributed canonical operation", async (name, input, operation) => {
    const store = createStudioStore(DEMO_PROJECT);

    const response = await executeMutation(store, name, { request_id: "request", ...input });

    expect(response).toMatchObject({ success: true, result: {
      changed: true, deduplicated: false, project_revision: 1, history_cursor: 0,
    } });
    expect(store.getState().history[0]).toMatchObject({
      commandId: `webmcp:${name}:request`, source: "agent", toolName: name,
      label: TOOL_CONTRACTS.find((candidate) => candidate.name === name)!.title,
      action: { kind: "operation", operation },
    });
  });

  test("create_pattern creates and places an empty pattern with a trimmed or kind-default name", async () => {
    const store = createStudioStore(DEMO_PROJECT);
    const ids = ["beat-pattern", "beat-clip", "melody-pattern", "melody-clip"];
    const createId = vi.fn(() => ids.shift()!);

    const beat = await executeMutation(store, "create_pattern", {
      request_id: "beat", kind: "drum", length_bars: 2,
      placement: { track_id: "drums", start_bar: 9 },
    }, createId);
    const melody = await executeMutation(store, "create_pattern", {
      request_id: "melody", kind: "synth", name: "  Verse lead  ", length_bars: 1,
      placement: { track_id: "melody", start_bar: 9 },
    }, createId);

    expect(beat).toMatchObject({ success: true, result: {
      pattern_id: "beat-pattern", clip_id: "beat-clip", changes: { created: {
        pattern_ids: ["beat-pattern"], arrangement_clip_ids: ["beat-clip"],
      } },
    } });
    expect(melody).toMatchObject({ success: true, result: { pattern_id: "melody-pattern", clip_id: "melody-clip" } });
    expect(store.getState().project.patterns.slice(-2)).toEqual([
      { id: "beat-pattern", name: "New beat", kind: "drum", lengthBars: 2, events: [] },
      { id: "melody-pattern", name: "Verse lead", kind: "synth", lengthBars: 1, events: [] },
    ]);
    expect(store.getState().project.arrangement).toHaveLength(DEMO_PROJECT.arrangement.length + 2);
    expect(store.getState().history.map(({ source, toolName, label }) => ({ source, toolName, label })))
      .toEqual([
        { source: "agent", toolName: "create_pattern", label: "Create pattern" },
        { source: "agent", toolName: "create_pattern", label: "Create pattern" },
      ]);
  });

  test("create_pattern with placement dispatches one validated two-operation batch", async () => {
    const store = createStudioStore(DEMO_PROJECT);
    const ids = ["created-pattern", "created-clip"];

    const response = await executeMutation(store, "create_pattern", {
      request_id: "placed", kind: "synth", length_bars: 2,
      placement: { track_id: "bass", start_bar: 9, repeat_count: 2 },
    }, () => ids.shift()!);

    expect(response).toMatchObject({ success: true, result: {
      pattern_id: "created-pattern", clip_id: "created-clip", project_revision: 1,
      changes: { created: {
        pattern_ids: ["created-pattern"], arrangement_clip_ids: ["created-clip"],
      } },
    } });
    expect(store.getState().history[0]).toMatchObject({
      commandId: "webmcp:create_pattern:placed", source: "agent", toolName: "create_pattern",
      label: "Create pattern", action: { kind: "batch", operations: [
        { type: "pattern.create", pattern: {
          id: "created-pattern", name: "New melody", kind: "synth", lengthBars: 2, events: [],
        } },
        { type: "arrangement.place", clip: {
          id: "created-clip", patternId: "created-pattern", trackId: "bass", startBar: 8, repeatCount: 2,
        } },
      ] },
    });
  });

  test.each([
    ["create_pattern", { kind: "synth", length_bars: 1 }, "placement"],
    ["create_pattern", { kind: "synth", length_bars: 1, placement: "bass" }, "placement"],
    ["duplicate_pattern", { pattern_id: "orbit" }, "placement"],
    ["duplicate_pattern", { pattern_id: "orbit", placement: "bass" }, "placement"],
  ] as const)("%s rejects missing or malformed placement at the direct boundary", async (name, input, field) => {
    const response = await executeMutation(createStudioStore(DEMO_PROJECT), name, {
      request_id: `invalid-${name}-${field}`, ...input,
    });

    expect(response).toMatchObject({ success: false, error: { code: "INVALID_INPUT", field } });
  });

  test.each([
    { type: "create_pattern", kind: "synth", length_bars: 1 },
    { type: "create_pattern", kind: "synth", length_bars: 1, placement: "bass" },
    { type: "duplicate_pattern", pattern_id: { id: "orbit" } },
    { type: "duplicate_pattern", pattern_id: { id: "orbit" }, placement: "bass" },
  ])("rejects missing or malformed placement at the batch boundary", async (change) => {
    const response = await executeMutation(createStudioStore(DEMO_PROJECT), "apply_project_changes", {
      request_id: "invalid-batch-placement",
      base_revision: 0,
      label: "Invalid placement",
      changes: [change, { type: "set_tempo", bpm: 120 }],
    });

    expect(response).toMatchObject({ success: false, error: { code: "INVALID_INPUT", field: "placement", change_index: 0 } });
  });

  test("duplicate_pattern copies every event with fresh IDs and a bounded source-name copy", async () => {
    const sourceName = "x".repeat(40);
    const store = createStudioStore({
      ...DEMO_PROJECT,
      patterns: DEMO_PROJECT.patterns.map((pattern) => pattern.id === "orbit"
        ? { ...pattern, name: sourceName }
        : pattern),
    });
    const ids = ["pattern-copy", "event-1", "event-2", "event-3", "event-4", "copy-clip"];
    const createId = vi.fn(() => ids.shift()!);

    const response = await executeMutation(store, "duplicate_pattern", {
      request_id: "duplicate", pattern_id: "orbit",
      placement: { track_id: "bass", start_bar: 9 },
    }, createId);

    expect(response).toMatchObject({ success: true, result: { pattern_id: "pattern-copy", clip_id: "copy-clip" } });
    expect(store.getState().project.patterns.at(-1)).toMatchObject({
      id: "pattern-copy", name: `${"x".repeat(35)} copy`,
      events: [
        { id: "event-1" }, { id: "event-2" }, { id: "event-3" }, { id: "event-4" },
      ],
    });
    expect(store.getState().history[0]).toMatchObject({
      source: "agent", toolName: "duplicate_pattern", label: "Duplicate pattern",
      action: { kind: "batch", operations: [
        { type: "pattern.duplicate", patternId: "orbit", duplicatePatternId: "pattern-copy",
          duplicateName: `${"x".repeat(35)} copy`,
          duplicateEventIds: ["event-1", "event-2", "event-3", "event-4"] },
        { type: "arrangement.place", clip: { id: "copy-clip", patternId: "pattern-copy", trackId: "bass", startBar: 8, repeatCount: 1 } },
      ] },
    });
    expect(createId).toHaveBeenCalledTimes(6);
  });

  test("duplicate_pattern validates nested placement fields", async () => {
    const response = await executeMutation(createStudioStore(DEMO_PROJECT), "duplicate_pattern", {
      request_id: "invalid-duplicate-placement", pattern_id: "orbit",
      placement: { track_id: "bass" },
    });

    expect(response).toMatchObject({ success: false, error: {
      code: "INVALID_INPUT", field: "placement.start_bar",
    } });
  });

  test("delete_pattern reports dependent clip IDs unless cascading is authorized", async () => {
    const store = createStudioStore(DEMO_PROJECT);

    const blocked = await executeMutation(store, "delete_pattern", {
      request_id: "blocked", pattern_id: "neon",
    });

    expect(blocked).toMatchObject({ success: false, error: {
      code: "DEPENDENCIES_EXIST", field: "delete_clips",
    } });
    expect(blocked.error!.message).toContain("drums-a");
    expect(blocked.error!.message).toContain("drums-b");
    expect(store.getState()).toMatchObject({ revision: 0, history: [] });

    const deleted = await executeMutation(store, "delete_pattern", {
      request_id: "cascade", base_revision: 0, pattern_id: "neon", delete_clips: true,
    });

    expect(deleted).toMatchObject({ success: true, result: { changes: { deleted: {
      pattern_ids: ["neon"], drum_hit_ids: expect.arrayContaining(["kick-0", "hat-14"]),
      arrangement_clip_ids: ["drums-a", "drums-b"],
    } } } });
    expect(store.getState().history[0]).toMatchObject({
      source: "agent", toolName: "delete_pattern", label: "Delete pattern",
      action: { kind: "operation", operation: { type: "pattern.delete", patternId: "neon" } },
    });
  });

  test("place_pattern converts start_bar 1 to startBar 0 and returns its generated clip ID", async () => {
    const store = createStudioStore({ ...DEMO_PROJECT, arrangement: [] });

    const response = await executeMutation(store, "place_pattern", {
      request_id: "place", pattern_id: "neon", track_id: "drums", start_bar: 1, repeat_count: 2,
    }, () => "placed-clip");

    expect(response).toMatchObject({ success: true, result: { clip_id: "placed-clip" } });
    expect(store.getState().history[0]).toMatchObject({
      source: "agent", toolName: "place_pattern", label: "Place pattern",
      action: { kind: "operation", operation: { type: "arrangement.place", clip: {
        id: "placed-clip", patternId: "neon", trackId: "drums", startBar: 0, repeatCount: 2,
      } } },
    });
  });

  test("move_clip requires at least one destination field", async () => {
    const store = createStudioStore(DEMO_PROJECT);

    await expect(executeMutation(store, "move_clip", {
      request_id: "empty", clip_id: "bass-a",
    })).resolves.toMatchObject({ success: false, error: { code: "INVALID_INPUT", field: "$" } });
    expect(store.getState()).toMatchObject({ revision: 0, history: [] });
  });

  test("change_clip_pattern preserves track, start, and repeats", async () => {
    const store = createStudioStore(DEMO_PROJECT);
    const before = store.getState().project.arrangement.find(({ id }) => id === "bass-a")!;

    await executeMutation(store, "change_clip_pattern", {
      request_id: "change", clip_id: "bass-a", pattern_id: "afterglow",
    });

    expect(store.getState().project.arrangement.find(({ id }) => id === "bass-a")).toEqual({
      ...before, patternId: "afterglow",
    });
  });

  test("duplicate_clip starts after the source duration and reports occupied destinations", async () => {
    const availableStore = createStudioStore(DEMO_PROJECT);
    const duplicated = await executeMutation(availableStore, "duplicate_clip", {
      request_id: "duplicate", clip_id: "bass-b",
    }, () => "duplicate-clip");

    expect(duplicated).toMatchObject({ success: true, result: { clip_id: "duplicate-clip" } });
    expect(availableStore.getState().history[0]).toMatchObject({
      source: "agent", toolName: "duplicate_clip", label: "Duplicate clip",
      action: { kind: "operation", operation: { type: "arrangement.place", clip: {
        id: "duplicate-clip", patternId: "orbit", trackId: "bass", startBar: 8, repeatCount: 2,
      } } },
    });

    const occupiedStore = createStudioStore(DEMO_PROJECT);
    const occupied = await executeMutation(occupiedStore, "duplicate_clip", {
      request_id: "occupied", clip_id: "bass-a",
    }, () => "unused-clip");
    expect(occupied).toMatchObject({ success: false, error: { code: "CLIP_OVERLAP" } });
    expect(occupied.error).not.toHaveProperty("field");
    expect(occupiedStore.getState()).toMatchObject({ revision: 0, history: [] });
  });

  test("make_clip_unique duplicates the pattern and redirects only its clip in one command", async () => {
    const store = createStudioStore(DEMO_PROJECT);
    const ids = ["unique-pattern", "unique-1", "unique-2", "unique-3", "unique-4"];

    const response = await executeMutation(store, "make_clip_unique", {
      request_id: "unique", clip_id: "bass-a", pattern_name: "  Solo orbit  ",
    }, () => ids.shift()!);

    expect(response).toMatchObject({ success: true, result: { pattern_id: "unique-pattern" } });
    expect(store.getState().project.arrangement.find(({ id }) => id === "bass-a")!.patternId)
      .toBe("unique-pattern");
    expect(store.getState().project.arrangement.find(({ id }) => id === "bass-b")!.patternId)
      .toBe("orbit");
    expect(store.getState().history[0]).toMatchObject({
      commandId: "webmcp:make_clip_unique:unique", source: "agent", toolName: "make_clip_unique",
      label: "Make clip unique", action: { kind: "batch", operations: [
        { type: "pattern.duplicate", patternId: "orbit", duplicatePatternId: "unique-pattern",
          duplicateName: "Solo orbit", duplicateEventIds: ["unique-1", "unique-2", "unique-3", "unique-4"] },
        { type: "arrangement.update", clipId: "bass-a", changes: { patternId: "unique-pattern" } },
      ] },
    });
  });

  test("make_clip_unique is a no-op for a sole placement and preserves its pattern", async () => {
    const store = createStudioStore(DEMO_PROJECT);

    const response = await executeMutation(store, "make_clip_unique", {
      request_id: "already-unique", clip_id: "pad-a",
    }, () => "must-not-generate");

    expect(response).toMatchObject({ success: true, result: { pattern_id: "night-air", changed: false } });
    expect(store.getState().project.arrangement.find(({ id }) => id === "pad-a")!.patternId).toBe("night-air");
    expect(store.getState().history).toHaveLength(0);
  });

  test("make_clip_unique replays a sole-placement no-op with its existing pattern ID", async () => {
    const store = createStudioStore(DEMO_PROJECT);
    const input = { request_id: "already-unique-retry", clip_id: "pad-a" };

    const first = await executeMutation(store, "make_clip_unique", input, () => "must-not-generate");
    const replayed = await executeMutation(store, "make_clip_unique", input, () => "must-not-generate");

    expect(first).toMatchObject({ success: true, result: { pattern_id: "night-air", changed: false } });
    expect(replayed).toMatchObject({ success: true, result: {
      pattern_id: "night-air", changed: false, deduplicated: true,
    } });
    expect(store.getState().history).toHaveLength(0);
  });

  test("delete_clip removes only the clip and preserves its pattern", async () => {
    const store = createStudioStore(DEMO_PROJECT);

    const response = await executeMutation(store, "delete_clip", {
      request_id: "delete", clip_id: "bass-a",
    });

    expect(response).toMatchObject({ success: true, result: { changes: { deleted: {
      arrangement_clip_ids: ["bass-a"],
    } } } });
    expect(store.getState().project.arrangement.some(({ id }) => id === "bass-a")).toBe(false);
    expect(store.getState().project.patterns.some(({ id }) => id === "orbit")).toBe(true);
    expect(store.getState().history[0]).toMatchObject({
      source: "agent", toolName: "delete_clip", label: "Delete clip",
      action: { kind: "operation", operation: { type: "arrangement.delete", clipId: "bass-a" } },
    });
  });

  test("delete_clip reports the orphan pattern removed with a final placement", async () => {
    const store = createStudioStore(DEMO_PROJECT);

    const response = await executeMutation(store, "delete_clip", {
      request_id: "delete-final", clip_id: "pad-a",
    });

    expect(response).toMatchObject({ success: true, result: { changes: { deleted: {
      arrangement_clip_ids: ["pad-a"], pattern_ids: ["night-air"],
    } } } });
    expect(store.getState().project.patterns.some(({ id }) => id === "night-air")).toBe(false);
  });

  test.each([
    ["rename_pattern", { pattern_id: "orbit", name: "Low Orbit phrase" }],
    ["resize_pattern", { pattern_id: "orbit", length_bars: 2 }],
    ["move_clip", { clip_id: "bass-a", track_id: "bass", start_bar: 1 }],
    ["change_clip_pattern", { clip_id: "bass-a", pattern_id: "orbit" }],
    ["set_clip_repeats", { clip_id: "bass-a", repeat_count: 2 }],
  ] as const)("%s reports a no-op without history when values are already equal", async (name, input) => {
    const store = createStudioStore(DEMO_PROJECT);

    await expect(executeMutation(store, name, { request_id: `noop-${name}`, ...input }))
      .resolves.toEqual({ success: true, result: {
        changed: false, deduplicated: false, project_revision: 0, history_cursor: -1,
        changes: { created: {}, updated: {}, deleted: {} },
      } });
    expect(store.getState()).toMatchObject({ revision: 0, history: [] });
  });

  test.each([
    { name: "create_pattern nested track", tool: "create_pattern", input: {
      kind: "synth", length_bars: 1, placement: { track_id: "missing", start_bar: 9 },
    }, code: "TRACK_NOT_FOUND", field: "placement.track_id" },
    { name: "create_pattern nested start", tool: "create_pattern", input: {
      kind: "synth", length_bars: 1, placement: { track_id: "bass", start_bar: 1 },
    }, code: "CLIP_OVERLAP", field: "placement.start_bar" },
    { name: "create_pattern nested repeats", tool: "create_pattern", input: {
      kind: "synth", length_bars: 2, placement: { track_id: "bass", start_bar: 255, repeat_count: 2 },
    }, code: "OUT_OF_RANGE", field: "placement.repeat_count" },
    { name: "duplicate_pattern name", tool: "duplicate_pattern", input: {
      pattern_id: "orbit", name: "x".repeat(41), placement: { track_id: "bass", start_bar: 9 },
    }, code: "OUT_OF_RANGE", field: "name" },
    { name: "resize_pattern derived overlap", tool: "resize_pattern", input: {
      pattern_id: "neon", length_bars: 2,
    }, code: "CLIP_OVERLAP", field: "length_bars" },
    { name: "move_clip derived end", tool: "move_clip", input: {
      clip_id: "bass-b", start_bar: 254,
    }, code: "OUT_OF_RANGE", field: "start_bar" },
    { name: "change_clip_pattern compatibility", tool: "change_clip_pattern", input: {
      clip_id: "bass-a", pattern_id: "neon",
    }, code: "KIND_MISMATCH", field: "pattern_id" },
    { name: "change_clip_pattern derived overlap", tool: "change_clip_pattern", input: {
      clip_id: "bass-a", pattern_id: "night-air",
    }, code: "CLIP_OVERLAP", field: "pattern_id" },
    { name: "set_clip_repeats derived overlap", tool: "set_clip_repeats", input: {
      clip_id: "bass-a", repeat_count: 3,
    }, code: "CLIP_OVERLAP", field: "repeat_count" },
    { name: "make_clip_unique name", tool: "make_clip_unique", input: {
      clip_id: "bass-a", pattern_name: "x".repeat(41),
    }, code: "OUT_OF_RANGE", field: "pattern_name" },
  ] as const)("maps $name failures to caller-visible fields", async ({ tool, input, code, field }) => {
    const store = createStudioStore(DEMO_PROJECT);
    let id = 0;

    const response = await executeMutation(store, tool, { request_id: `field-${tool}-${field}`, ...input },
      () => `field-id-${++id}`);

    expect(response).toMatchObject({ success: false, error: { code, field } });
    expect(store.getState()).toMatchObject({ revision: 0, history: [] });
  });

  test.each([
    { name: "create_pattern generated pattern ID", tool: "create_pattern",
      input: { kind: "drum", length_bars: 1, placement: { track_id: "drums", start_bar: 9 } }, ids: ["neon"] },
    { name: "create_pattern generated clip ID", tool: "create_pattern",
      input: { kind: "synth", length_bars: 1,
        placement: { track_id: "bass", start_bar: 9 } }, ids: ["new-pattern", "bass-a"] },
    { name: "duplicate_pattern generated pattern ID", tool: "duplicate_pattern",
      input: { pattern_id: "orbit", placement: { track_id: "bass", start_bar: 9 } }, ids: ["neon", "event-1", "event-2", "event-3", "event-4"] },
    { name: "duplicate_pattern generated event IDs", tool: "duplicate_pattern",
      input: { pattern_id: "orbit", placement: { track_id: "bass", start_bar: 9 } }, ids: ["new-pattern", "same", "same", "same", "same"] },
    { name: "place_pattern generated clip ID", tool: "place_pattern",
      input: { pattern_id: "orbit", track_id: "bass", start_bar: 9 }, ids: ["bass-a"] },
    { name: "duplicate_clip generated clip ID", tool: "duplicate_clip",
      input: { clip_id: "bass-b" }, ids: ["bass-a"] },
    { name: "make_clip_unique generated pattern ID", tool: "make_clip_unique",
      input: { clip_id: "bass-a" }, ids: ["neon", "event-1", "event-2", "event-3", "event-4"] },
    { name: "make_clip_unique generated event IDs", tool: "make_clip_unique",
      input: { clip_id: "bass-a" }, ids: ["new-pattern", "same", "same", "same", "same"] },
  ] as const)("omits canonical fields for $name failures", async ({ tool, input, ids: generatedIds }) => {
    const store = createStudioStore(DEMO_PROJECT);
    const ids = [...generatedIds];

    const response = await executeMutation(store, tool, { request_id: `generated-${tool}`, ...input },
      () => ids.shift()!);

    expect(response).toMatchObject({ success: false });
    expect(response.error).not.toHaveProperty("field");
    expect(store.getState()).toMatchObject({ revision: 0, history: [] });
  });

  test.each([
    ["create_pattern", { kind: "drum", length_bars: 1, placement: { track_id: "drums", start_bar: 9 } }],
    ["duplicate_pattern", { pattern_id: "orbit", placement: { track_id: "bass", start_bar: 9 } }],
    ["make_clip_unique", { clip_id: "bass-a" }],
  ] as const)("%s omits the internal patterns capacity field", async (tool, input) => {
    const patterns = [...DEMO_PROJECT.patterns, ...Array.from({
      length: PROJECT_CAPS.maxPatterns - DEMO_PROJECT.patterns.length,
    }, (_, index) => ({
      id: `capacity-pattern-${index}`, name: `Pattern ${index}`, kind: "synth" as const,
      lengthBars: 1 as const, events: [],
    }))];
    const store = createStudioStore({ ...DEMO_PROJECT, patterns });

    const response = await executeMutation(store, tool, { request_id: `capacity-${tool}`, ...input },
      () => "new-id");

    expect(response).toMatchObject({ success: false, error: { code: "CAPACITY_EXCEEDED" } });
    expect(response.error).not.toHaveProperty("field");
  });

  test.each([
    ["place_pattern", { pattern_id: "orbit", track_id: "bass", start_bar: 1 }],
    ["duplicate_clip", { clip_id: "capacity-clip-0" }],
  ] as const)("%s omits the internal arrangement capacity field", async (tool, input) => {
    const trackIds = ["bass", "chords"];
    const arrangement = Array.from({ length: PROJECT_CAPS.maxArrangementClips }, (_, index) => ({
      id: `capacity-clip-${index}`, patternId: "orbit",
      trackId: trackIds[Math.floor(index / PROJECT_CAPS.maxArrangementBars)]!,
      startBar: index % PROJECT_CAPS.maxArrangementBars, repeatCount: 1,
    }));
    const store = createStudioStore({ ...DEMO_PROJECT, arrangement });

    const response = await executeMutation(store, tool, { request_id: `capacity-${tool}`, ...input },
      () => "new-id");

    expect(response).toMatchObject({ success: false, error: { code: "CAPACITY_EXCEEDED" } });
    expect(response.error).not.toHaveProperty("field");
  });

  test.each([
    ["create_pattern", { kind: "drum", length_bars: 3, placement: { track_id: "drums", start_bar: 9 } }, "INVALID_INPUT", "length_bars"],
    ["rename_pattern", { pattern_id: "missing", name: "Missing" }, "PATTERN_NOT_FOUND", "pattern_id"],
    ["resize_pattern", { pattern_id: "orbit", length_bars: 1 }, "OUT_OF_RANGE", "length_bars"],
    ["duplicate_pattern", { pattern_id: "missing", placement: { track_id: "bass", start_bar: 9 } }, "PATTERN_NOT_FOUND", "pattern_id"],
    ["delete_pattern", { pattern_id: "missing" }, "PATTERN_NOT_FOUND", "pattern_id"],
    ["place_pattern", { pattern_id: "neon", track_id: "bass", start_bar: 9 }, "KIND_MISMATCH", "track_id"],
    ["move_clip", { clip_id: "missing", start_bar: 9 }, "CLIP_NOT_FOUND", "clip_id"],
    ["change_clip_pattern", { clip_id: "bass-a", pattern_id: "neon" }, "KIND_MISMATCH", "pattern_id"],
    ["set_clip_repeats", { clip_id: "bass-a", repeat_count: 65 }, "INVALID_INPUT", "repeat_count"],
    ["duplicate_clip", { clip_id: "missing" }, "CLIP_NOT_FOUND", "clip_id"],
    ["make_clip_unique", { clip_id: "missing" }, "CLIP_NOT_FOUND", "clip_id"],
    ["delete_clip", { clip_id: "missing" }, "CLIP_NOT_FOUND", "clip_id"],
  ] as const)("%s returns its expected validation error", async (name, input, code, field) => {
    const store = createStudioStore(DEMO_PROJECT);

    await expect(executeMutation(store, name, { request_id: `invalid-${name}`, ...input }))
      .resolves.toMatchObject({ success: false, error: { code, field } });
    expect(store.getState()).toMatchObject({ revision: 0, history: [] });
  });

  test.each([
    ["create_pattern", { kind: "drum", length_bars: 1, placement: { track_id: "drums", start_bar: 9 } }, false],
    ["rename_pattern", { pattern_id: "orbit", name: "Renamed" }, false],
    ["resize_pattern", { pattern_id: "afterglow", length_bars: 4 }, false],
    ["duplicate_pattern", { pattern_id: "orbit", placement: { track_id: "bass", start_bar: 9 } }, false],
    ["delete_pattern", { pattern_id: "night-air", delete_clips: true }, false],
    ["place_pattern", { pattern_id: "neon", track_id: "drums", start_bar: 1 }, true],
    ["move_clip", { clip_id: "bass-a", start_bar: 9 }, false],
    ["change_clip_pattern", { clip_id: "bass-a", pattern_id: "afterglow" }, false],
    ["set_clip_repeats", { clip_id: "bass-a", repeat_count: 1 }, false],
    ["duplicate_clip", { clip_id: "bass-b" }, false],
    ["make_clip_unique", { clip_id: "bass-a" }, false],
    ["delete_clip", { clip_id: "bass-a" }, false],
  ] as const)("%s replays idempotently before further ID generation or validation", async (name, input, emptyArrangement) => {
    const store = createStudioStore(emptyArrangement ? { ...DEMO_PROJECT, arrangement: [] } : DEMO_PROJECT);
    let id = 0;
    const createId = vi.fn(() => `${name}-id-${++id}`);
    const request = { request_id: `retry-${name}`, ...input };

    const first = await executeMutation(store, name, request, createId);
    const generatedAfterFirst = createId.mock.calls.length;
    const revisionAfterFirst = store.getState().revision;
    const retried = await executeMutation(store, name, {
      request_id: `retry-${name}`, extra: "ignored on replay",
    }, createId);

    expect(first).toMatchObject({ success: true, result: { changed: true, deduplicated: false } });
    expect(retried).toMatchObject({ success: true, result: {
      changed: true, deduplicated: true, project_revision: revisionAfterFirst,
    } });
    expect(createId).toHaveBeenCalledTimes(generatedAfterFirst);
    expect(store.getState().history).toHaveLength(1);
  });
});

describe("event mutations", () => {
  const snapshot = (store: ReturnType<typeof createStudioStore>) => {
    const state = store.getState();
    return {
      project: state.project,
      history: state.history,
      revision: state.revision,
      historyCursor: state.historyCursor,
      selectedClipId: state.selectedClipId,
      selectedPatternId: state.selectedPatternId,
      selectedTrackId: state.selectedTrackId,
    };
  };

  const expectUnchanged = (store: ReturnType<typeof createStudioStore>, before: ReturnType<typeof snapshot>) => {
    const after = store.getState();
    expect(after).toMatchObject(before);
    expect(after.project).toBe(before.project);
    expect(after.history).toBe(before.history);
  };

  test("add_drum_hits converts steps, deduplicates cells, omits existing cells, and reports no-op requests", async () => {
    const store = createStudioStore(DEMO_PROJECT);
    const ids = ["new-snare", "new-hat"];
    const createId = vi.fn(() => ids.shift()!);

    const added = await executeMutation(store, "add_drum_hits", {
      request_id: "add-hits", pattern_id: "neon", hits: [
        { sound_id: "kick", step: 1 },
        { sound_id: "snare", step: 1 },
        { sound_id: "snare", step: 1 },
        { sound_id: "hat", step: 16 },
      ],
    }, createId);

    expect(added).toMatchObject({ success: true, result: {
      changed: true, hit_ids: ["new-snare", "new-hat"],
      changes: { created: { drum_hit_ids: ["new-snare", "new-hat"] } },
    } });
    expect(store.getState().history[0]).toMatchObject({
      toolName: "add_drum_hits", action: { kind: "operation", operation: {
        type: "drum-hits.add", patternId: "neon", hits: [
          { id: "new-snare", soundId: "snare", startStep: 0 },
          { id: "new-hat", soundId: "hat", startStep: 15 },
        ],
      } },
    });

    const noOp = await executeMutation(store, "add_drum_hits", {
      request_id: "existing-hits", pattern_id: "neon", hits: [
        { sound_id: "kick", step: 1 }, { sound_id: "snare", step: 1 },
      ],
    }, createId);
    expect(noOp).toEqual({ success: true, result: {
      changed: false, deduplicated: false, project_revision: 1, history_cursor: 0,
      changes: { created: {}, updated: {}, deleted: {} }, hit_ids: [],
    } });
    expect(createId).toHaveBeenCalledTimes(2);
    expect(store.getState().history).toHaveLength(1);
  });

  test("delete_drum_hits rejects duplicate IDs and hits outside the named pattern atomically", async () => {
    const project: Project = { ...DEMO_PROJECT, patterns: [...DEMO_PROJECT.patterns, {
      id: "other-drums", name: "Other drums", kind: "drum", lengthBars: 1, events: [
        { id: "other-hit", soundId: "kick", startStep: 1 },
      ],
    }] };

    for (const [requestId, hitIds, code, field] of [
      ["duplicate-hits", ["kick-0", "kick-0"], "INVALID_INPUT", "hit_ids"],
      ["foreign-hit", ["kick-0", "other-hit"], "HIT_NOT_FOUND", "hit_ids.1"],
    ] as const) {
      const store = createStudioStore(project);
      store.getState().selectPattern("neon");
      const before = snapshot(store);
      const response = await executeMutation(store, "delete_drum_hits", {
        request_id: requestId, pattern_id: "neon", hit_ids: hitIds,
      });

      expect(response).toMatchObject({ success: false, error: { code, field } });
      expectUnchanged(store, before);
    }
  });

  test("add_notes converts starts, preserves positive lengths, and returns generated IDs in request order", async () => {
    const store = createStudioStore(DEMO_PROJECT);
    const ids = ["note-first", "note-second"];

    const response = await executeMutation(store, "add_notes", {
      request_id: "add-notes", pattern_id: "afterglow", notes: [
        { midi_note: 61, start_step: 2, length_steps: 5 },
        { midi_note: 65, start_step: 17, length_steps: 2 },
      ],
    }, () => ids.shift()!);

    expect(response).toMatchObject({ success: true, result: {
      note_ids: ["note-first", "note-second"],
      changes: { created: { synth_note_ids: ["note-first", "note-second"] } },
    } });
    expect(store.getState().history[0]).toMatchObject({ action: { kind: "operation", operation: {
      type: "synth-notes.add", patternId: "afterglow", notes: [
        { id: "note-first", midiNote: 61, startStep: 1, lengthSteps: 5 },
        { id: "note-second", midiNote: 65, startStep: 16, lengthSteps: 2 },
      ],
    } } });
  });

  test("edit_notes converts changed fields and rejects empty or duplicate note edits", async () => {
    const store = createStudioStore(DEMO_PROJECT);
    const edited = await executeMutation(store, "edit_notes", {
      request_id: "edit-notes", pattern_id: "afterglow", notes: [
        { note_id: "lead-1", midi_note: 70, start_step: 3, length_steps: 4 },
      ],
    });

    expect(edited).toMatchObject({ success: true, result: {
      changes: { updated: { synth_note_ids: ["lead-1"] } },
    } });
    expect(store.getState().history[0]).toMatchObject({ action: { kind: "operation", operation: {
      type: "synth-notes.update", patternId: "afterglow", updates: [{
        noteId: "lead-1", changes: { midiNote: 70, startStep: 2, lengthSteps: 4 },
      }],
    } } });

    for (const [requestId, notes, field] of [
      ["empty-edit", [{ note_id: "lead-2" }], "notes.0"],
      ["duplicate-edit", [{ note_id: "lead-2", midi_note: 75 },
        { note_id: "lead-2", length_steps: 2 }], "notes"],
    ] as const) {
      const before = snapshot(store);
      const response = await executeMutation(store, "edit_notes", {
        request_id: requestId, pattern_id: "afterglow", notes,
      });
      expect(response).toMatchObject({ success: false, error: { code: "INVALID_INPUT", field } });
      expectUnchanged(store, before);
    }
  });

  test("duplicate_notes applies signed offsets, preserves durations, and generates in source order", async () => {
    const store = createStudioStore(DEMO_PROJECT);
    const ids = ["copy-two", "copy-one"];

    const response = await executeMutation(store, "duplicate_notes", {
      request_id: "duplicate-notes", pattern_id: "afterglow",
      note_ids: ["lead-2", "lead-1"], step_offset: 2, pitch_offset: -12,
    }, () => ids.shift()!);

    expect(response).toMatchObject({ success: true, result: { note_ids: ["copy-two", "copy-one"] } });
    expect(store.getState().history[0]).toMatchObject({ action: { kind: "operation", operation: {
      type: "synth-notes.add", patternId: "afterglow", notes: [
        { id: "copy-two", midiNote: 64, startStep: 8, lengthSteps: 3 },
        { id: "copy-one", midiNote: 60, startStep: 2, lengthSteps: 3 },
      ],
    } } });
  });

  test("duplicate_notes resolves every source before generating IDs or mutating", async () => {
    const store = createStudioStore(DEMO_PROJECT);
    store.getState().selectPattern("afterglow");
    const before = snapshot(store);
    const createId = vi.fn(() => "unused");

    const response = await executeMutation(store, "duplicate_notes", {
      request_id: "missing-source", pattern_id: "afterglow",
      note_ids: ["lead-1", "missing"], step_offset: 1, pitch_offset: 0,
    }, createId);

    expect(response).toMatchObject({ success: false, error: {
      code: "NOTE_NOT_FOUND", field: "note_ids.1",
    } });
    expect(createId).not.toHaveBeenCalled();
    expectUnchanged(store, before);
  });

  test("delete_notes rejects duplicate IDs and notes outside the named pattern atomically", async () => {
    for (const [requestId, noteIds, code, field] of [
      ["duplicate-notes", ["lead-1", "lead-1"], "INVALID_INPUT", "note_ids"],
      ["foreign-note", ["lead-1", "bass-1"], "NOTE_NOT_FOUND", "note_ids.1"],
    ] as const) {
      const store = createStudioStore(DEMO_PROJECT);
      store.getState().selectPattern("afterglow");
      const before = snapshot(store);
      const response = await executeMutation(store, "delete_notes", {
        request_id: requestId, pattern_id: "afterglow", note_ids: noteIds,
      });

      expect(response).toMatchObject({ success: false, error: { code, field } });
      expectUnchanged(store, before);
    }
  });

  test.each([
    ["add_drum_hits", "hits", { pattern_id: "neon", hits: [{ sound_id: "hat", step: 1 }] }],
    ["delete_drum_hits", "hit_ids", { pattern_id: "neon", hit_ids: ["kick-0"] }],
    ["add_notes", "notes", { pattern_id: "afterglow", notes: [{ midi_note: 60, start_step: 1, length_steps: 1 }] }],
    ["edit_notes", "notes", { pattern_id: "afterglow", notes: [{ note_id: "lead-1", midi_note: 60 }] }],
    ["duplicate_notes", "note_ids", { pattern_id: "afterglow", note_ids: ["lead-1"], step_offset: 1, pitch_offset: 0 }],
    ["delete_notes", "note_ids", { pattern_id: "afterglow", note_ids: ["lead-1"] }],
  ] as const)("%s enforces 1-512 input items", async (name, field, validInput) => {
    for (const count of [0, 513]) {
      const store = createStudioStore(DEMO_PROJECT);
      const before = snapshot(store);
      const item = (Reflect.get(validInput, field) as readonly unknown[])[0];
      const response = await executeMutation(store, name, {
        request_id: `${name}-${count}`, ...validInput, [field]: Array.from({ length: count }, () => item),
      });

      expect(response).toMatchObject({ success: false, error: { code: "INVALID_INPUT", field } });
      expectUnchanged(store, before);
    }
  });

  test.each([
    ["add_drum_hits", "full-drums", "hits", { pattern_id: "full-drums", hits: [{ sound_id: "snare", step: 2 }] }],
    ["add_notes", "full-notes", "notes", { pattern_id: "full-notes", notes: [{ midi_note: 60, start_step: 1, length_steps: 1 }] }],
    ["duplicate_notes", "full-notes", "note_ids", { pattern_id: "full-notes", note_ids: ["full-note-0"], step_offset: 0, pitch_offset: 1 }],
  ] as const)("%s enforces the 512-event result cap", async (name, patternId, field, input) => {
    const events = Array.from({ length: PROJECT_CAPS.maxEventsPerPattern }, (_, index) => name === "add_drum_hits"
      ? { id: `full-hit-${index}`, soundId: "kick", startStep: 0 }
      : { id: `full-note-${index}`, midiNote: 60, startStep: 0, lengthSteps: 1 });
    const pattern = name === "add_drum_hits"
      ? { id: patternId, name: "Full drums", kind: "drum" as const, lengthBars: 4 as const, events }
      : { id: patternId, name: "Full notes", kind: "synth" as const, lengthBars: 4 as const, events };
    const store = createStudioStore({ ...DEMO_PROJECT, patterns: [...DEMO_PROJECT.patterns, pattern] } as Project);
    const before = snapshot(store);

    const response = await executeMutation(store, name, { request_id: `capacity-${name}`, ...input }, () => "overflow");

    expect(response).toMatchObject({ success: false, error: { code: "CAPACITY_EXCEEDED", field } });
    expectUnchanged(store, before);
  });

  test.each([
    ["add_drum_hits", { pattern_id: "neon", hits: [{ sound_id: "missing", step: 1 }] },
      "INCOMPATIBLE_INSTRUMENT", "hits.0.sound_id"],
    ["add_notes", { pattern_id: "afterglow", notes: [{ midi_note: 60, start_step: 32, length_steps: 2 }] },
      "OUT_OF_RANGE", "notes.0.length_steps"],
    ["edit_notes", { pattern_id: "afterglow", notes: [{ note_id: "lead-4", start_step: 32 }] },
      "OUT_OF_RANGE", "notes"],
    ["duplicate_notes", { pattern_id: "afterglow", note_ids: ["lead-1"], step_offset: 0, pitch_offset: 30 },
      "OUT_OF_RANGE", "pitch_offset"],
    ["duplicate_notes", { pattern_id: "afterglow", note_ids: ["lead-1"], step_offset: -1, pitch_offset: 0 },
      "OUT_OF_RANGE", "step_offset"],
  ] as const)("%s maps canonical validation to caller-visible fields", async (name, input, code, field) => {
    const store = createStudioStore(DEMO_PROJECT);
    const before = snapshot(store);

    const response = await executeMutation(store, name, { request_id: `field-${name}-${field}`, ...input });

    expect(response).toMatchObject({ success: false, error: { code, field } });
    expectUnchanged(store, before);
  });

  test.each([
    ["add_drum_hits", { pattern_id: "neon", hits: [{ sound_id: "snare", step: 1 }] }],
    ["delete_drum_hits", { pattern_id: "neon", hit_ids: ["kick-0"] }],
    ["add_notes", { pattern_id: "afterglow", notes: [{ midi_note: 60, start_step: 1, length_steps: 1 }] }],
    ["edit_notes", { pattern_id: "afterglow", notes: [{ note_id: "lead-1", midi_note: 71 }] }],
    ["duplicate_notes", { pattern_id: "afterglow", note_ids: ["lead-1"], step_offset: 1, pitch_offset: 0 }],
    ["delete_notes", { pattern_id: "afterglow", note_ids: ["lead-1"] }],
  ] as const)("%s replays before parsing or generating further IDs", async (name, input) => {
    const store = createStudioStore(DEMO_PROJECT);
    let id = 0;
    const createId = vi.fn(() => `${name}-id-${++id}`);
    const request = { request_id: `replay-${name}`, ...input };

    const first = await executeMutation(store, name, request, createId);
    const generated = createId.mock.calls.length;
    const revision = store.getState().revision;
    const replayed = await executeMutation(store, name, {
      request_id: `replay-${name}`, extra: "ignored",
    }, createId);

    expect(first).toMatchObject({ success: true, result: { changed: true, deduplicated: false } });
    expect(replayed).toMatchObject({ success: true, result: {
      changed: true, deduplicated: true, project_revision: revision,
    } });
    expect(createId).toHaveBeenCalledTimes(generated);
    expect(store.getState().history).toHaveLength(1);
  });
});

describe("history controls", () => {
  const renameProject = (
    store: ReturnType<typeof createStudioStore>,
    id: string,
    name: string,
  ) => store.getState().dispatch({
    id, source: "manual", label: "Rename project", kind: "operation",
    operation: { type: "project.update", changes: { name } },
  });

  test("undo and redo require request IDs, accept optional revisions, and move without history entries", async () => {
    const store = createStudioStore(DEMO_PROJECT);
    renameProject(store, "rename", "Renamed");
    const history = store.getState().history;

    await expect(executeMutation(store, "undo", {})).resolves.toMatchObject({
      success: false, error: { code: "INVALID_INPUT", field: "request_id" },
    });
    const undone = await executeMutation(store, "undo", {
      request_id: "shared-control", base_revision: 1,
    });
    expect(undone).toEqual({ success: true, result: {
      changed: true, deduplicated: false, project_revision: 2, history_cursor: -1,
      changes: { created: {}, updated: { project_ids: ["demo"] }, deleted: {} },
    } });

    const redone = await executeMutation(store, "redo", { request_id: "shared-control" });
    expect(redone).toEqual({ success: true, result: {
      changed: true, deduplicated: false, project_revision: 3, history_cursor: 0,
      changes: { created: {}, updated: { project_ids: ["demo"] }, deleted: {} },
    } });
    expect(store.getState().history).toBe(history);
    expect(store.getState().history).toHaveLength(1);
  });

  test("undo and redo retries replay before stale revision checks", async () => {
    const store = createStudioStore(DEMO_PROJECT);
    renameProject(store, "first", "First");
    renameProject(store, "second", "Second");

    const undo = await executeMutation(store, "undo", {
      request_id: "retry", base_revision: 2,
    });
    const undoRetry = await executeMutation(store, "undo", {
      request_id: "retry", base_revision: 2,
    });
    expect(undo).toMatchObject({ success: true, result: {
      deduplicated: false, project_revision: 3, history_cursor: 0,
    } });
    expect(undoRetry).toMatchObject({ success: true, result: {
      deduplicated: true, project_revision: 3, history_cursor: 0,
    } });

    const redo = await executeMutation(store, "redo", {
      request_id: "retry", base_revision: 3,
    });
    const redoRetry = await executeMutation(store, "redo", {
      request_id: "retry", base_revision: 3,
    });
    expect(redo).toMatchObject({ success: true, result: {
      deduplicated: false, project_revision: 4, history_cursor: 1,
    } });
    expect(redoRetry).toMatchObject({ success: true, result: {
      deduplicated: true, project_revision: 4, history_cursor: 1,
    } });
    expect(store.getState().project.name).toBe("Second");
    expect(store.getState().history).toHaveLength(2);
  });

  test("unavailable undo and redo return public errors without caching their request IDs", async () => {
    const undoStore = createStudioStore(DEMO_PROJECT);
    await expect(executeMutation(undoStore, "undo", { request_id: "becomes-available" }))
      .resolves.toMatchObject({ success: false, error: { code: "NOTHING_TO_UNDO" } });
    renameProject(undoStore, "rename", "Renamed");
    await expect(executeMutation(undoStore, "undo", { request_id: "becomes-available" }))
      .resolves.toMatchObject({ success: true, result: { deduplicated: false, history_cursor: -1 } });

    const redoStore = createStudioStore(DEMO_PROJECT);
    renameProject(redoStore, "rename", "Renamed");
    await expect(executeMutation(redoStore, "redo", { request_id: "becomes-available" }))
      .resolves.toMatchObject({ success: false, error: { code: "NOTHING_TO_REDO" } });
    redoStore.getState().executeHistoryControl({ id: "manual-undo", kind: "undo" });
    await expect(executeMutation(redoStore, "redo", { request_id: "becomes-available" }))
      .resolves.toMatchObject({ success: true, result: { deduplicated: false, history_cursor: 0 } });
  });

  test("restore_history rejects an unretained history entry", async () => {
    const store = createStudioStore(DEMO_PROJECT);

    await expect(executeMutation(store, "restore_history", {
      request_id: "missing", history_entry_id: "missing",
    })).resolves.toMatchObject({
      success: false, error: { code: "HISTORY_ENTRY_NOT_FOUND", field: "history_entry_id" },
    });
    expect(store.getState()).toMatchObject({ revision: 0, history: [], historyCursor: -1 });
  });

  test("changed restore_history creates one attributed entry that can be undone", async () => {
    const store = createStudioStore(DEMO_PROJECT);
    renameProject(store, "target", "Target");
    const targetEntryId = store.getState().history[0]!.id;
    renameProject(store, "later", "Later");

    const restored = await executeMutation(store, "restore_history", {
      request_id: "restore", base_revision: 2, history_entry_id: targetEntryId,
    });
    expect(restored).toMatchObject({ success: true, result: {
      changed: true, deduplicated: false, project_revision: 3, history_cursor: 2,
      changes: { updated: { project_ids: ["demo"] } },
    } });
    expect(restored.result).toHaveProperty("history_entry_id");
    expect(store.getState().history).toHaveLength(3);
    expect(store.getState().history[2]).toMatchObject({
      commandId: "webmcp:restore_history:restore", source: "agent",
      toolName: "restore_history", label: "Restore history",
      action: { kind: "restore", targetEntryId },
    });
    expect(store.getState().project.name).toBe("Target");

    await expect(executeMutation(store, "undo", {
      request_id: "undo-restore", base_revision: 3,
    })).resolves.toMatchObject({ success: true, result: { project_revision: 4, history_cursor: 1 } });
    expect(store.getState().project.name).toBe("Later");
    expect(store.getState().history).toHaveLength(3);
  });

  test("no-op restore_history is cached without changing revision or truncating redo history", async () => {
    const store = createStudioStore(DEMO_PROJECT);
    renameProject(store, "target", "Target");
    const targetEntryId = store.getState().history[0]!.id;
    renameProject(store, "later", "Later");
    store.getState().executeHistoryControl({ id: "manual-undo", kind: "undo" });
    const history = store.getState().history;

    const restored = await executeMutation(store, "restore_history", {
      request_id: "no-op", base_revision: 3, history_entry_id: targetEntryId,
    });
    expect(restored).toEqual({ success: true, result: {
      changed: false, deduplicated: false, project_revision: 3, history_cursor: 0,
      changes: { created: {}, updated: {}, deleted: {} },
    } });
    expect(store.getState().history).toBe(history);

    await expect(executeMutation(store, "redo", {
      request_id: "redo-after-restore", base_revision: 3,
    })).resolves.toMatchObject({ success: true, result: { project_revision: 4, history_cursor: 1 } });
    const replayed = await executeMutation(store, "restore_history", {
      request_id: "no-op", base_revision: 3, history_entry_id: "ignored-after-replay",
    });
    expect(replayed).toEqual({ success: true, result: {
      changed: false, deduplicated: true, project_revision: 4, history_cursor: 1,
      changes: { created: {}, updated: {}, deleted: {} },
    } });
    expect(store.getState().project.name).toBe("Later");
    expect(store.getState().history).toBe(history);
  });
});

describe("apply_project_changes", () => {
  const noOp = { type: "set_track_solo", track_id: { id: "pad" }, soloed: false } as const;

  const apply = (
    store: ReturnType<typeof createStudioStore>,
    changes: readonly Record<string, unknown>[],
    createId: () => string = () => "batch-id",
    overrides: Record<string, unknown> = {},
  ) => executeMutation(store, "apply_project_changes", {
    request_id: "batch-request",
    base_revision: 0,
    label: "Batch edit",
    changes,
    ...overrides,
  }, createId);

  const snapshot = (store: ReturnType<typeof createStudioStore>) => {
    const state = store.getState();
    return {
      project: state.project,
      revision: state.revision,
      history: state.history,
      historyCursor: state.historyCursor,
      selectedClipId: state.selectedClipId,
      selectedPatternId: state.selectedPatternId,
      selectedTrackId: state.selectedTrackId,
    };
  };

  test("rejects batches outside the 2 to 100 change boundary", async () => {
    await expect(apply(createStudioStore(DEMO_PROJECT), [noOp])).resolves.toMatchObject({
      success: false, error: { code: "BATCH_TOO_SMALL", field: "changes" },
    });
    await expect(apply(createStudioStore(DEMO_PROJECT), Array.from({ length: 101 }, () => noOp)))
      .resolves.toMatchObject({
        success: false, error: { code: "BATCH_TOO_LARGE", field: "changes" },
      });
  });

  test("requires a current base revision", async () => {
    const missing = await executeMutation(createStudioStore(DEMO_PROJECT), "apply_project_changes", {
      request_id: "missing-revision", label: "Missing revision", changes: [noOp, noOp],
    });
    expect(missing).toMatchObject({ success: false, error: { code: "INVALID_INPUT", field: "base_revision" } });

    const store = createStudioStore(DEMO_PROJECT);
    store.getState().dispatch({
      id: "manual", source: "manual", label: "Manual edit", kind: "operation",
      operation: { type: "project.update", changes: { bpm: 119 } },
    });
    const stale = await apply(store, [noOp, noOp]);
    expect(stale).toMatchObject({ success: false, error: {
      code: "REVISION_CONFLICT", field: "base_revision", current_revision: 1,
    } });
  });

  test("resolves a create track, placed pattern, and notes chain in order", async () => {
    const store = createStudioStore(DEMO_PROJECT);
    const ids = ["batch-track", "batch-pattern", "batch-clip", "batch-note"];

    const response = await apply(store, [
      { type: "create_track", ref: "track", kind: "synth", instrument_id: "synth.lead", name: " Lead " },
      { type: "create_pattern", ref: "pattern", kind: "synth", length_bars: 1, name: " Phrase ", placement: {
        clip_ref: "clip", track_id: { ref: "track" }, start_bar: 9,
      } },
      { type: "add_notes", pattern_id: { ref: "pattern" }, notes: [
        { ref: "note", midi_note: 72, start_step: 1, length_steps: 4 },
      ] },
    ], () => ids.shift()!);

    expect(response).toMatchObject({ success: true, result: {
      applied_changes: 3,
      references: { track: "batch-track", pattern: "batch-pattern", note: "batch-note", clip: "batch-clip" },
    } });
    expect(store.getState().project).toMatchObject({
      tracks: expect.arrayContaining([expect.objectContaining({ id: "batch-track", name: "Lead" })]),
      patterns: expect.arrayContaining([expect.objectContaining({ id: "batch-pattern", name: "Phrase", events: [
        { id: "batch-note", midiNote: 72, startStep: 0, lengthSteps: 4 },
      ] })]),
      arrangement: expect.arrayContaining([expect.objectContaining({
        id: "batch-clip", patternId: "batch-pattern", trackId: "batch-track", startBar: 8, repeatCount: 1,
      })]),
    });
  });

  test("duplicates a pattern into a referenced placed clip in a batch", async () => {
    const ids = ["batch-copy", "copy-1", "copy-2", "copy-3", "copy-4", "batch-copy-clip"];
    const response = await apply(createStudioStore(DEMO_PROJECT), [
      { type: "duplicate_pattern", pattern_id: { id: "orbit" }, ref: "copy", placement: {
        clip_ref: "copy_clip", track_id: { id: "bass" }, start_bar: 9,
      } },
      { type: "rename_pattern", pattern_id: { ref: "copy" }, name: "Copied orbit" },
    ], () => ids.shift()!);

    expect(response).toMatchObject({ success: true, result: { references: {
      copy: "batch-copy", copy_clip: "batch-copy-clip",
    } } });
  });

  test.each([
    ["duplicate declaration", [
      { type: "create_track", ref: "same", kind: "synth", instrument_id: "synth.pad" },
      { type: "create_pattern", ref: "same", kind: "synth", length_bars: 1, placement: {
        track_id: { id: "bass" }, start_bar: 9,
      } },
    ], "DUPLICATE_REFERENCE", "ref", 1],
    ["duplicate declaration after an omitted hit", [
      { type: "add_drum_hits", pattern_id: { id: "neon" }, hits: [
        { ref: "same", sound_id: "kick", step: 1 },
      ] },
      { type: "create_track", ref: "same", kind: "synth", instrument_id: "synth.pad" },
    ], "DUPLICATE_REFERENCE", "ref", 1],
    ["invalid syntax", [
      { type: "create_track", ref: "1-invalid", kind: "synth", instrument_id: "synth.pad" }, noOp,
    ], "INVALID_REFERENCE", "ref", 0],
    ["both id and ref", [
      { type: "rename_track", track_id: { id: "bass", ref: "track" }, name: "Bass" }, noOp,
    ], "INVALID_REFERENCE", "track_id", 0],
    ["neither id nor ref", [
      { type: "rename_track", track_id: {}, name: "Bass" }, noOp,
    ], "INVALID_REFERENCE", "track_id", 0],
    ["missing reference", [
      { type: "rename_track", track_id: { ref: "missing" }, name: "Bass" }, noOp,
    ], "INVALID_REFERENCE", "track_id.ref", 0],
    ["forward reference", [
      { type: "rename_track", track_id: { ref: "later" }, name: "Bass" },
      { type: "create_track", ref: "later", kind: "synth", instrument_id: "synth.pad" },
    ], "FORWARD_REFERENCE", "track_id.ref", 0],
  ] as const)("returns an indexed error for %s", async (_name, changes, code, field, changeIndex) => {
    const response = await apply(createStudioStore(DEMO_PROJECT), changes);

    expect(response).toMatchObject({ success: false, error: {
      code, field, change_index: changeIndex,
    } });
  });

  test("maps nested event refs and duplicate note refs to generated IDs", async () => {
    const ids = ["hit-created", "note-created", "copy-created"];
    const response = await apply(createStudioStore(DEMO_PROJECT), [
      { type: "add_drum_hits", pattern_id: { id: "neon" }, hits: [
        { ref: "hit", sound_id: "snare", step: 1 },
      ] },
      { type: "add_notes", pattern_id: { id: "afterglow" }, notes: [
        { ref: "note", midi_note: 60, start_step: 30, length_steps: 2 },
      ] },
      { type: "duplicate_notes", pattern_id: { id: "afterglow" }, note_ids: [{ id: "lead-1" }],
        step_offset: 1, pitch_offset: 0, note_refs: ["copy"] },
    ], () => ids.shift()!);

    expect(response).toMatchObject({ success: true, result: { references: {
      hit: "hit-created", note: "note-created", copy: "copy-created",
    } } });
  });

  test("binds omitted and duplicate drum-hit refs for later changes", async () => {
    const createId = vi.fn(() => "created-hit");
    const response = await apply(createStudioStore(DEMO_PROJECT), [
      { type: "add_drum_hits", pattern_id: { id: "neon" }, hits: [
        { ref: "existing", sound_id: "kick", step: 1 },
        { ref: "created", sound_id: "snare", step: 1 },
        { ref: "duplicate", sound_id: "snare", step: 1 },
      ] },
      { type: "delete_drum_hits", pattern_id: { id: "neon" }, hit_ids: [{ ref: "duplicate" }] },
    ], createId);

    expect(response).toMatchObject({ success: true, result: { references: {
      existing: "kick-0", created: "created-hit", duplicate: "created-hit",
    } } });
    expect(createId).toHaveBeenCalledOnce();
  });

  test("maps create-pattern clip refs and make-unique pattern refs", async () => {
    const ids = ["pattern-created", "clip-created"];
    const response = await apply(createStudioStore(DEMO_PROJECT), [
      { type: "create_pattern", ref: "pattern", kind: "synth", length_bars: 1, placement: {
        clip_ref: "clip", track_id: { id: "bass" }, start_bar: 9,
      } },
      { type: "make_clip_unique", clip_id: { ref: "clip" }, pattern_ref: "unique" },
      { type: "rename_pattern", pattern_id: { ref: "unique" }, name: "Unique phrase" },
    ], () => ids.shift()!);

    expect(response).toMatchObject({ success: true, result: { references: {
      pattern: "pattern-created", clip: "clip-created", unique: "pattern-created",
    } } });
  });

  test("validates each change against the preceding temporary project", async () => {
    const ids = ["new-pattern", "new-clip", "new-note"];
    const response = await apply(createStudioStore(DEMO_PROJECT), [
      { type: "create_pattern", ref: "pattern", kind: "synth", length_bars: 1, placement: {
        track_id: { id: "bass" }, start_bar: 9,
      } },
      { type: "add_notes", pattern_id: { ref: "pattern" }, notes: [
        { ref: "note", midi_note: 60, start_step: 1, length_steps: 1 },
      ] },
    ], () => ids.shift()!);

    expect(response).toMatchObject({ success: true, result: {
      references: { pattern: "new-pattern", note: "new-note" },
    } });
  });

  test("leaves all store state unchanged when a middle change fails", async () => {
    const store = createStudioStore(DEMO_PROJECT);
    store.getState().selectClip("bass-a");
    const before = snapshot(store);
    const response = await apply(store, [
      { type: "create_track", ref: "created", kind: "synth", instrument_id: "synth.pad" },
      { type: "rename_pattern", pattern_id: { id: "missing" }, name: "Missing" },
      noOp,
    ], () => "unused-created-id");

    expect(response).toMatchObject({ success: false, error: {
      code: "PATTERN_NOT_FOUND", field: "pattern_id", change_index: 1,
    } });
    expect(response).not.toHaveProperty("result.references");
    expect(store.getState()).toMatchObject(before);
    expect(store.getState().project).toBe(before.project);
    expect(store.getState().history).toBe(before.history);
  });

  test("dispatches one attributed batch and returns its full result", async () => {
    const store = createStudioStore(DEMO_PROJECT);
    const response = await apply(store, [
      { type: "create_track", ref: "track", kind: "synth", instrument_id: "synth.pad" },
      { type: "rename_project", name: "Batch named" },
    ], () => "created-track", { label: "  Coordinated edit  " });

    expect(response).toMatchObject({ success: true, result: {
      changed: true, deduplicated: false, project_revision: 1, history_cursor: 0,
      applied_changes: 2, references: { track: "created-track" },
    } });
    expect(store.getState().history).toHaveLength(1);
    expect(store.getState().history[0]).toMatchObject({
      commandId: "webmcp:apply_project_changes:batch-request", source: "agent",
      toolName: "apply_project_changes", label: "Coordinated edit",
      action: { kind: "batch", operations: [
        { type: "track.create", track: { id: "created-track" } },
        { type: "project.update", changes: { name: "Batch named" } },
      ] },
    });
  });

  test("replays the retained result before validation, revision checks, or ID generation", async () => {
    const store = createStudioStore(DEMO_PROJECT);
    const createId = vi.fn(() => "retained-track");
    const first = await apply(store, [
      { type: "create_track", ref: "track", kind: "synth", instrument_id: "synth.pad" }, noOp,
    ], createId, { request_id: "retained" });
    expect(Reflect.ownKeys(store.getState().history[0]!.changes)).toEqual(["created", "updated", "deleted"]);
    store.getState().dispatch({
      id: "manual", source: "manual", label: "Manual edit", kind: "operation",
      operation: { type: "project.update", changes: { bpm: 119 } },
    });

    const replayed = await executeMutation(store, "apply_project_changes", {
      request_id: "retained", unexpected: "ignored",
    }, createId);

    expect(first).toMatchObject({ success: true, result: {
      references: { track: "retained-track" }, applied_changes: 2, deduplicated: false,
    } });
    expect(replayed).toMatchObject({ success: true, result: {
      references: { track: "retained-track" }, applied_changes: 2,
      deduplicated: true, project_revision: 2,
    } });
    expect(createId).toHaveBeenCalledOnce();
    expect(store.getState().project.tracks.filter(({ id }) => id === "retained-track")).toHaveLength(1);
    expect(store.getState().history).toHaveLength(2);
  });

  test("allows non-cascading deletes only after all dependencies are removed or reassigned", async () => {
    const trackStore = createStudioStore(DEMO_PROJECT);
    await expect(apply(trackStore, [
      { type: "delete_clip", clip_id: { id: "drums-a" } },
      { type: "delete_clip", clip_id: { id: "drums-b" } },
      { type: "delete_track", track_id: { id: "drums" }, delete_clips: false },
    ])).resolves.toMatchObject({ success: true });

    const patternStore = createStudioStore(DEMO_PROJECT);
    await expect(apply(patternStore, [
      { type: "change_clip_pattern", clip_id: { id: "bass-a" }, pattern_id: { id: "afterglow" } },
      { type: "change_clip_pattern", clip_id: { id: "bass-b" }, pattern_id: { id: "afterglow" } },
      { type: "delete_pattern", pattern_id: { id: "orbit" }, delete_clips: false },
    ])).resolves.toMatchObject({ success: true });

    for (const [change, field] of [
      [{ type: "delete_track", track_id: { id: "drums" }, delete_clips: false }, "delete_clips"],
      [{ type: "delete_pattern", pattern_id: { id: "orbit" }, delete_clips: false }, "delete_clips"],
    ] as const) {
      await expect(apply(createStudioStore(DEMO_PROJECT), [change, noOp])).resolves.toMatchObject({
        success: false, error: { code: "DEPENDENCIES_EXIST", field, change_index: 0 },
      });
    }
  });

  test.each([
    ["rename_project", { name: "Renamed" }, { type: "rename_project", name: "Renamed" }],
    ["set_tempo", { bpm: 126 }, { type: "set_tempo", bpm: 126 }],
    ["set_master_volume", { volume_db: -6 }, { type: "set_master_volume", volume_db: -6 }],
    ["create_track", { kind: "synth", instrument_id: "synth.pad", name: "New" },
      { type: "create_track", kind: "synth", instrument_id: "synth.pad", name: "New" }],
    ["rename_track", { track_id: "bass", name: "Renamed" },
      { type: "rename_track", track_id: { id: "bass" }, name: "Renamed" }],
    ["set_track_instrument", { track_id: "bass", instrument_id: "synth.pad" },
      { type: "set_track_instrument", track_id: { id: "bass" }, instrument_id: "synth.pad" }],
    ["reorder_track", { track_id: "bass", position: 1 },
      { type: "reorder_track", track_id: { id: "bass" }, position: 1 }],
    ["set_track_mix", { track_id: "bass", volume_db: -4, pan: 0.25 },
      { type: "set_track_mix", track_id: { id: "bass" }, volume_db: -4, pan: 0.25 }],
    ["set_track_mute", { track_id: "bass", muted: true },
      { type: "set_track_mute", track_id: { id: "bass" }, muted: true }],
    ["set_track_solo", { track_id: "bass", soloed: true },
      { type: "set_track_solo", track_id: { id: "bass" }, soloed: true }],
    ["delete_track", { track_id: "drums", delete_clips: true },
      { type: "delete_track", track_id: { id: "drums" }, delete_clips: true }],
    ["create_pattern", { kind: "synth", name: "New", length_bars: 1, placement: { track_id: "bass", start_bar: 9 } },
      { type: "create_pattern", kind: "synth", name: "New", length_bars: 1, placement: {
        track_id: { id: "bass" }, start_bar: 9,
      } }],
    ["rename_pattern", { pattern_id: "orbit", name: "Renamed" },
      { type: "rename_pattern", pattern_id: { id: "orbit" }, name: "Renamed" }],
    ["resize_pattern", { pattern_id: "afterglow", length_bars: 4 },
      { type: "resize_pattern", pattern_id: { id: "afterglow" }, length_bars: 4 }],
    ["duplicate_pattern", { pattern_id: "orbit", name: "Copy", placement: { track_id: "bass", start_bar: 9 } },
      { type: "duplicate_pattern", pattern_id: { id: "orbit" }, name: "Copy", placement: {
        track_id: { id: "bass" }, start_bar: 9,
      } }],
    ["delete_pattern", { pattern_id: "night-air", delete_clips: true },
      { type: "delete_pattern", pattern_id: { id: "night-air" }, delete_clips: true }],
    ["place_pattern", { pattern_id: "orbit", track_id: "bass", start_bar: 9 },
      { type: "place_pattern", pattern_id: { id: "orbit" }, track_id: { id: "bass" }, start_bar: 9 }],
    ["move_clip", { clip_id: "bass-b", start_bar: 9 },
      { type: "move_clip", clip_id: { id: "bass-b" }, start_bar: 9 }],
    ["change_clip_pattern", { clip_id: "bass-a", pattern_id: "afterglow" },
      { type: "change_clip_pattern", clip_id: { id: "bass-a" }, pattern_id: { id: "afterglow" } }],
    ["set_clip_repeats", { clip_id: "bass-a", repeat_count: 1 },
      { type: "set_clip_repeats", clip_id: { id: "bass-a" }, repeat_count: 1 }],
    ["duplicate_clip", { clip_id: "bass-b" }, { type: "duplicate_clip", clip_id: { id: "bass-b" } }],
    ["make_clip_unique", { clip_id: "bass-a", pattern_name: "Unique" },
      { type: "make_clip_unique", clip_id: { id: "bass-a" }, pattern_name: "Unique" }],
    ["delete_clip", { clip_id: "bass-a" }, { type: "delete_clip", clip_id: { id: "bass-a" } }],
    ["add_drum_hits", { pattern_id: "neon", hits: [{ sound_id: "snare", step: 1 }] },
      { type: "add_drum_hits", pattern_id: { id: "neon" }, hits: [{ sound_id: "snare", step: 1 }] }],
    ["delete_drum_hits", { pattern_id: "neon", hit_ids: ["kick-0"] },
      { type: "delete_drum_hits", pattern_id: { id: "neon" }, hit_ids: [{ id: "kick-0" }] }],
    ["add_notes", { pattern_id: "afterglow", notes: [{ midi_note: 60, start_step: 30, length_steps: 2 }] },
      { type: "add_notes", pattern_id: { id: "afterglow" }, notes: [{ midi_note: 60, start_step: 30, length_steps: 2 }] }],
    ["edit_notes", { pattern_id: "afterglow", notes: [{ note_id: "lead-1", midi_note: 73 }] },
      { type: "edit_notes", pattern_id: { id: "afterglow" }, notes: [{ note_id: { id: "lead-1" }, midi_note: 73 }] }],
    ["duplicate_notes", { pattern_id: "afterglow", note_ids: ["lead-1"], step_offset: 1, pitch_offset: 0 },
      { type: "duplicate_notes", pattern_id: { id: "afterglow" }, note_ids: [{ id: "lead-1" }], step_offset: 1, pitch_offset: 0 }],
    ["delete_notes", { pattern_id: "afterglow", note_ids: ["lead-1"] },
      { type: "delete_notes", pattern_id: { id: "afterglow" }, note_ids: [{ id: "lead-1" }] }],
  ] as const)("%s matches its direct mutation result", async (name, directInput, batchChange) => {
    const directStore = createStudioStore(DEMO_PROJECT);
    const batchStore = createStudioStore(DEMO_PROJECT);
    const generatedIds = ["generated-1", "generated-2", "generated-3", "generated-4", "generated-5", "generated-6"];
    const directIds = [...generatedIds];
    const batchIds = [...generatedIds];

    const direct = await executeMutation(directStore, name, {
      request_id: `direct-${name}`, ...directInput,
    }, () => directIds.shift()!);
    const batched = await apply(batchStore, [batchChange, noOp], () => batchIds.shift()!, {
      request_id: `batch-${name}`,
    });

    expect(direct, name).toMatchObject({ success: true });
    expect(batched, name).toMatchObject({ success: true });
    expect(batchStore.getState().project, name).toEqual(directStore.getState().project);

    const directAction = directStore.getState().history[0]!.action;
    const batchAction = batchStore.getState().history[0]!.action;
    if (directAction.kind === "restore" || batchAction.kind !== "batch") {
      throw new Error(`Unexpected history action for ${name}.`);
    }
    const directOperations = directAction.kind === "operation"
      ? [directAction.operation]
      : directAction.operations;
    expect(batchAction.operations.slice(0, directOperations.length), name).toEqual(directOperations);
  });

  test.each([
    ["set_tempo", { bpm: 300 }, { type: "set_tempo", bpm: 300 }],
    ["rename_track", { track_id: "missing", name: "Missing" },
      { type: "rename_track", track_id: { id: "missing" }, name: "Missing" }],
    ["rename_pattern", { pattern_id: "missing", name: "Missing" },
      { type: "rename_pattern", pattern_id: { id: "missing" }, name: "Missing" }],
    ["move_clip", { clip_id: "missing", start_bar: 1 },
      { type: "move_clip", clip_id: { id: "missing" }, start_bar: 1 }],
    ["delete_drum_hits", { pattern_id: "neon", hit_ids: ["missing"] },
      { type: "delete_drum_hits", pattern_id: { id: "neon" }, hit_ids: [{ id: "missing" }] }],
    ["delete_notes", { pattern_id: "afterglow", note_ids: ["missing"] },
      { type: "delete_notes", pattern_id: { id: "afterglow" }, note_ids: [{ id: "missing" }] }],
  ] as const)("%s preserves direct validation code and field", async (name, directInput, batchChange) => {
    const direct = await executeMutation(createStudioStore(DEMO_PROJECT), name, {
      request_id: `invalid-direct-${name}`, ...directInput,
    });
    const batched = await apply(createStudioStore(DEMO_PROJECT), [batchChange, noOp], () => "unused", {
      request_id: `invalid-batch-${name}`,
    });

    expect(direct).toMatchObject({ success: false });
    expect(batched).toMatchObject({ success: false, error: { change_index: 0 } });
    expect(batched.error).toMatchObject({ code: direct.error!.code, field: direct.error!.field });
  });
});
