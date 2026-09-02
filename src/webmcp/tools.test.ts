import { describe, expect, test, vi } from "vitest";

import { TOOL_CONTRACTS } from "./contracts.ts";
import { defineWebMCPTool, expectString } from "./tools.ts";

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
