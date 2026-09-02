import { describe, expect, test, vi } from "vitest";

import { PROJECT_CAPS, type Project } from "@/project";
import { DEMO_PROJECT } from "@/data/studio-data";
import { createStudioStore } from "@/stores/studio-store";

import { TOOL_CONTRACTS } from "./contracts.ts";
import type { WebMCPToolName } from "./contracts.ts";
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
        { type: "pattern.delete", patternId: "unused-idea" },
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
      { type: "pattern.delete", pattern_id: "unused-idea" },
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
    error?: { code: string; field?: string; message?: string; current_revision?: number };
  }>;
};

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
        track_ids: ["drums"], arrangement_clip_ids: ["drums-a", "drums-b"],
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
