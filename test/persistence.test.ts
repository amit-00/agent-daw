import assert from "node:assert/strict";
import test from "node:test";

import { forceCloseDatabase, IDBFactory } from "fake-indexeddb";

import {
  InvalidInputError,
  type Project,
  type SoundCatalog,
} from "../src/project/index.ts";
import { ProjectPersistenceService } from "../src/persistence/service.ts";

const DATABASE_NAME = "agent-daw";
const DATABASE_VERSION = 1;
const STORE_NAME = "current-project";
const RECORD_KEY = "current";
const forceClose = forceCloseDatabase as unknown as (database: IDBDatabase) => void;

const id = (value: number): string =>
  `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;

const catalog: SoundCatalog = {
  drumKits: [{ id: "kit.basic", soundIds: ["kick", "snare", "hat"] }],
  synthPresets: [{ id: "synth.bass" }],
};

const blankProject = (): Project => ({
  schemaVersion: 1,
  id: id(1),
  name: "Untitled",
  bpm: 120,
  masterVolumeDb: 0,
  tracks: [],
  patterns: [],
  arrangement: [],
});

const openRawDatabase = (indexedDB: IDBFactory): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const seedRawRecord = async (indexedDB: IDBFactory, value: unknown): Promise<void> => {
  const database = await openRawDatabase(indexedDB);
  const transaction = database.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).put(value, RECORD_KEY);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  database.close();
};

const readRawRecord = async (indexedDB: IDBFactory): Promise<unknown> => {
  const database = await openRawDatabase(indexedDB);
  const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(RECORD_KEY);
  const value = await new Promise<unknown>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return value;
};

const failingOpenFactory = (error: DOMException): IDBFactory => ({
  open: () => { throw error; },
}) as unknown as IDBFactory;

const throwingNextReadwriteFactory = (indexedDB: IDBFactory, error: DOMException): IDBFactory => {
  let shouldFail = true;
  return new Proxy(indexedDB, {
    get(target, property, receiver) {
      if (property !== "open") return Reflect.get(target, property, receiver);
      return (name: string, version?: number): IDBOpenDBRequest => {
        const request = version === undefined ? target.open(name) : target.open(name, version);
        request.addEventListener("success", () => {
          const database = request.result;
          const transaction = database.transaction.bind(database);
          Object.defineProperty(database, "transaction", {
            configurable: true,
            value: (
              storeNames: string | string[],
              mode: IDBTransactionMode = "readonly",
              options?: IDBTransactionOptions,
            ): IDBTransaction => {
              if (mode === "readwrite" && shouldFail) {
                shouldFail = false;
                throw error;
              }
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
};

const abortingNextReadwriteFactory = (indexedDB: IDBFactory): IDBFactory => {
  let shouldAbort = true;
  return new Proxy(indexedDB, {
    get(target, property, receiver) {
      if (property !== "open") return Reflect.get(target, property, receiver);
      return (name: string, version?: number): IDBOpenDBRequest => {
        const request = version === undefined ? target.open(name) : target.open(name, version);
        request.addEventListener("success", () => {
          const database = request.result;
          const transaction = database.transaction.bind(database);
          Object.defineProperty(database, "transaction", {
            configurable: true,
            value: (
              storeNames: string | string[],
              mode: IDBTransactionMode = "readonly",
              options?: IDBTransactionOptions,
            ): IDBTransaction => {
              const result = options === undefined
                ? transaction(storeNames, mode)
                : transaction(storeNames, mode, options);
              if (mode === "readwrite" && shouldAbort) {
                shouldAbort = false;
                queueMicrotask(() => result.abort());
              }
              return result;
            },
          });
        }, { once: true });
        return request;
      };
    },
  });
};

const observingOpenFactory = (
  indexedDB: IDBFactory,
  connections: IDBDatabase[],
): IDBFactory => new Proxy(indexedDB, {
  get(target, property, receiver) {
    if (property !== "open") return Reflect.get(target, property, receiver);
    return (name: string, version?: number): IDBOpenDBRequest => {
      const request = version === undefined ? target.open(name) : target.open(name, version);
      request.addEventListener("success", () => connections.push(request.result), { once: true });
      return request;
    };
  },
});

const createService = (indexedDB: IDBFactory): ProjectPersistenceService =>
  new ProjectPersistenceService({
    indexedDB,
    catalog,
    now: () => 1_700_000_000_000,
    debounceMs: 500,
  });

test("load returns empty when no project is stored", async () => {
  const result = await createService(new IDBFactory()).load();
  assert.deepEqual(result, { status: "empty" });
});

test("an unexpected database close reopens on the next operation", async () => {
  const connections: IDBDatabase[] = [];
  const service = createService(observingOpenFactory(new IDBFactory(), connections));

  assert.deepEqual(await service.load(), { status: "empty" });
  const first = connections[0];
  assert.ok(first);
  const closed = new Promise<void>((resolve) => {
    first.addEventListener("close", () => resolve(), { once: true });
  });
  forceClose(first);
  await closed;

  assert.deepEqual(await service.load(), { status: "empty" });
  assert.equal(connections.length, 2);
  assert.notEqual(connections[1], first);
});

test("load maps unavailable IndexedDB", async () => {
  const service = createService(failingOpenFactory(new DOMException("blocked", "SecurityError")));
  const result = await service.load();
  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.equal(result.error.code, "storage_unavailable");
});

test("load returns a valid stored project", async () => {
  const indexedDB = new IDBFactory();
  const project = blankProject();
  await seedRawRecord(indexedDB, { project, updatedAt: 123 });

  const result = await createService(indexedDB).load();

  assert.deepEqual(result, { status: "loaded", project, updatedAt: 123 });
});

test("load preserves a corrupt record and reports recovery", async () => {
  const indexedDB = new IDBFactory();
  await seedRawRecord(indexedDB, { project: { broken: true }, updatedAt: 123 });

  const result = await createService(indexedDB).load();

  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.equal(result.error.code, "corrupt_record");
});

test("load distinguishes an unsupported project schema", async () => {
  const indexedDB = new IDBFactory();
  await seedRawRecord(indexedDB, {
    project: { ...blankProject(), schemaVersion: 2 },
    updatedAt: 123,
  });

  const result = await createService(indexedDB).load();

  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.equal(result.error.code, "unsupported_schema");
});

test("scheduleSave and flush persist a project", async () => {
  const indexedDB = new IDBFactory();
  const service = createService(indexedDB);
  const pending = service.scheduleSave(blankProject());

  assert.deepEqual(await service.flush(), { status: "saved", updatedAt: 1_700_000_000_000 });
  assert.deepEqual(await pending, { status: "saved", updatedAt: 1_700_000_000_000 });
  assert.equal((await createService(indexedDB).load()).status, "loaded");
});

test("scheduleSave coalesces to the newest snapshot", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const indexedDB = new IDBFactory();
  const service = createService(indexedDB);
  const first = service.scheduleSave({ ...blankProject(), name: "First" });
  const second = service.scheduleSave({ ...blankProject(), name: "Second" });

  assert.equal(first, second);
  context.mock.timers.tick(500);
  assert.equal((await second).status, "saved");
  const loaded = await createService(indexedDB).load();
  assert.equal(loaded.status === "loaded" ? loaded.project.name : undefined, "Second");
});

test("scheduleSave clones the queued project", async () => {
  const indexedDB = new IDBFactory();
  const service = createService(indexedDB);
  const project = blankProject();
  service.scheduleSave(project);
  (project as { name: string }).name = "Caller mutation";

  await service.flush();
  const loaded = await createService(indexedDB).load();
  assert.equal(loaded.status === "loaded" ? loaded.project.name : undefined, "Untitled");
});

test("an invalid project cannot replace valid pending work", async () => {
  const indexedDB = new IDBFactory();
  const service = createService(indexedDB);
  service.scheduleSave({ ...blankProject(), name: "Valid" });

  assert.throws(
    () => service.scheduleSave({ ...blankProject(), bpm: Number.NaN }),
    (error: unknown) =>
      error instanceof InvalidInputError && error.info.path === "project.bpm",
  );

  await service.flush();
  const loaded = await createService(indexedDB).load();
  assert.equal(loaded.status === "loaded" ? loaded.project.name : undefined, "Valid");
});

test("a save queued during an active write runs afterward", async () => {
  const indexedDB = new IDBFactory();
  const service = createService(indexedDB);
  const first = service.scheduleSave({ ...blankProject(), name: "First" });
  const firstFlush = service.flush();
  const second = service.scheduleSave({ ...blankProject(), name: "Second" });
  const secondFlush = service.flush();

  assert.equal((await first).status, "saved");
  await firstFlush;
  assert.equal((await second).status, "saved");
  await secondFlush;
  const loaded = await createService(indexedDB).load();
  assert.equal(loaded.status === "loaded" ? loaded.project.name : undefined, "Second");
});

test("flush is idle when no save is active or pending", async () => {
  assert.deepEqual(await createService(new IDBFactory()).flush(), { status: "idle" });
});

test("a corrupt load cancels an already queued save", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const indexedDB = new IDBFactory();
  await seedRawRecord(indexedDB, { project: { broken: true }, updatedAt: 123 });
  const service = createService(indexedDB);
  const pending = service.scheduleSave(blankProject());

  const load = await service.load();
  assert.equal(load.status, "failed");
  context.mock.timers.tick(500);
  assert.deepEqual(await pending, {
    status: "failed",
    error: {
      code: "recovery_required",
      message: "Clear the unreadable stored project before saving",
    },
  });
  const stored = await createService(indexedDB).load();
  assert.equal(stored.status, "failed");
  if (stored.status === "failed") assert.equal(stored.error.code, "corrupt_record");
});

test("load blocks a flushed save until corrupt recovery is known", async () => {
  const indexedDB = new IDBFactory();
  const record = { project: { broken: true }, updatedAt: 123 };
  await seedRawRecord(indexedDB, record);
  const service = createService(indexedDB);

  const loading = service.load();
  const saving = service.scheduleSave(blankProject());
  const flushing = service.flush();

  const load = await loading;
  assert.equal(load.status, "failed");
  if (load.status === "failed") assert.equal(load.error.code, "corrupt_record");
  const recoveryRequired = {
    status: "failed",
    error: {
      code: "recovery_required",
      message: "Clear the unreadable stored project before saving",
    },
  };
  assert.deepEqual(await saving, recoveryRequired);
  assert.deepEqual(await flushing, recoveryRequired);
  assert.deepEqual(await readRawRecord(indexedDB), record);
});

test("load keeps a queued successor behind an aborting active write", async () => {
  const indexedDB = new IDBFactory();
  const record = { project: { broken: true }, updatedAt: 123 };
  await seedRawRecord(indexedDB, record);
  const service = createService(abortingNextReadwriteFactory(indexedDB));

  service.scheduleSave({ ...blankProject(), name: "Aborted" });
  const activeFlush = service.flush();
  const loading = service.load();
  const saving = service.scheduleSave({ ...blankProject(), name: "Queued" });
  const queuedFlush = service.flush();

  const active = await activeFlush;
  assert.equal(active.status, "failed");
  if (active.status === "failed") assert.equal(active.error.code, "transaction_failed");
  const load = await loading;
  assert.equal(load.status, "failed");
  if (load.status === "failed") assert.equal(load.error.code, "corrupt_record");
  const recoveryRequired = {
    status: "failed",
    error: {
      code: "recovery_required",
      message: "Clear the unreadable stored project before saving",
    },
  };
  assert.deepEqual(await saving, recoveryRequired);
  assert.deepEqual(await queuedFlush, recoveryRequired);
  assert.deepEqual(await readRawRecord(indexedDB), record);
});

test("corrupt load blocks saves until clear succeeds", async () => {
  const indexedDB = new IDBFactory();
  await seedRawRecord(indexedDB, { project: { broken: true }, updatedAt: 123 });
  const service = createService(indexedDB);

  assert.equal((await service.load()).status, "failed");
  const blocked = await service.scheduleSave(blankProject());
  assert.equal(blocked.status, "failed");
  if (blocked.status === "failed") assert.equal(blocked.error.code, "recovery_required");
  assert.deepEqual(await service.clear(), { status: "cleared" });
  service.scheduleSave(blankProject());
  assert.equal((await service.flush()).status, "saved");
});

test("clear cancels a pending save", async () => {
  const service = createService(new IDBFactory());
  const pending = service.scheduleSave(blankProject());

  assert.deepEqual(await service.clear(), { status: "cleared" });
  assert.deepEqual(await pending, { status: "cancelled_by_clear" });
  assert.deepEqual(await service.load(), { status: "empty" });
});

test("clear waits for an active save and cancels the queued successor", async () => {
  const indexedDB = new IDBFactory();
  const service = createService(indexedDB);
  const first = service.scheduleSave({ ...blankProject(), name: "First" });
  const activeFlush = service.flush();
  const second = service.scheduleSave({ ...blankProject(), name: "Second" });
  const clearing = service.clear();
  const duringClear = service.scheduleSave({ ...blankProject(), name: "Third" });

  assert.equal((await first).status, "saved");
  await activeFlush;
  assert.deepEqual(await second, { status: "cancelled_by_clear" });
  assert.deepEqual(await duringClear, { status: "cancelled_by_clear" });
  assert.deepEqual(await clearing, { status: "cleared" });
  assert.deepEqual(await service.load(), { status: "empty" });
});

test("repeated clear calls share one idempotent operation", async () => {
  const service = createService(new IDBFactory());
  const first = service.clear();
  const second = service.clear();
  assert.equal(first, second);
  assert.deepEqual(await first, { status: "cleared" });
});

test("failed clear preserves recovery and the corrupt record", async () => {
  const indexedDB = new IDBFactory();
  const record = { project: { broken: true }, updatedAt: 123 };
  await seedRawRecord(indexedDB, record);
  const service = createService(abortingNextReadwriteFactory(indexedDB));

  assert.equal((await service.load()).status, "failed");
  const clear = await service.clear();
  assert.equal(clear.status, "failed");
  if (clear.status === "failed") {
    assert.equal(clear.error.code, "transaction_failed");
    assert.ok(clear.error.cause instanceof DOMException);
    assert.equal(clear.error.cause.name, "AbortError");
  }

  const save = await service.scheduleSave(blankProject());
  assert.equal(save.status, "failed");
  if (save.status === "failed") assert.equal(save.error.code, "recovery_required");
  const flush = await service.flush();
  assert.equal(flush.status, "failed");
  if (flush.status === "failed") assert.equal(flush.error.code, "recovery_required");
  assert.deepEqual(await readRawRecord(indexedDB), record);
});

test("a failed save preserves the last durable record", async () => {
  const indexedDB = new IDBFactory();
  const original = { ...blankProject(), name: "Durable" };
  await seedRawRecord(indexedDB, { project: original, updatedAt: 123 });
  const service = createService(abortingNextReadwriteFactory(indexedDB));
  service.scheduleSave({ ...blankProject(), name: "Rejected" });

  const result = await service.flush();

  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.error.code, "transaction_failed");
    assert.ok(result.error.cause instanceof DOMException);
    assert.equal(result.error.cause.name, "AbortError");
  }
  const loaded = await createService(indexedDB).load();
  assert.equal(loaded.status === "loaded" ? loaded.project.name : undefined, "Durable");
});

test("save maps a synchronous quota error and preserves its cause", async () => {
  const indexedDB = new IDBFactory();
  const error = new DOMException("full", "QuotaExceededError");
  const service = createService(throwingNextReadwriteFactory(
    indexedDB,
    error,
  ));
  service.scheduleSave(blankProject());

  const result = await service.flush();

  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.error.code, "quota_exceeded");
    assert.equal(result.error.cause, error);
  }
});

test("a newer save still runs after an earlier write fails", async () => {
  const indexedDB = new IDBFactory();
  const service = createService(abortingNextReadwriteFactory(indexedDB));
  service.scheduleSave({ ...blankProject(), name: "Failed" });
  assert.equal((await service.flush()).status, "failed");

  service.scheduleSave({ ...blankProject(), name: "Recovered" });
  assert.equal((await service.flush()).status, "saved");
  const loaded = await createService(indexedDB).load();
  assert.equal(loaded.status === "loaded" ? loaded.project.name : undefined, "Recovered");
});
