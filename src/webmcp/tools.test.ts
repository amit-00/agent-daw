import { describe, expect, test, vi } from "vitest";

import { PROJECT_CAPS, type Project } from "@/project";
import { DEMO_PROJECT } from "@/data/studio-data";
import { createStudioStore } from "@/stores/studio-store";

import { TOOL_CONTRACTS } from "./contracts.ts";
import { createWebMCPTools, defineWebMCPTool, expectString } from "./tools.ts";

const readNames = ["get_project", "get_sound_catalog", "get_history"];
const futureAndDeferredNames = [
  "play", "pause", "stop", "seek", "export_wav", "duplicate_track",
  "quantize_notes", "transpose_notes", "humanize_notes", "edit_drum_hits",
  "update_track", "apply_operations", "toggle_mute", "get_tracks",
];

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
  test("publish exactly the 36 approved unique tool names", () => {
    const names = TOOL_CONTRACTS.map(({ name }) => name);
    expect(names).toHaveLength(36);
    expect(new Set(names)).toHaveLength(36);
    expect(names).toEqual([
      "get_project", "get_sound_catalog", "get_history",
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
    for (const contract of TOOL_CONTRACTS.filter(({ name }) => !readNames.includes(name))) {
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
          counts: { tracks: 5, patterns: 6, events: 26, arrangement_clips: 8 },
        }],
      },
    });
    expect(JSON.stringify(response)).not.toContain('"tracks":[');
    expect(JSON.stringify(response)).not.toContain('"patterns":[');
    expect(JSON.stringify(response)).not.toContain('"arrangement":[');
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
