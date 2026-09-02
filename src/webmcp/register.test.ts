import { describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";

import { DEMO_PROJECT } from "@/data/studio-data";
import type { Project } from "@/project";
import { createStudioStore as createStudioStoreBase, type StudioState } from "@/stores/studio-store";
import type { WebMCPTool } from "@/webmcp/contracts";
import { getModelContext, registerWebMCPTools, type ModelContext } from "@/webmcp/register";
import { createWebMCPTools } from "@/webmcp/tools";

const createStudioStore = (project: Project): StoreApi<StudioState> => createStudioStoreBase(
  project,
  () => null,
  { status: "unsaved", updatedAt: null, errorMessage: null },
);

const deferredTools = [
  "play", "pause", "stop", "seek", "export_wav",
  "duplicate_track", "quantize_notes", "transpose_notes", "humanize_notes",
  "set_note_pitch", "set_note_start", "set_note_duration",
  "update_track", "update_pattern", "update_clip", "edit_project", "apply_operations",
  "toggle_mute", "toggle_solo", "get_tracks", "get_pattern", "get_arrangement",
  "save_project", "load_project", "reset_project", "clear_storage",
  "select_track", "select_pattern", "open_activity", "close_dialog",
  "compose_song", "generate_pattern", "suggest_chords",
  "set_velocity", "record_audio", "loop_playback",
  "import_audio", "import_project", "export_project",
  "add_effect", "automate_parameter", "sync_project", "share_project",
] as const;

function recordingContext(registerTool: ModelContext["registerTool"] = async () => undefined) {
  const tools = new Map<string, WebMCPTool>();
  const register = vi.fn(registerTool);
  const context: ModelContext = {
    registerTool: async (tool, options) => {
      tools.set(tool.name, tool);
      options.signal.addEventListener("abort", () => tools.delete(tool.name), { once: true });
      await register(tool, options);
    },
  };
  return { context, register, tools };
}

describe("WebMCP browser registration", () => {
  it("returns null when unsupported and the exact model context when supported", () => {
    const supported = document.implementation.createHTMLDocument();
    const context = recordingContext().context;
    Object.defineProperty(supported, "modelContext", { configurable: true, value: context });

    expect(getModelContext(document.implementation.createHTMLDocument())).toBeNull();
    expect(getModelContext(supported)).toBe(context);
  });

  it("registers exactly the 36 current tools with one signal and no origin exposure", async () => {
    const store = createStudioStore(DEMO_PROJECT);
    const { context, register, tools } = recordingContext();
    const registration = registerWebMCPTools(context, createWebMCPTools(store, () => "unused"));

    await registration.ready;

    expect(register).toHaveBeenCalledTimes(36);
    expect(tools).toHaveLength(36);
    const signals = register.mock.calls.map(([, options]) => options.signal);
    expect(new Set(signals)).toHaveLength(1);
    for (const [, options] of register.mock.calls) expect(Object.keys(options)).toEqual(["signal"]);
    for (const name of deferredTools) expect(tools.has(name), name).toBe(false);
  });

  it("unregisters all tools by aborting the shared controller only once", async () => {
    const store = createStudioStore(DEMO_PROJECT);
    const { context, register, tools } = recordingContext();
    const registration = registerWebMCPTools(context, createWebMCPTools(store, () => "unused"));
    await registration.ready;
    const signal = register.mock.calls[0]![1].signal;
    const aborted = vi.fn();
    signal.addEventListener("abort", aborted);

    registration.unregister();
    registration.unregister();

    expect(aborted).toHaveBeenCalledTimes(1);
    expect(tools).toHaveLength(0);
  });

  it("aborts all registrations and rejects ready when one registration fails", async () => {
    const failure = new Error("registration failed");
    const { context, register } = recordingContext(vi.fn(async (tool: WebMCPTool) => {
      if (tool.name === "rename_track") throw failure;
    }));
    const registration = registerWebMCPTools(
      context,
      createWebMCPTools(createStudioStore(DEMO_PROJECT), () => "unused"),
    );

    await expect(registration.ready).rejects.toBe(failure);
    expect(register).toHaveBeenCalledTimes(36);
    expect(register.mock.calls.every(([, options]) => options.signal.aborted)).toBe(true);
  });

  it("aborts prior registrations and rejects ready when a later registration throws synchronously", async () => {
    const failure = new Error("synchronous registration failure");
    const signals: AbortSignal[] = [];
    const context: ModelContext = {
      registerTool(tool, { signal }): Promise<void> {
        signals.push(signal);
        if (tool.name === "rename_track") throw failure;
        return Promise.resolve();
      },
    };
    let registration: ReturnType<typeof registerWebMCPTools> | undefined;

    expect(() => {
      registration = registerWebMCPTools(
        context,
        createWebMCPTools(createStudioStore(DEMO_PROJECT), () => "unused"),
      );
    }).not.toThrow();
    await expect(registration!.ready).rejects.toBe(failure);
    expect(signals.length).toBeGreaterThan(1);
    expect(new Set(signals)).toHaveLength(1);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("captured tools read store state at execution time", async () => {
    const store = createStudioStore(DEMO_PROJECT);
    const { context, tools } = recordingContext();
    const registration = registerWebMCPTools(context, createWebMCPTools(store, () => "unused"));
    await registration.ready;
    store.getState().dispatch({
      id: "manual-change",
      source: "manual",
      label: "Rename project",
      kind: "operation",
      operation: { type: "project.update", changes: { name: "Current name" } },
    });

    await expect(tools.get("get_project")!.execute(
      { view: "overview" },
      { signal: new AbortController().signal },
    )).resolves.toMatchObject({
      success: true,
      result: { project_revision: 1, items: [{ name: "Current name" }] },
    });
  });

  it("returns EXECUTION_CANCELLED before an aborted mutation changes state", async () => {
    const store = createStudioStore(DEMO_PROJECT);
    const { context, tools } = recordingContext();
    const registration = registerWebMCPTools(context, createWebMCPTools(store, () => "unused"));
    await registration.ready;
    const controller = new AbortController();
    controller.abort();

    await expect(tools.get("rename_track")!.execute(
      { request_id: "cancelled", track_id: "bass", name: "Changed" },
      { signal: controller.signal },
    )).resolves.toMatchObject({ success: false, error: { code: "EXECUTION_CANCELLED" } });
    expect(store.getState()).toMatchObject({ revision: 0, history: [] });
    expect(store.getState().project.tracks.find(({ id }) => id === "bass")?.name).toBe("Low Orbit");
  });
});
