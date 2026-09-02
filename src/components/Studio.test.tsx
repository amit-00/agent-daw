import { useEffect } from "react";
import { renderToString } from "react-dom/server";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";

import { Studio, StudioSession } from "@/components/Studio";
import { Transport } from "@/components/Transport";
import { ActivityPanel } from "@/components/ActivityPanel";
import { DEMO_PROJECT, EMPTY_PROJECT } from "@/data/studio-data";
import { ProjectPersistenceService } from "@/persistence/service";
import { StudioProvider, useStudioStore, useStudioStoreApi, type StudioPersistenceSession } from "@/stores/studio-provider";
import type { StudioState } from "@/stores/studio-store";
import type { WebMCPTool } from "@/webmcp/contracts";
import type { ModelContext } from "@/webmcp/register";
import { audioProject } from "../../test/audio-fixtures";
import { FakeAudioContext, FakeOfflineAudioContext } from "../../test/audio-fakes";

const DATABASE_NAME = "agent-daw";
const DATABASE_VERSION = 1;
const STORE_NAME = "current-project";
const RECORD_KEY = "current";
const TEST_PERSISTENCE_SESSION: StudioPersistenceSession = {
  service: null,
  baseline: { status: "unsaved", updatedAt: null, errorMessage: null },
};

const indexedDBWithRawRecord = async (value: unknown): Promise<IDBFactory> => {
  const indexedDB = new IDBFactory();
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const transaction = database.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).put(value, RECORD_KEY);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  database.close();
  return indexedDB;
};

const indexedDBWithProject = (project: typeof DEMO_PROJECT): Promise<IDBFactory> =>
  indexedDBWithRawRecord({ project, updatedAt: 1_700_000_000_000 });

const failingReadwriteFactory = (indexedDB: IDBFactory): IDBFactory => new Proxy(indexedDB, {
  get(target, property, receiver) {
    if (property !== "open") return Reflect.get(target, property, receiver);
    return (name: string, version?: number): IDBOpenDBRequest => {
      const request = version === undefined ? target.open(name) : target.open(name, version);
      request.addEventListener("success", () => {
        const database = request.result;
        const transaction = database.transaction.bind(database);
        Object.defineProperty(database, "transaction", {
          configurable: true,
          value: (storeNames: string | string[], mode: IDBTransactionMode = "readonly",
            options?: IDBTransactionOptions): IDBTransaction => {
            if (mode === "readwrite") throw new DOMException("Storage denied", "SecurityError");
            return options === undefined
              ? transaction(storeNames, mode)
              : transaction(storeNames, mode, options);
          },
        });
      }, { once: true });
      return request;
    };
  },
});

const failingFirstOpenFactory = (indexedDB: IDBFactory): IDBFactory => {
  let shouldFail = true;
  return new Proxy(indexedDB, {
    get(target, property, receiver) {
      if (property !== "open") return Reflect.get(target, property, receiver);
      return (name: string, version?: number): IDBOpenDBRequest => {
        if (shouldFail) {
          shouldFail = false;
          throw new DOMException("Storage denied", "SecurityError");
        }
        return version === undefined ? target.open(name) : target.open(name, version);
      };
    },
  });
};

function StoreApiProbe({ onStore }: Readonly<{
  onStore: (store: StoreApi<StudioState>) => void;
}>): null {
  const store = useStudioStoreApi();
  useEffect(() => { onStore(store); }, [onStore, store]);
  return null;
}

let sessionStore: StoreApi<StudioState> | undefined;

function renderSession(project: typeof DEMO_PROJECT): void {
  render(<StudioProvider initialProject={project} persistenceSession={TEST_PERSISTENCE_SESSION}><StudioSession /><StoreApiProbe onStore={(value) => { sessionStore = value; }} /></StudioProvider>);
}

function installModelContext(
  register: (tool: WebMCPTool, options: { readonly signal: AbortSignal }) => Promise<void> = async () => undefined,
): { readonly tools: Map<string, WebMCPTool>; readonly signals: AbortSignal[] } {
  const tools = new Map<string, WebMCPTool>();
  const signals: AbortSignal[] = [];
  const context: ModelContext = {
    registerTool: (tool, options) => {
      tools.set(tool.name, tool);
      signals.push(options.signal);
      options.signal.addEventListener("abort", () => tools.delete(tool.name), { once: true });
      return register(tool, options);
    },
  };
  Object.defineProperty(document, "modelContext", { configurable: true, value: context });
  return { tools, signals };
}

const webMCPStatus = (value: "Unsupported" | "Registering" | "Ready" | "Failed") =>
  screen.getByRole("status", { name: `WebMCP status: ${value}` });

