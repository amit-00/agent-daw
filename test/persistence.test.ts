import assert from "node:assert/strict";
import test from "node:test";

import { IDBFactory } from "fake-indexeddb";

import {
  type Project,
  type SoundCatalog,
} from "../src/project/index.ts";
import { ProjectPersistenceService } from "../src/persistence/index.ts";

const DATABASE_NAME = "agent-daw";
const DATABASE_VERSION = 1;
const STORE_NAME = "current-project";
const RECORD_KEY = "current";

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