beforeEach(() => {
  HTMLDivElement.prototype.setPointerCapture = vi.fn();
  HTMLDivElement.prototype.hasPointerCapture = () => false;
  HTMLDivElement.prototype.releasePointerCapture = vi.fn();
  HTMLDialogElement.prototype.showModal = function (): void { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function (): void { this.removeAttribute("open"); };
});
afterEach(() => {
  Reflect.deleteProperty(document, "modelContext");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Studio persistence bootstrap", () => {
  it("registers WebMCP only after persistence bootstrap completes", async () => {
    let finishLoad!: (result: Awaited<ReturnType<ProjectPersistenceService["load"]>>) => void;
    const pendingLoad = new Promise<Awaited<ReturnType<ProjectPersistenceService["load"]>>>((resolve) => {
      finishLoad = resolve;
    });
    vi.spyOn(ProjectPersistenceService.prototype, "load").mockReturnValue(pendingLoad);
    const registration = installModelContext();

    render(<Studio initialProject={DEMO_PROJECT} />);
    expect(screen.getByRole("status", { name: "Loading project" })).toBeVisible();
    expect(registration.tools).toHaveLength(0);

    await act(async () => finishLoad({ status: "empty" }));
    await waitFor(() => expect(registration.tools).toHaveLength(40));
  });

  it("does not register WebMCP while corrupt storage requires recovery", async () => {
    vi.stubGlobal("indexedDB", await indexedDBWithRawRecord({ project: { broken: true }, updatedAt: 1 }));
    const registration = installModelContext();

    render(<Studio initialProject={DEMO_PROJECT} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/cannot be loaded/i);
    expect(registration.tools).toHaveLength(0);
  });

  it("keeps server and browser initial renders loading until bootstrap resolves", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const serverMarkup = renderToString(<Studio initialProject={DEMO_PROJECT} />);
    expect(serverMarkup).toContain('aria-label="Loading project"');
    expect(serverMarkup).not.toContain('id="studio"');

    vi.stubGlobal("indexedDB", new IDBFactory());
    render(<Studio initialProject={DEMO_PROJECT} />);
    expect(screen.getByRole("status", { name: "Loading project" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "Song arrangement" })).not.toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Song arrangement" })).toBeVisible();
  });

  it("shows loading before mounting a loaded project", async () => {
    const savedProject = { ...DEMO_PROJECT, name: "Persisted Session" };
    vi.stubGlobal("indexedDB", await indexedDBWithProject(savedProject));

    render(<Studio initialProject={DEMO_PROJECT} />);

    expect(screen.getByRole("status", { name: "Loading project" })).toBeVisible();
    expect(await screen.findByText(savedProject.name)).toBeVisible();
    expect(screen.getByText(/Saved locally/)).toBeVisible();
  });

  it("opens the unsaved demo when storage is empty", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());

    render(<Studio initialProject={DEMO_PROJECT} />);

    expect(await screen.findByText(DEMO_PROJECT.name)).toBeVisible();
    expect(screen.getByText(/Not saved yet/)).toBeVisible();
  });

  it("blocks a present undefined record until explicit clear", async () => {
    vi.stubGlobal("indexedDB", await indexedDBWithRawRecord(undefined));

    render(<Studio initialProject={DEMO_PROJECT} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/cannot be loaded/i);
    expect(screen.queryByRole("region", { name: "Song arrangement" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear stored project" })).toBeEnabled();
  });

  it("blocks editing until corrupt storage is explicitly cleared", async () => {
    vi.stubGlobal("indexedDB", await indexedDBWithRawRecord({ project: { broken: true }, updatedAt: 1 }));
    const user = userEvent.setup();

    render(<Studio initialProject={DEMO_PROJECT} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/cannot be loaded/i);
    expect(screen.queryByRole("region", { name: "Song arrangement" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear stored project" }));
    expect(await screen.findByRole("region", { name: "Song arrangement" })).toBeVisible();
    expect(screen.getByText(/Not saved yet/)).toBeVisible();
  });

  it("blocks unsupported schema until it is explicitly cleared", async () => {
    vi.stubGlobal("indexedDB", await indexedDBWithRawRecord({
      project: { ...DEMO_PROJECT, schemaVersion: 3 },
      updatedAt: 1,
    }));

    render(<Studio initialProject={DEMO_PROJECT} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/schema 3 is unsupported/i);
    expect(screen.queryByRole("region", { name: "Song arrangement" })).not.toBeInTheDocument();
  });

  it("keeps corrupt storage blocked when clear fails", async () => {
    const indexedDB = await indexedDBWithRawRecord({ project: { broken: true }, updatedAt: 1 });
    vi.stubGlobal("indexedDB", failingReadwriteFactory(indexedDB));
    const user = userEvent.setup();

    render(<Studio initialProject={DEMO_PROJECT} />);
    await user.click(await screen.findByRole("button", { name: "Clear stored project" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Project clear cannot access IndexedDB/i);
    expect(screen.queryByRole("region", { name: "Song arrangement" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear stored project" })).toBeEnabled();
  });

  it("opens a memory-only demo after a non-recovery storage failure", async () => {
    vi.stubGlobal("indexedDB", failingFirstOpenFactory(new IDBFactory()));

    render(<Studio initialProject={DEMO_PROJECT} />);

    expect(await screen.findByRole("region", { name: "Song arrangement" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(/Project load cannot access IndexedDB/i);
    expect(screen.getByText(/In memory/)).toBeVisible();
  });

  it("opens a memory-only demo when IndexedDB is absent", async () => {
    vi.stubGlobal("indexedDB", undefined);

    render(<Studio initialProject={DEMO_PROJECT} />);

    expect(await screen.findByRole("region", { name: "Song arrangement" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(/browser storage is unavailable/i);
    expect(screen.getByText(/In memory/)).toBeVisible();
  });
});

describe("Studio persistence autosave", () => {
  it("routes changed WebMCP projects through audio replacement and autosave once", async () => {
    const service = new ProjectPersistenceService({ indexedDB: new IDBFactory(), debounceMs: 0 });
    const scheduleSave = vi.spyOn(service, "scheduleSave").mockResolvedValue({ status: "saved", updatedAt: 1 });
    const registration = installModelContext();
    const project = { ...DEMO_PROJECT, arrangement: [DEMO_PROJECT.arrangement[0]!] };
    let store: StoreApi<StudioState> | undefined;
    render(
      <StudioProvider initialProject={project} persistenceSession={{ ...TEST_PERSISTENCE_SESSION, service }}>
        <StudioSession />
        <StoreApiProbe onStore={(value) => { store = value; }} />
      </StudioProvider>,
    );
    await waitFor(() => expect(webMCPStatus("Ready")).toBeVisible());
    expect(store!.getState().audio.snapshot.arrangementEndStep).toBeGreaterThan(0);

    const deleteClip = registration.tools.get("delete_clip")!;
    await act(async () => {
      await deleteClip.execute(
        { request_id: "delete-only-clip", clip_id: "drums-a" },
        { signal: new AbortController().signal },
      );
    });

    expect(store!.getState().audio.snapshot.arrangementEndStep).toBe(0);
    expect(scheduleSave).toHaveBeenCalledTimes(1);

    await act(async () => {
      await deleteClip.execute(
        { request_id: "delete-only-clip", clip_id: "missing" },
        { signal: new AbortController().signal },
      );
      await deleteClip.execute(
        { request_id: "missing-clip", clip_id: "missing" },
        { signal: new AbortController().signal },
      );
    });
    expect(scheduleSave).toHaveBeenCalledTimes(1);
  });

  it("autosaves every changed project identity and ignores no-op publication", async () => {
    const indexedDB = new IDBFactory();
    vi.stubGlobal("indexedDB", indexedDB);
    const user = userEvent.setup();
    render(<Studio initialProject={DEMO_PROJECT} />);
    await screen.findByRole("region", { name: "Song arrangement" });

    await user.click(screen.getByRole("button", { name: "Mixer" }));
    const masterVolume = screen.getByRole("spinbutton", { name: "Master volume value" });
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");

    fireEvent.change(masterVolume, { target: { value: String(DEMO_PROJECT.masterVolumeDb) } });
    fireEvent.keyDown(masterVolume, { key: "Enter" });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    const afterNoOp = await new ProjectPersistenceService({ indexedDB, debounceMs: 0 }).load();
    expect(afterNoOp.status).toBe("empty");

    fireEvent.change(masterVolume, { target: { value: "-6" } });
    fireEvent.keyDown(masterVolume, { key: "Enter" });
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    expect(await screen.findByText(/Saved locally/)).toBeVisible();
    const loaded = await new ProjectPersistenceService({ indexedDB, debounceMs: 0 }).load();
    expect(loaded.status === "loaded" ? loaded.project.masterVolumeDb : null).toBe(-6);
  });

  it("retries the bootstrap service after a memory-only load failure", async () => {
    const indexedDB = new IDBFactory();
    vi.stubGlobal("indexedDB", failingFirstOpenFactory(indexedDB));
    const user = userEvent.setup();
    render(<Studio initialProject={DEMO_PROJECT} />);
    await screen.findByRole("region", { name: "Song arrangement" });
    expect(screen.getByRole("alert")).toHaveTextContent(/Project load cannot access IndexedDB/i);

    await user.click(screen.getByRole("button", { name: "Mixer" }));
    const masterVolume = screen.getByRole("spinbutton", { name: "Master volume value" });
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    fireEvent.change(masterVolume, { target: { value: "-7" } });
    fireEvent.keyDown(masterVolume, { key: "Enter" });
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    expect(await screen.findByText(/Saved locally/)).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    const loaded = await new ProjectPersistenceService({ indexedDB, debounceMs: 0 }).load();
    expect(loaded.status === "loaded" ? loaded.project.masterVolumeDb : null).toBe(-7);
  });

  it("logs rejected save scheduling and shows only retry guidance", async () => {
    const service = new ProjectPersistenceService({ indexedDB: new IDBFactory(), debounceMs: 0 });
    const rejection = new Error("private scheduling detail");
    vi.spyOn(service, "scheduleSave").mockRejectedValue(rejection);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let store: StoreApi<StudioState> | undefined;
    render(
      <StudioProvider initialProject={DEMO_PROJECT} persistenceSession={{ ...TEST_PERSISTENCE_SESSION, service }}>
        <StudioSession />
        <StoreApiProbe onStore={(value) => { store = value; }} />
      </StudioProvider>,
    );

    act(() => store!.getState().setMasterVolume(-6));

    await waitFor(() => expect(store!.getState().persistence.status).toBe("failed"));
    expect(screen.getByRole("alert")).toHaveTextContent(/Keep this page open and try another edit/);
    expect(screen.getByRole("alert")).not.toHaveTextContent(rejection.message);
    expect(log).toHaveBeenCalledWith("Project persistence failed unexpectedly", rejection);
  });

  it("logs a rejected hidden-document flush and shows only retry guidance", async () => {
    const service = new ProjectPersistenceService({ indexedDB: new IDBFactory(), debounceMs: 0 });
    vi.spyOn(service, "scheduleSave").mockResolvedValue({ status: "saved", updatedAt: 1 });
    const rejection = new Error("private flush detail");
    vi.spyOn(service, "flush").mockRejectedValue(rejection);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    let store: StoreApi<StudioState> | undefined;
    render(
      <StudioProvider initialProject={DEMO_PROJECT} persistenceSession={{ ...TEST_PERSISTENCE_SESSION, service }}>
        <StudioSession />
        <StoreApiProbe onStore={(value) => { store = value; }} />
      </StudioProvider>,
    );

    act(() => {
      store!.getState().setMasterVolume(-6);
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(store!.getState().persistence.status).toBe("failed"));
    expect(screen.getByRole("alert")).toHaveTextContent(/Keep this page open and try another edit/);
    expect(screen.getByRole("alert")).not.toHaveTextContent(rejection.message);
    expect(log).toHaveBeenCalledWith("Project persistence failed unexpectedly", rejection);
  });
});

describe("Studio", () => {
  it("plays, pauses, and stops from the transport", async () => {
    const user = userEvent.setup();
    const contexts: FakeAudioContext[] = [];
    vi.stubGlobal("AudioContext", class extends FakeAudioContext {
      constructor() {
        super();
        contexts.push(this);
      }
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ArrayBuffer(8))));
    renderSession(DEMO_PROJECT);

    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(contexts).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Pause" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(screen.getByLabelText("Playback position")).toHaveTextContent("0:00.0");
  });

  it("reflects WebMCP playback controls in the visible transport", async () => {
    const registration = installModelContext();
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ArrayBuffer(8))));
    renderSession(DEMO_PROJECT);
    await waitFor(() => expect(webMCPStatus("Ready")).toBeVisible());

    await act(async () => {
      await registration.tools.get("seek")!.execute(
        { bar: 2, step: 3 },
        { signal: new AbortController().signal },
      );
      await registration.tools.get("play")!.execute(
        {},
        { signal: new AbortController().signal },
      );
    });
    expect(sessionStore!.getState().audio.snapshot.positionStep).toBe(18);
    expect(screen.getByRole("button", { name: "Pause" })).toBeEnabled();

    await act(async () => {
      await registration.tools.get("pause")!.execute(
        {},
        { signal: new AbortController().signal },
      );
    });
    expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();
    expect(sessionStore!.getState()).toMatchObject({ revision: 0, history: [] });
  });

  it("lets Stop cancel playback while audio is still preparing", async () => {
    const user = userEvent.setup();
    let finishResume: (() => void) | undefined;
    class SlowResumeAudioContext extends FakeAudioContext {
      resume(): Promise<void> {
        return new Promise((resolve) => {
          finishResume = () => {
            this.state = "running";
            resolve();
          };
        });
      }
    }
    vi.stubGlobal("AudioContext", SlowResumeAudioContext);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ArrayBuffer(8))));
    renderSession(DEMO_PROJECT);

    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(screen.getByText(/Preparing audio/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(screen.queryByText(/Preparing audio/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();

    await act(async () => { finishResume!(); });
    expect(sessionStore!.getState().audio.snapshot).toMatchObject({ status: "stopped", positionStep: 0 });
  });

  it.each([
    ["late_scheduler", "Scheduler woke after its look-ahead horizon"],
    ["source_failed", "Audio source could not be scheduled"],
  ] as const)("surfaces the %s engine issue accessibly", (code, message) => {
    renderSession(DEMO_PROJECT);

    act(() => sessionStore!.setState((current) => ({
      audio: {
        ...current.audio,
        snapshot: { ...current.audio.snapshot, lastIssue: { code, message } },
      },
    })));

    expect(screen.getByRole("alert")).toHaveTextContent(`Audio: ${message}`);
    expect(screen.getByLabelText(message)).toBeVisible();
  });

  it("states that saved project history remains session-only", async () => {
    vi.stubGlobal("indexedDB", await indexedDBWithProject(DEMO_PROJECT));

    render(<Studio initialProject={EMPTY_PROJECT} />);

    expect(await screen.findByText(/Saved locally; Activity\/history is session-only/)).toBeVisible();
  });

  it("carries rounded playback seconds into the next minute", () => {
    renderSession({
      ...DEMO_PROJECT,
      bpm: 40,
      arrangement: [{ ...DEMO_PROJECT.arrangement[0]!, repeatCount: 10 }],
    });

    act(() => sessionStore!.getState().seekPlayback(159.9));

    expect(screen.getByLabelText("Playback position")).toHaveTextContent("1:00.0");
  });

  it("restarts playback from zero at the arrangement end", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ArrayBuffer(8))));
    renderSession(DEMO_PROJECT);
    act(() => sessionStore!.getState().seekPlayback(sessionStore!.getState().audio.snapshot.arrangementEndStep));

    await user.click(screen.getByRole("button", { name: "Play" }));

    expect(sessionStore!.getState().audio.snapshot).toMatchObject({ status: "playing", positionStep: 0 });
    expect(screen.getByLabelText("Playback position")).toHaveTextContent("0:00.0");
  });

  it("keeps audio and persistence failures separate from edit errors", async () => {
    renderSession(DEMO_PROJECT);
    await act(async () => {
      const token = sessionStore!.getState().beginPersistenceSave();
      sessionStore!.getState().failPersistenceSave(token, "Browser storage is unavailable");
      sessionStore!.getState().selectTrack("missing");
    });

    expect(sessionStore!.getState().persistence.errorMessage).toBe("Browser storage is unavailable");
    expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toEqual([
      "That track no longer exists. Select another track.",
      "Storage: Browser storage is unavailable",
    ]);
  });

  it("reports an empty arrangement without disabling editing", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ArrayBuffer(8))));
    renderSession({ ...DEMO_PROJECT, arrangement: [] });

    await user.click(screen.getByRole("button", { name: "Play" }));

    expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Project arrangement is empty");
    expect(screen.getByRole("button", { name: "Add pattern" })).toBeEnabled();
  });

  it("shows blocked audio retry guidance while editing remains enabled", async () => {
    const user = userEvent.setup();
    class SuspendedAudioContext extends FakeAudioContext {
      async resume(): Promise<void> {}
    }
    vi.stubGlobal("AudioContext", SuspendedAudioContext);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ArrayBuffer(8))));
    renderSession(DEMO_PROJECT);

    await user.click(screen.getByRole("button", { name: "Play" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Audio context is suspended; retry from a user gesture");
    expect(screen.getByRole("button", { name: "Add pattern" })).toBeEnabled();
  });

  it("reports degraded samples while playing available sounds", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("hat.wav")
      ? new Response(null, { status: 404 })
      : new Response(new ArrayBuffer(8))));
    renderSession(DEMO_PROJECT);

    await user.click(screen.getByRole("button", { name: "Play" }));

    expect(screen.getByRole("button", { name: "Pause" })).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/hat.*unavailable/i);
  });

  it("disables transport after the audio context closes", async () => {
    const user = userEvent.setup();
    const contexts: FakeAudioContext[] = [];
    class ClosingAudioContext extends FakeAudioContext {
      constructor() {
        super();
        contexts.push(this);
      }

      async resume(): Promise<void> {
        if (this.state === "closed") {
          throw new DOMException("The audio context is closed", "InvalidStateError");
        }
        await super.resume();
      }
    }
    vi.stubGlobal("AudioContext", ClosingAudioContext);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ArrayBuffer(8))));
    renderSession(DEMO_PROJECT);
    await user.click(screen.getByRole("button", { name: "Play" }));
    await screen.findByRole("button", { name: "Pause" });
    await user.click(screen.getByRole("button", { name: "Pause" }));
    await screen.findByRole("button", { name: "Play" });
    await contexts[0]!.close();

    await user.click(screen.getByRole("button", { name: "Play" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Audio engine is closed. Reload to restore playback.");
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
  });

  it("clears pending playback after an unexpected resume failure", async () => {
    const user = userEvent.setup();
    class RejectingAudioContext extends FakeAudioContext {
      async resume(): Promise<void> { throw new TypeError("invalid audio context"); }
    }
    vi.stubGlobal("AudioContext", RejectingAudioContext);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ArrayBuffer(8))));
    renderSession(DEMO_PROJECT);

    await user.click(screen.getByRole("button", { name: "Play" }));

    expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Audio playback failed. Try again or reload.");
    expect(screen.getByRole("banner")).toHaveTextContent("Audio unavailable");
  });

  it("downloads one WAV from a frozen project without creating history", async () => {
    let store: StoreApi<StudioState> | undefined;
    let resolveRender: (() => void) | undefined;
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("OfflineAudioContext", class extends FakeOfflineAudioContext {
      constructor(channels: number, length: number, sampleRate: number) {
        super(channels, length, sampleRate);
      }
      override startRendering(): Promise<AudioBuffer> {
        return new Promise((resolve) => {
          resolveRender = () => resolve({
            duration: this.length / this.sampleRate,
            length: this.length,
            numberOfChannels: 2,
            sampleRate: this.sampleRate,
            getChannelData: () => new Float32Array(this.length),
          } as unknown as AudioBuffer);
        });
      }
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ArrayBuffer(8))));
    const createObjectURL = vi.fn(() => "blob:wav");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    let downloadedName = "";
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloadedName = this.download;
    });
    const user = userEvent.setup();
    render(
      <StudioProvider initialProject={{ ...audioProject(), name: "Demo/Beat" }} persistenceSession={TEST_PERSISTENCE_SESSION}>
        <Transport />
        <StoreApiProbe onStore={(value) => { store = value; }} />
      </StudioProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(screen.getByRole("button", { name: "Exporting…" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Exporting…" }));
    await vi.waitFor(() => expect(resolveRender).toBeTypeOf("function"));
    act(() => store!.getState().dispatch({
      id: "rename-during-export",
      source: "manual",
      label: "Rename during export",
      kind: "operation",
      operation: { type: "project.update", changes: { name: "Changed" } },
    }));
    resolveRender?.();
    await screen.findByRole("button", { name: "Export" });

    expect(click).toHaveBeenCalledOnce();
    expect(downloadedName).toBe("Demo-Beat.wav");
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:wav");
    expect(store!.getState().history).toHaveLength(1);
  });

  it("keeps empty export disabled and reports a rendering failure", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const user = userEvent.setup();
    const empty = render(
      <StudioProvider initialProject={EMPTY_PROJECT} persistenceSession={TEST_PERSISTENCE_SESSION}><Transport /></StudioProvider>,
    );
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export" })).toHaveAttribute(
      "title",
      "Add an arrangement clip before exporting WAV",
    );
    empty.unmount();

    vi.stubGlobal("OfflineAudioContext", class extends FakeOfflineAudioContext {
      override startRendering(): Promise<AudioBuffer> {
        return Promise.reject(new Error("render stopped"));
      }
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ArrayBuffer(8))));
    render(
      <StudioProvider initialProject={audioProject()} persistenceSession={TEST_PERSISTENCE_SESSION}><Transport /></StudioProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "WAV rendering failed; retry the export",
    );
  });

  it("reports a browser download failure without creating history", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("OfflineAudioContext", FakeOfflineAudioContext);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ArrayBuffer(8))));
    vi.stubGlobal("URL", {
      createObjectURL: () => { throw new Error("downloads blocked"); },
      revokeObjectURL: vi.fn(),
    });
    const user = userEvent.setup();
    render(
      <StudioProvider initialProject={audioProject()} persistenceSession={TEST_PERSISTENCE_SESSION}><Transport /></StudioProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Export" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "WAV download failed; retry the export",
    );
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });
  it("forwards each changed project identity to the mounted audio engine", () => {
    let store: StoreApi<StudioState> | undefined;
    const project = { ...DEMO_PROJECT, arrangement: [{ ...DEMO_PROJECT.arrangement[0]!, id: "only" }] };
    render(<StudioProvider initialProject={project} persistenceSession={TEST_PERSISTENCE_SESSION}><StoreApiProbe onStore={(value) => { store = value; }} /></StudioProvider>);
    expect(store!.getState().audio.snapshot.arrangementEndStep).toBeGreaterThan(0);

    act(() => store!.getState().deleteClip("only"));

    expect(store!.getState().audio.snapshot.arrangementEndStep).toBe(0);
  });

  it("polls one animation frame while playing and cancels it after pause", async () => {
    let store: StoreApi<StudioState> | undefined;
    const contexts: FakeAudioContext[] = [];
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi.fn((callback: FrameRequestCallback): number => {
      frames.push(callback);
      return frames.length;
    });
    const cancelFrame = vi.fn();
    vi.stubGlobal("AudioContext", class extends FakeAudioContext {
      constructor() {
        super();
        contexts.push(this);
      }
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ArrayBuffer(8))));
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelFrame);
    render(<StudioProvider initialProject={DEMO_PROJECT} persistenceSession={TEST_PERSISTENCE_SESSION}><StoreApiProbe onStore={(value) => { store = value; }} /></StudioProvider>);

    await act(() => store!.getState().playPause());
    expect(contexts).toHaveLength(1);
    expect(requestFrame).toHaveBeenCalledTimes(1);

    await act(() => store!.getState().playPause());
    expect(cancelFrame).toHaveBeenCalledWith(1);
  });

  it("stops animation frame polling at the arrangement end", async () => {
    let store: StoreApi<StudioState> | undefined;
    let scheduler: (() => void) | undefined;
    const contexts: FakeAudioContext[] = [];
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("AudioContext", class extends FakeAudioContext {
      constructor() {
        super();
        contexts.push(this);
      }
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ArrayBuffer(8))));
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback): number => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("setInterval", (callback: () => void): number => {
      scheduler = callback;
      return 1;
    });
    vi.stubGlobal("clearInterval", vi.fn());
    render(<StudioProvider initialProject={DEMO_PROJECT} persistenceSession={TEST_PERSISTENCE_SESSION}><StoreApiProbe onStore={(value) => { store = value; }} /></StudioProvider>);

    await act(() => store!.getState().playPause());
    contexts[0]!.currentTime = 60;
    act(() => scheduler!());
    act(() => frames[0]!(0));

    expect(store!.getState().audio.snapshot.status).toBe("stopped");
    expect(frames).toHaveLength(1);
  });

  it("cancels polling and closes the audio context when the provider unmounts", async () => {
    let store: StoreApi<StudioState> | undefined;
    const contexts: FakeAudioContext[] = [];
    const requestFrame = vi.fn(() => 1);
    const cancelFrame = vi.fn();
    vi.stubGlobal("AudioContext", class extends FakeAudioContext {
      constructor() {
        super();
        contexts.push(this);
      }
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ArrayBuffer(8))));
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelFrame);
    const { unmount } = render(<StudioProvider initialProject={DEMO_PROJECT} persistenceSession={TEST_PERSISTENCE_SESSION}><StoreApiProbe onStore={(value) => { store = value; }} /></StudioProvider>);

    await act(() => store!.getState().playPause());
    await act(async () => { unmount(); });

    expect(cancelFrame).toHaveBeenCalledWith(1);
    expect(contexts[0]!.state).toBe("closed");
  });

  it("shows registering until all browser tools are ready", async () => {
    let finishRegistration!: () => void;
    const pending = new Promise<void>((resolve) => { finishRegistration = resolve; });
    installModelContext(async () => pending);

    render(<Studio initialProject={DEMO_PROJECT} />);
    expect(await screen.findByRole("status", { name: "WebMCP status: Registering" })).toHaveTextContent("WebMCP: Registering");
    finishRegistration();

    await waitFor(() => expect(webMCPStatus("Ready")).toHaveTextContent("WebMCP: Ready"));
  });

  it("shows unsupported when the browser has no model context", async () => {
    render(<Studio initialProject={DEMO_PROJECT} />);

    expect(await screen.findByRole("status", { name: "WebMCP status: Unsupported" })).toHaveTextContent("WebMCP: Unsupported");
  });

  it("shows registration failure without disabling manual editing", async () => {
    installModelContext(async () => { throw new Error("registration failed"); });
    const user = userEvent.setup();
    render(<Studio initialProject={DEMO_PROJECT} />);

    await waitFor(() => expect(webMCPStatus("Failed")).toHaveTextContent("WebMCP: Failed"));
    await user.click(within(screen.getByRole("group", { name: "Low Orbit track" }))
      .getByRole("button", { name: "Mute Low Orbit" }));
    expect(screen.getByRole("button", { name: "Unmute Low Orbit" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows synchronous registration failure without disabling manual editing", async () => {
    installModelContext((tool) => {
      if (tool.name === "rename_track") throw new Error("synchronous registration failure");
      return Promise.resolve();
    });
    const user = userEvent.setup();
    render(<Studio initialProject={DEMO_PROJECT} />);

    await waitFor(() => expect(webMCPStatus("Failed")).toHaveTextContent("WebMCP: Failed"));
    await user.click(within(screen.getByRole("group", { name: "Low Orbit track" }))
      .getByRole("button", { name: "Mute Low Orbit" }));
    expect(screen.getByRole("button", { name: "Unmute Low Orbit" })).toHaveAttribute("aria-pressed", "true");
  });

  it("aborts browser tool registrations when the studio unmounts", async () => {
    const registration = installModelContext();
    const view = render(<Studio initialProject={DEMO_PROJECT} />);
    await waitFor(() => expect(webMCPStatus("Ready")).toHaveTextContent("WebMCP: Ready"));

    view.unmount();

    expect(registration.signals).toHaveLength(40);
    expect(registration.signals.every((signal) => signal.aborted)).toBe(true);
    expect(registration.tools).toHaveLength(0);
  });

  it("publishes a captured agent track rename to arrangement, mixer, and activity", async () => {
    const registration = installModelContext();
    const user = userEvent.setup();
    render(<Studio initialProject={DEMO_PROJECT} />);
    await waitFor(() => expect(webMCPStatus("Ready")).toHaveTextContent("WebMCP: Ready"));

    await act(async () => {
      await registration.tools.get("rename_track")!.execute(
        { request_id: "rename-bass", track_id: "bass", name: "Bridge bass" },
        { signal: new AbortController().signal },
      );
    });

    expect(screen.getByRole("group", { name: "Bridge bass track" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Mixer" }));
    expect(screen.getByRole("group", { name: "Bridge bass channel" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Show activity" }));
    const activity = screen.getByRole("complementary", { name: "Activity" });
    expect(within(activity).getAllByRole("listitem")).toHaveLength(1);
    expect(within(activity).getByText("Rename track").closest("li")).toHaveTextContent("Agent");
  });

  it("publishes a captured atomic pattern and clip creation", async () => {
    const registration = installModelContext();
    render(<Studio initialProject={DEMO_PROJECT} />);
    await waitFor(() => expect(webMCPStatus("Ready")).toHaveTextContent("WebMCP: Ready"));

    await act(async () => {
      await registration.tools.get("apply_project_changes")!.execute({
        request_id: "create-bridge-pattern",
        base_revision: 0,
        label: "Create bridge pattern",
        changes: [
          {
            type: "create_pattern",
            ref: "bridge_pattern",
            kind: "synth",
            name: "Bridge pattern",
            length_bars: 1,
            placement: {
              clip_ref: "bridge_clip",
              track_id: { id: "bass" },
              start_bar: 9,
            },
          },
          { type: "set_track_solo", track_id: { id: "pad" }, soloed: false },
        ],
      }, { signal: new AbortController().signal });
    });

    expect(screen.getByRole("button", { name: "Select pattern Bridge pattern" })).toHaveTextContent("1 placement");
    expect(within(screen.getByRole("region", { name: "Low Orbit lane" }))
      .getByRole("button", { name: "Select Bridge pattern" })).toBeVisible();
  });

  it("preserves selection across agent edits until the selected entity is deleted", async () => {
    const registration = installModelContext();
    render(<Studio initialProject={DEMO_PROJECT} />);
    await waitFor(() => expect(webMCPStatus("Ready")).toHaveTextContent("WebMCP: Ready"));
    const selectedClip = within(screen.getByRole("region", { name: "Neon Kit lane" }))
      .getAllByRole("button", { name: "Select Neon beat" })[0]!;
    expect(selectedClip).toHaveAttribute("aria-pressed", "true");

    await act(async () => {
      await registration.tools.get("rename_track")!.execute(
        { request_id: "selection-rename", track_id: "bass", name: "Still selected" },
        { signal: new AbortController().signal },
      );
      await registration.tools.get("create_pattern")!.execute(
        { request_id: "selection-create", kind: "synth", name: "Unselected", length_bars: 1 },
        { signal: new AbortController().signal },
      );
    });
    expect(selectedClip).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Select pattern Unselected" })).toHaveAttribute("aria-pressed", "false");

    await act(async () => {
      await registration.tools.get("delete_clip")!.execute(
        { request_id: "selection-delete", clip_id: "drums-a" },
        { signal: new AbortController().signal },
      );
    });
    expect(selectedClip).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select pattern Neon beat" })).toHaveAttribute("aria-pressed", "true");
  });

  it("uses a track's assigned color for its clips and pattern notes", async () => {
    const user = userEvent.setup();
    renderSession({ ...DEMO_PROJECT,
      tracks: DEMO_PROJECT.tracks.map((track) => track.id === "bass" ? { ...track, color: "#70bd72" } : track),
    });
    const clip = within(screen.getByRole("region", { name: "Low Orbit lane" })).getAllByRole("button", { name: "Select Low Orbit phrase" })[0]!;
    expect(clip).toHaveStyle({ background: "color-mix(in srgb, color-mix(in srgb, #70bd72 88%, white) 80%, transparent)" });
    await user.click(clip);
    const editor = screen.getByRole("region", { name: "Pattern editor for Low Orbit phrase" });
    expect(within(editor).getByRole("button", { name: "Select G2 at step 9 for 4 steps" }))
      .toHaveStyle({ background: "color-mix(in srgb, #70bd72 78%, transparent)" });
  });

  it("creates an unplaced pattern, renames it, and places it using one-based bars", async () => {
    const user = userEvent.setup();
    renderSession(DEMO_PROJECT);
    await user.click(screen.getByRole("button", { name: "Add pattern" }));
    await user.selectOptions(screen.getByLabelText("Pattern editor"), "synth");
    await user.click(screen.getByRole("button", { name: "Create pattern" }));
    expect(screen.getByRole("button", { name: "Select pattern New melody" })).toHaveTextContent("Unplaced");
    await user.click(screen.getByRole("button", { name: "Edit pattern New melody" }));
    await user.clear(screen.getByLabelText("Pattern name"));
    await user.type(screen.getByLabelText("Pattern name"), "New phrase");
    await user.click(screen.getByRole("button", { name: "Rename pattern" }));
    await user.selectOptions(screen.getByLabelText("Pattern length"), "2");
    await user.selectOptions(screen.getByLabelText("Destination track"), "bass");
    expect(screen.queryByRole("option", { name: "Neon Kit" })).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("Starting bar"));
    await user.type(screen.getByLabelText("Starting bar"), "9");
    await user.click(screen.getByRole("button", { name: "Place pattern" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Low Orbit lane" })).getByRole("button", { name: "Select New phrase" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Select pattern New phrase" })).toHaveTextContent("1 placement");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("button", { name: "Select pattern New phrase" })).toHaveTextContent("Unplaced");
  });

  it("offers compatible destinations despite unrelated invalid track metadata", async () => {
    const user = userEvent.setup();
    const invalidName = "x".repeat(41);
    render(<Studio initialProject={{
      ...DEMO_PROJECT,
      tracks: DEMO_PROJECT.tracks.map((track) => track.id === "bass"
        ? { ...track, name: invalidName, volumeDb: 7 }
        : track),
      arrangement: [],
    }} />);

    await user.click(await screen.findByRole("button", { name: "Edit pattern Unused idea" }));

    expect(screen.getByRole("option", { name: invalidName })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Neon Kit" })).not.toBeInTheDocument();
  });

  it("creates and places from an empty lane in one edit and offers numeric creation", async () => {
    const user = userEvent.setup();
    renderSession({ ...DEMO_PROJECT, arrangement: [] });
    const lane = screen.getByRole("region", { name: "Low Orbit lane" });
    vi.spyOn(lane, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 0, 1_120, 112));
    fireEvent.doubleClick(lane, { clientX: 240 });
    expect(within(lane).getByRole("button", { name: "Edit clip New melody at bar 3" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.queryByRole("button", { name: "Select pattern New melody" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Edit Low Orbit" }));
    await user.clear(screen.getByLabelText("New pattern starting bar"));
    await user.type(screen.getByLabelText("New pattern starting bar"), "10");
    await user.click(screen.getByRole("button", { name: "Create pattern here" }));
    expect(within(lane).getByRole("button", { name: "Edit clip New melody at bar 10" })).toBeVisible();
  });

  it("edits clip routing and repeats, duplicates sharing, and makes only one clip unique", async () => {
    const user = userEvent.setup();
    renderSession({ ...DEMO_PROJECT, arrangement: [DEMO_PROJECT.arrangement[2]!] });
    await user.click(screen.getByRole("button", { name: "Edit clip Low Orbit phrase at bar 1" }));
    await user.selectOptions(screen.getByLabelText("Destination track"), "chords");
    await user.clear(screen.getByLabelText("Starting bar"));
    await user.type(screen.getByLabelText("Starting bar"), "3");
    await user.clear(screen.getByLabelText("Repeat count"));
    await user.type(screen.getByLabelText("Repeat count"), "3");
    await user.click(screen.getByRole("button", { name: "Apply placement" }));
    expect(within(screen.getByRole("region", { name: "Glasshouse lane" })).getByRole("button", { name: "Select Low Orbit phrase" })).toHaveTextContent("×3");
    await user.click(screen.getByRole("button", { name: "Duplicate clip" }));
    expect(screen.getByRole("button", { name: "Select pattern Low Orbit phrase" })).toHaveTextContent("2 placements");
    await user.click(screen.getByRole("button", { name: "Edit clip Low Orbit phrase at bar 9" }));
    await user.click(screen.getByRole("button", { name: "Make unique" }));
    expect(screen.getByRole("button", { name: "Select pattern Low Orbit phrase copy" })).toHaveTextContent("1 placement");
    await user.click(screen.getByRole("button", { name: "Delete clip" }));
    expect(screen.getByRole("button", { name: "Select pattern Low Orbit phrase copy" })).toHaveTextContent("Unplaced");
    expect(screen.getByRole("region", { name: "Glasshouse lane" })).toHaveFocus();
  });

  it("confirms all pattern placements before deletion and can cancel or undo", async () => {
    const user = userEvent.setup();
    renderSession(DEMO_PROJECT);
    await user.click(screen.getByRole("button", { name: "Edit pattern Neon beat" }));
    await user.click(screen.getByRole("button", { name: "Delete pattern" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("2 placements");
    await user.click(screen.getByRole("button", { name: "Keep pattern" }));
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Delete pattern" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(screen.queryByRole("button", { name: "Select pattern Neon beat" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add pattern" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getAllByRole("button", { name: "Select Neon beat" })).toHaveLength(2);
  });

  it("keeps rejected clip edits unchanged and discards unapplied fields on Escape", async () => {
    const user = userEvent.setup();
    renderSession(DEMO_PROJECT);
    await user.click(screen.getByRole("button", { name: "Edit clip Low Orbit phrase at bar 1" }));
    await user.clear(screen.getByLabelText("Starting bar"));
    await user.type(screen.getByLabelText("Starting bar"), "2");
    await user.click(screen.getByRole("button", { name: "Apply placement" }));
    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent(/overlap/i);
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    await user.clear(screen.getByLabelText("Starting bar"));
    await user.type(screen.getByLabelText("Starting bar"), "9");
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit clip Low Orbit phrase at bar 1" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it("opens track movement controls with the keyboard and cancels without history", async () => {
    const user = userEvent.setup();
    renderSession(DEMO_PROJECT);
    screen.getByRole("button", { name: "Reorder Neon Kit" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Move down" })).toBeVisible();
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it.each([
    { instrumentId: "kit.basic", name: "Basic drums", incompatibleInstrument: "Bass" },
    { instrumentId: "synth.bass", name: "Bass", incompatibleInstrument: "Basic drums" },
  ])("creates $name from one instrument selector and undoes it", async ({ instrumentId, name, incompatibleInstrument }) => {
    const user = userEvent.setup();
    renderSession(EMPTY_PROJECT);
    await user.click(screen.getByRole("button", { name: "Add track" }));
    const selector = screen.getByRole("combobox", { name: "Instrument" });
    await user.selectOptions(selector, "synth.pad");
    await user.selectOptions(selector, instrumentId);
    expect(screen.queryByRole("group", { name: "Track type" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create track" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Select track ${name}` })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.queryByRole("button", { name: `Select track ${name}` })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Redo" }));
    expect(screen.getByRole("button", { name: `Select track ${name}` })).toBeVisible();
    await user.click(screen.getByRole("button", { name: `Edit ${name}` }));
    expect(screen.getByRole("dialog")).not.toHaveTextContent(/type cannot be changed/i);
    expect(screen.queryByRole("option", { name: incompatibleInstrument })).not.toBeInTheDocument();
  });

  it("renames, changes preset, and reorders a track in arrangement and mixer", async () => {
    const user = userEvent.setup();
    renderSession(DEMO_PROJECT);
    await user.click(screen.getByRole("button", { name: "Edit Low Orbit" }));
    await user.clear(screen.getByLabelText("Track name"));
    await user.type(screen.getByLabelText("Track name"), "Sub bass");
    await user.click(screen.getByRole("button", { name: "Rename track" }));
    await user.selectOptions(screen.getByLabelText("Instrument"), "synth.pad");
    await user.click(screen.getByRole("button", { name: "Move up" }));
    expect(screen.getByRole("button", { name: "Move up" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Close track settings" }));
    expect(screen.getAllByRole("button", { name: /Select track / })[0]).toHaveAccessibleName("Select track Sub bass");
    await user.click(screen.getByRole("button", { name: "Mixer" }));
    const mixer = within(screen.getByRole("region", { name: "Mixer channels" }));
    expect(mixer.getAllByRole("group")[0]).toHaveAccessibleName("Sub bass channel");
    expect(mixer.getAllByRole("group")[0]).toHaveTextContent("Pad");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(mixer.getAllByRole("group")[0]).toHaveAccessibleName("Neon Kit channel");
  });

  it("confirms affected clips before deleting a track and keeps reusable patterns", async () => {
    const user = userEvent.setup();
    renderSession(DEMO_PROJECT);
    await user.click(screen.getByRole("button", { name: "Edit Neon Kit" }));
    await user.click(screen.getByRole("button", { name: "Delete track" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("2 clips");
    expect(screen.getByRole("dialog")).toHaveTextContent("Patterns remain");
    await user.click(screen.getByRole("button", { name: "Keep track" }));
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Delete track" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(screen.queryByRole("region", { name: "Neon Kit lane" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select pattern Neon beat" })).toHaveTextContent("Unplaced");
    expect(screen.getByRole("button", { name: "Add track" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("region", { name: "Neon Kit lane" })).toBeVisible();
  });

  it("selects shared clips and unplaced patterns using project content", async () => {
    const user = userEvent.setup();
    renderSession(DEMO_PROJECT);
    await user.click(within(screen.getByRole("region", { name: "Glasshouse lane" })).getAllByRole("button", { name: "Select Glasshouse" })[1]!);
    expect(screen.getByRole("region", { name: "Pattern editor for Glasshouse" })).toHaveTextContent("2 placements");
    expect(within(screen.getByRole("region", { name: "Pattern editor for Glasshouse" })).getByText("C4")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Select pattern Unused idea" }));
    expect(screen.getByRole("region", { name: "Pattern editor for Unused idea" })).toHaveTextContent("Unplaced");
    expect(screen.getByRole("region", { name: "Pattern editor for Unused idea" })).not.toHaveTextContent("SELECTED TRACK");
  });

  it("renders empty sessions without assuming a track or pattern", () => {
    renderSession(EMPTY_PROJECT);
    expect(screen.getByText("Add a track to start arranging.")).toBeVisible();
    expect(screen.getByText("Select a pattern to view its notes or hits.")).toBeVisible();
  });

  it("renders exact project mixer values in project track order without simulated meters", async () => {
    const user = userEvent.setup();
    renderSession({ ...DEMO_PROJECT, name: "Test song", bpm: 96,
      tracks: [...DEMO_PROJECT.tracks].reverse() });
    expect(screen.getByText("Test song")).toBeVisible();
    expect(screen.getByLabelText("Project tempo")).toHaveTextContent("96");
    await user.click(screen.getByRole("button", { name: "Mixer" }));
    const mixer = screen.getByRole("region", { name: "Mixer channels" });
    expect(within(mixer).getAllByRole("group").map((element) => element.getAttribute("aria-label")))
      .toEqual(["Night Air channel", "Afterglow channel", "Glasshouse channel", "Low Orbit channel", "Neon Kit channel", "Master channel"]);
    expect(screen.getByRole("slider", { name: "Neon Kit volume" })).toHaveValue("-6");
    expect(screen.getByRole("slider", { name: "Neon Kit pan" })).toHaveValue("0");
    expect(screen.queryByRole("slider", { name: "Master pan" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Master output level")).not.toBeInTheDocument();
  });

  it("synchronizes track mute controls and commits a slider gesture once", async () => {
    const user = userEvent.setup();
    renderSession(DEMO_PROJECT);
    const trackHeader = screen.getByRole("group", { name: "Low Orbit track" });
    await user.click(within(trackHeader).getByRole("button", { name: "Mute Low Orbit" }));
    expect(within(trackHeader).getByRole("button", { name: "Unmute Low Orbit" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Mixer" }));
    const channel = screen.getByRole("group", { name: "Low Orbit channel" });
    const mixerMute = within(channel).getByRole("button", { name: "Unmute Low Orbit" });
    expect(mixerMute).toHaveAttribute("aria-pressed", "true");
    await user.click(mixerMute);
    expect(within(trackHeader).getByRole("button", { name: "Mute Low Orbit" })).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button", { name: "Undo" }));
    await user.click(screen.getByRole("button", { name: "Undo" }));
    const volume = within(channel).getByRole("slider", { name: "Low Orbit volume" });
    fireEvent.pointerDown(volume, { pointerId: 1, button: 0 });
    fireEvent.change(volume, { target: { value: "-12" } });
    fireEvent.change(volume, { target: { value: "-18" } });
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    fireEvent.pointerUp(volume, { pointerId: 1 });
    expect(volume).toHaveValue("-18");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(volume).toHaveValue("-9");
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it("commits numeric mixer entry once and cancels an unfinished value", async () => {
    const user = userEvent.setup();
    renderSession(DEMO_PROJECT);
    await user.click(screen.getByRole("button", { name: "Mixer" }));
    const channel = screen.getByRole("group", { name: "Low Orbit channel" });
    const value = within(channel).getByRole("spinbutton", { name: "Low Orbit volume value" });
    const slider = within(channel).getByRole("slider", { name: "Low Orbit volume" });

    fireEvent.change(value, { target: { value: "-12" } });
    fireEvent.keyDown(value, { key: "Enter" });
    fireEvent.blur(value);
    expect(slider).toHaveValue("-12");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(slider).toHaveValue("-9");
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();

    fireEvent.change(value, { target: { value: "-18" } });
    fireEvent.keyDown(value, { key: "Escape" });
    expect(slider).toHaveValue("-9");
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it("toggles activity and editor panels without initializing audio", async () => {
    const context = vi.fn();
    const fetch = vi.fn();
    vi.stubGlobal("AudioContext", context);
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    renderSession(DEMO_PROJECT);
    expect(screen.queryByRole("complementary", { name: "Activity" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show activity" }));
    expect(screen.getByRole("complementary", { name: "Activity" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Mixer" }));
    expect(screen.getByRole("region", { name: "Mixer channels" })).toBeVisible();
    expect(context).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("resizes, closes, and restores the track editor", async () => {
    const user = userEvent.setup();
    renderSession(DEMO_PROJECT);
    const editor = screen.getByRole("complementary", { name: "Track editor" });
    const separator = screen.getByRole("separator", { name: "Resize track editor" });
    vi.spyOn(editor.parentElement!, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1_200, 800));

    expect(editor).toHaveStyle({ height: "410px" });
    fireEvent.pointerDown(separator, { pointerId: 1, button: 0, clientY: 500 });
    fireEvent.pointerMove(separator, { pointerId: 1, clientY: 0 });
    expect(editor).toHaveStyle({ height: "640px" });
    fireEvent.pointerMove(separator, { pointerId: 1, clientY: 1_000 });
    expect(editor).toHaveStyle({ height: "180px" });
    fireEvent.pointerUp(separator, { pointerId: 1 });

    await user.click(screen.getByRole("button", { name: "Close track editor" }));
    expect(screen.queryByRole("complementary", { name: "Track editor" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Pattern editor/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open track editor" }));
    expect(screen.getByRole("complementary", { name: "Track editor" })).toHaveStyle({ height: "180px" });
  });

  it("resizes the track editor from the keyboard", () => {
    renderSession(DEMO_PROJECT);
    const editor = screen.getByRole("complementary", { name: "Track editor" });
    vi.spyOn(editor.parentElement!, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1_200, 800));
    const separator = screen.getByRole("separator", { name: "Resize track editor" });
    fireEvent.keyDown(separator, { key: "ArrowUp" });
    expect(editor).toHaveStyle({ height: "430px" });
    fireEvent.keyDown(separator, { key: "ArrowDown" });
    expect(editor).toHaveStyle({ height: "410px" });
  });

  it("publishes history and undo/redo to the transport", async () => {
    let state: StudioState | undefined;
    function Probe(): null {
      const value = useStudioStore((store) => store);
      useEffect(() => { state = value; }, [value]);
      return null;
    }
    const user = userEvent.setup();
    render(<StudioProvider initialProject={EMPTY_PROJECT} persistenceSession={TEST_PERSISTENCE_SESSION}><Transport /><ActivityPanel /><Probe /></StudioProvider>);
    await user.click(screen.getByRole("button", { name: "Show activity" }));
    act(() => state!.dispatch({
      id: "rename", source: "agent", label: "Agent named song", kind: "operation",
      operation: { type: "project.update", changes: { name: "Named song" } },
    }));
    expect(screen.getByText("Named song")).toBeVisible();
    expect(screen.getByText("Agent named song")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByText("Untitled")).toBeVisible();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Redo" }));
    expect(screen.getByText("Named song")).toBeVisible();
  });

  it("confirms restore from real attributed history and makes it undoable", async () => {
    let state: StudioState | undefined;
    function Probe(): null {
      const value = useStudioStore((store) => store);
      useEffect(() => { state = value; }, [value]);
      return null;
    }
    const user = userEvent.setup();
    render(<StudioProvider initialProject={EMPTY_PROJECT} persistenceSession={TEST_PERSISTENCE_SESSION}><Transport /><ActivityPanel /><Probe /></StudioProvider>);
    await user.click(screen.getByRole("button", { name: "Show activity" }));
    act(() => state!.dispatch({
      id: "rename", source: "agent", label: "Agent named song", kind: "operation",
      operation: { type: "project.update", changes: { name: "Named song" } },
    }));
    act(() => state!.createTrack("synth", "synth.bass"));
    expect(screen.getByText(/Agent ·/)).toBeVisible();
    expect(screen.getByText("Create Bass").closest("li")).toHaveAttribute("aria-current", "step");

    await user.click(screen.getByRole("button", { name: "Restore Agent named song" }));
    expect(screen.getByRole("dialog", { name: "Restore Agent named song" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Keep current project" }));
    expect(state!.project.tracks).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Restore Agent named song" }));
    await user.click(screen.getByRole("button", { name: "Confirm restore" }));
    expect(state!.project.tracks).toHaveLength(0);
    expect(state!.history.at(-1)?.action.kind).toBe("restore");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(state!.project.tracks).toHaveLength(1);
  });

  it("handles undo and redo shortcuts outside editable fields and dialogs", async () => {
    const user = userEvent.setup();
    renderSession(DEMO_PROJECT);
    const track = screen.getByRole("group", { name: "Low Orbit track" });
    await user.click(within(track).getByRole("button", { name: "Mute Low Orbit" }));
    await user.click(screen.getByRole("button", { name: "Edit Low Orbit" }));
    const name = screen.getByRole("textbox", { name: "Track name" });
    fireEvent.keyDown(name, { key: "z", metaKey: true });
    expect(within(track).getByRole("button", { name: "Unmute Low Orbit" })).toBeVisible();
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));

    const studio = screen.getByRole("main");
    fireEvent.keyDown(studio, { key: "z", metaKey: true });
    expect(within(track).getByRole("button", { name: "Mute Low Orbit" })).toBeVisible();
    fireEvent.keyDown(studio, { key: "z", metaKey: true, shiftKey: true });
    expect(within(track).getByRole("button", { name: "Unmute Low Orbit" })).toBeVisible();
    fireEvent.keyDown(studio, { key: "y", ctrlKey: true });
    expect(within(track).getByRole("button", { name: "Unmute Low Orbit" })).toBeVisible();
  });

  it("deletes only the focused arrangement clip", async () => {
    const user = userEvent.setup();
    renderSession(DEMO_PROJECT);
    const lane = screen.getByRole("region", { name: "Low Orbit lane" });
    const clips = within(lane).getAllByRole("button", { name: "Select Low Orbit phrase" });
    clips[0]!.focus();
    fireEvent.keyDown(clips[0]!, { key: "Delete" });
    expect(within(lane).getAllByRole("button", { name: "Select Low Orbit phrase" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(within(lane).getAllByRole("button", { name: "Select Low Orbit phrase" })).toHaveLength(2);
  });
});
