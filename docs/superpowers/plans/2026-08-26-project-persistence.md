# Project Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist and restore one latest validated AgentDAW project through a debounced, ordered IndexedDB service with explicit recovery and clear behavior.

**Architecture:** Add one concrete `ProjectPersistenceService` outside the project domain. It validates complete snapshots with `validateProject`, keeps at most one active and one pending write, and stores one `{ project, updatedAt }` record under a fixed IndexedDB key. Browser storage failures return typed results; corrupt or unsupported loads block writes until explicit clear succeeds.

**Tech Stack:** Strict TypeScript, browser-native IndexedDB, native `structuredClone`, Node's built-in test runner, and `fake-indexeddb` 6.2.5 for Node integration tests.

**Spec:** `docs/superpowers/specs/2026-08-26-project-persistence-design.md`

## Global Constraints

- Work only in `/Users/amit/Documents/repos/agent-daw/.worktrees/project-persistence` on `codex/project-persistence`.
- Read the approved spec before implementation and do not broaden its scope.
- Persist only the latest `Project`; history and successful-command outcomes remain memory-only.
- Use one concrete class in `src/persistence/service.ts`; do not add a repository interface, factory, migration framework, or runtime dependency.
- Keep database name `agent-daw`, version `1`, object store `current-project`, record key `current`, and autosave debounce `500` ms.
- Reuse `validateProject`, `Project`, `SoundCatalog`, `DomainError`, and `InvalidInputError` from `src/project`.
- Treat IndexedDB values as untrusted and preserve corrupt or unsupported values until `clear()` succeeds.
- Add only the explicitly approved development dependency `fake-indexeddb@6.2.5`.
- Follow TDD: run each named failing test before adding its implementation.
- Run `npm test` and `npm run typecheck` before completion.

## File map

| File | Responsibility |
|---|---|
| `src/persistence/service.ts` | Public result types, IndexedDB helpers, `ProjectPersistenceService`, debounce/write state, error mapping, and recovery gate. |
| `src/persistence/index.ts` | Public exports from the persistence package. |
| `test/persistence.test.ts` | Integration tests against a fresh `fake-indexeddb` factory per test. |
| `package.json` | Add `fake-indexeddb` as a development dependency. |
| `package-lock.json` | Lock the approved dependency version and transitive metadata. |

---

### Task 1: Load and validate the current IndexedDB record

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/persistence/service.ts`
- Create: `src/persistence/index.ts`
- Create: `test/persistence.test.ts`

**Interfaces:**
- Consumes: `Project`, `SoundCatalog`, `DomainError`, and `validateProject` from `src/project/index.ts`.
- Produces: `PersistenceError`, `LoadResult`, `ProjectPersistenceOptions`, and `ProjectPersistenceService.load(): Promise<LoadResult>`.

- [ ] **Step 1: Add the approved test dependency**

Run:

```bash
npm install --save-dev fake-indexeddb@6.2.5
```

Expected: `package.json` contains `"fake-indexeddb": "^6.2.5"`; no runtime dependency is added.

- [ ] **Step 2: Write failing empty, valid, corrupt, and unsupported load tests**

Create `test/persistence.test.ts` with isolated factories and raw-record helpers:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { IDBFactory } from "fake-indexeddb";

import {
  InvalidInputError,
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
```

- [ ] **Step 3: Run the focused tests and verify they fail**

Run:

```bash
node --disable-warning=ExperimentalWarning --test test/persistence.test.ts
```

Expected: FAIL because `src/persistence/index.ts` does not exist.

- [ ] **Step 4: Implement the public load types and native IndexedDB read path**

Create `src/persistence/service.ts` with these public contracts and constants:

```ts
import {
  DomainError,
  type Project,
  type SoundCatalog,
  validateProject,
} from "../project/index.ts";

const DATABASE_NAME = "agent-daw";
const DATABASE_VERSION = 1;
const STORE_NAME = "current-project";
const RECORD_KEY = "current";
const SUPPORTED_PROJECT_SCHEMA_VERSION = 1;

export type PersistenceErrorCode =
  | "storage_unavailable"
  | "quota_exceeded"
  | "corrupt_record"
  | "unsupported_schema"
  | "transaction_failed"
  | "recovery_required";

export interface PersistenceError {
  readonly code: PersistenceErrorCode;
  readonly message: string;
  readonly cause?: unknown;
}

export type LoadResult =
  | { readonly status: "loaded"; readonly project: Project; readonly updatedAt: number }
  | { readonly status: "empty" }
  | { readonly status: "failed"; readonly error: PersistenceError };

export interface ProjectPersistenceOptions {
  readonly indexedDB: IDBFactory;
  readonly catalog: SoundCatalog;
  readonly now: () => number;
  readonly debounceMs: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const persistenceError = (
  code: PersistenceErrorCode,
  message: string,
  cause?: unknown,
): PersistenceError => ({
  code,
  message,
  ...(cause === undefined ? {} : { cause }),
});

const mapStorageError = (error: unknown, action: string): PersistenceError => {
  if (!(error instanceof DOMException)) throw error;
  if (error.name === "QuotaExceededError") {
    return persistenceError("quota_exceeded", `${action} failed because browser storage is full`, error);
  }
  if (["SecurityError", "InvalidStateError", "NotSupportedError", "VersionError"].includes(error.name)) {
    return persistenceError("storage_unavailable", `${action} cannot access IndexedDB`, error);
  }
  return persistenceError("transaction_failed", `${action} failed in IndexedDB`, error);
};

const requestValue = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(
      request.error ?? new DOMException("IndexedDB request failed", "UnknownError"),
    );
  });

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(
      transaction.error ?? new DOMException("IndexedDB transaction failed", "UnknownError"),
    );
    transaction.onabort = () => reject(
      transaction.error ?? new DOMException("IndexedDB transaction aborted", "AbortError"),
    );
  });
```

Implement `ProjectPersistenceService` with constructor validation, cached database opening, read-only loading, schema discrimination, and recovery state:

```ts
export class ProjectPersistenceService {
  private readonly options: ProjectPersistenceOptions;
  private databasePromise?: Promise<IDBDatabase>;
  private recoveryRequired = false;

  constructor(options: ProjectPersistenceOptions) {
    if (!Number.isInteger(options.debounceMs) || options.debounceMs < 0) {
      throw new RangeError("Persistence debounceMs must be a non-negative integer");
    }
    this.options = options;
  }

  async load(): Promise<LoadResult> {
    try {
      const value = await this.readStoredValue();
      if (value === undefined) return { status: "empty" };
      return this.decodeStoredValue(value);
    } catch (error: unknown) {
      return { status: "failed", error: mapStorageError(error, "Project load") };
    }
  }

  private decodeStoredValue(value: unknown): LoadResult {
    if (!isRecord(value) || !isRecord(value.project)) {
      this.recoveryRequired = true;
      return { status: "failed", error: persistenceError("corrupt_record", "Stored project record is malformed") };
    }
    const schemaVersion = value.project.schemaVersion;
    if (typeof schemaVersion === "number" && Number.isInteger(schemaVersion)
      && schemaVersion !== SUPPORTED_PROJECT_SCHEMA_VERSION) {
      this.recoveryRequired = true;
      return { status: "failed", error: persistenceError("unsupported_schema", `Project schema ${schemaVersion} is unsupported`) };
    }
    if (!Number.isInteger(value.updatedAt) || (value.updatedAt as number) < 0) {
      this.recoveryRequired = true;
      return { status: "failed", error: persistenceError("corrupt_record", "Stored project update time is invalid") };
    }
    try {
      validateProject(value.project as unknown as Project, this.options.catalog);
    } catch (error: unknown) {
      if (!(error instanceof DomainError)) throw error;
      this.recoveryRequired = true;
      return { status: "failed", error: persistenceError("corrupt_record", "Stored project failed validation", error) };
    }
    return {
      status: "loaded",
      project: value.project as unknown as Project,
      updatedAt: value.updatedAt as number,
    };
  }
}
```

Add the database methods inside the class. On `versionchange`, close the connection and clear the cached promise. If opening fails, clear the rejected cached promise so a later call may retry:

```ts
private async openDatabase(): Promise<IDBDatabase> {
  if (this.databasePromise !== undefined) return this.databasePromise;
  let opening: Promise<IDBDatabase>;
  opening = new Promise((resolve, reject) => {
    const request = this.options.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    let blocked = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onblocked = () => {
      blocked = true;
      reject(new DOMException("IndexedDB upgrade is blocked", "InvalidStateError"));
    };
    request.onsuccess = () => {
      if (blocked) {
        request.result.close();
        return;
      }
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        if (this.databasePromise === opening) this.databasePromise = undefined;
      };
      resolve(database);
    };
    request.onerror = () => reject(
      request.error ?? new DOMException("IndexedDB open failed", "UnknownError"),
    );
  });
  this.databasePromise = opening;
  try {
    return await opening;
  } catch (error: unknown) {
    if (this.databasePromise === opening) this.databasePromise = undefined;
    throw error;
  }
}

private async readStoredValue(): Promise<unknown> {
  const database = await this.openDatabase();
  const transaction = database.transaction(STORE_NAME, "readonly");
  return requestValue(transaction.objectStore(STORE_NAME).get(RECORD_KEY));
}
```

Create `src/persistence/index.ts`:

```ts
export * from "./service.ts";
```

- [ ] **Step 5: Run the persistence tests and typecheck**

Run:

```bash
node --disable-warning=ExperimentalWarning --test test/persistence.test.ts
npm run typecheck
```

Expected: all four persistence tests PASS and typecheck exits 0.

- [ ] **Step 6: Commit the load boundary**

```bash
git add package.json package-lock.json src/persistence test/persistence.test.ts
git commit -m "feat: load persisted project"
```

---

### Task 2: Debounce, coalesce, and flush ordered saves

**Files:**
- Modify: `src/persistence/service.ts`
- Modify: `test/persistence.test.ts`

**Interfaces:**
- Consumes: `ProjectPersistenceService.load()` from Task 1.
- Produces: `SaveResult`, `FlushResult`, `scheduleSave(project: Project): Promise<SaveResult>`, and `flush(): Promise<FlushResult>`.

- [ ] **Step 1: Write failing round-trip, coalescing, clone, ordering, and idle-flush tests**

Append tests using Node mock timers:

```ts
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
```

- [ ] **Step 2: Run the new save tests and verify they fail**

Run:

```bash
node --disable-warning=ExperimentalWarning --test --test-name-pattern="scheduleSave|queued during|flush is idle" test/persistence.test.ts
```

Expected: FAIL because `scheduleSave` and `flush` are not defined.

- [ ] **Step 3: Add save results and the one-active/one-pending state machine**

Add these public result types:

```ts
export type SaveResult =
  | { readonly status: "saved"; readonly updatedAt: number }
  | { readonly status: "cancelled_by_clear" }
  | { readonly status: "failed"; readonly error: PersistenceError };

export type FlushResult = SaveResult | { readonly status: "idle" };
```

Use one internal deferred pending value, not a list of callbacks:

```ts
interface PendingSave {
  project: Project;
  readonly promise: Promise<SaveResult>;
  readonly resolve: (result: SaveResult) => void;
  readonly reject: (error: unknown) => void;
}

const createPendingSave = (project: Project): PendingSave => {
  let resolveResult: ((result: SaveResult) => void) | undefined;
  let rejectResult: ((error: unknown) => void) | undefined;
  const promise = new Promise<SaveResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  if (resolveResult === undefined || rejectResult === undefined) {
    throw new Error("Failed to create pending persistence result");
  }
  return { project, promise, resolve: resolveResult, reject: rejectResult };
};
```

Add class state for `pending`, `pendingReady`, one debounce timer, and one `activeWrite`. `scheduleSave` must be non-`async` so coalesced callers receive the exact same promise:

```ts
scheduleSave(project: Project): Promise<SaveResult> {
  if (this.recoveryRequired) {
    return Promise.resolve({
      status: "failed",
      error: persistenceError("recovery_required", "Clear the unreadable stored project before saving"),
    });
  }
  validateProject(project, this.options.catalog);
  const clone = structuredClone(project);
  if (this.pending === undefined) this.pending = createPendingSave(clone);
  else this.pending.project = clone;
  this.pendingReady = false;
  this.resetTimer();
  return this.pending.promise;
}

async flush(): Promise<FlushResult> {
  if (this.recoveryRequired) {
    return {
      status: "failed",
      error: persistenceError("recovery_required", "Clear the unreadable stored project before flushing"),
    };
  }
  if (this.pending !== undefined) {
    this.cancelTimer();
    this.pendingReady = true;
    const result = this.pending.promise;
    this.startPendingIfIdle();
    return result;
  }
  return this.activeWrite === undefined ? { status: "idle" } : this.activeWrite;
}
```

Implement timer and write progression so a ready successor stays cancellable while another transaction is active:

```ts
private resetTimer(): void {
  this.cancelTimer();
  this.timer = setTimeout(() => {
    this.timer = undefined;
    this.pendingReady = true;
    this.startPendingIfIdle();
  }, this.options.debounceMs);
}

private cancelTimer(): void {
  if (this.timer === undefined) return;
  clearTimeout(this.timer);
  this.timer = undefined;
}

private startPendingIfIdle(): void {
  if (this.activeWrite !== undefined || !this.pendingReady || this.pending === undefined) return;
  const pending = this.pending;
  this.pending = undefined;
  this.pendingReady = false;
  const operation = this.writeProject(pending.project);
  this.activeWrite = operation;
  void operation.then(
    (result) => {
      pending.resolve(result);
      this.finishWrite(operation);
    },
    (error: unknown) => {
      pending.reject(error);
      this.finishWrite(operation);
    },
  );
}

private finishWrite(operation: Promise<SaveResult>): void {
  if (this.activeWrite === operation) this.activeWrite = undefined;
  this.startPendingIfIdle();
}
```

Declare `timer?: ReturnType<typeof setTimeout>`, `pending?: PendingSave`, `pendingReady = false`, and `activeWrite?: Promise<SaveResult>` as private class state. Unexpected programming failures reject the pending promise; expected IndexedDB failures resolve as `SaveResult.status === "failed"`.

Implement `writeProject` with a validated non-negative integer timestamp and one read-write transaction:

```ts
private async writeProject(project: Project): Promise<SaveResult> {
  const updatedAt = this.options.now();
  if (!Number.isInteger(updatedAt) || updatedAt < 0) {
    throw new RangeError("Persistence clock must return a non-negative integer");
  }
  try {
    const database = await this.openDatabase();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({ project, updatedAt }, RECORD_KEY);
    await transactionDone(transaction);
    return { status: "saved", updatedAt };
  } catch (error: unknown) {
    return { status: "failed", error: mapStorageError(error, "Project save") };
  }
}
```

- [ ] **Step 4: Run focused and complete persistence tests**

Run:

```bash
node --disable-warning=ExperimentalWarning --test test/persistence.test.ts
npm run typecheck
```

Expected: all persistence tests PASS and typecheck exits 0.

- [ ] **Step 5: Commit ordered autosave**

```bash
git add src/persistence/service.ts test/persistence.test.ts
git commit -m "feat: autosave current project"
```

---

### Task 3: Add explicit clear and recovery barriers

**Files:**
- Modify: `src/persistence/service.ts`
- Modify: `test/persistence.test.ts`

**Interfaces:**
- Consumes: pending and active save state from Task 2.
- Produces: `ClearResult` and `clear(): Promise<ClearResult>`; `scheduleSave` and `flush` gain clear-barrier behavior.

- [ ] **Step 1: Write failing recovery and clear-concurrency tests**

Append:

```ts
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
```

- [ ] **Step 2: Run the clear tests and verify they fail**

Run:

```bash
node --disable-warning=ExperimentalWarning --test --test-name-pattern="clear|blocks saves" test/persistence.test.ts
```

Expected: FAIL because `clear` is not defined and saves are not clear-gated.

- [ ] **Step 3: Implement the exclusive clear operation**

Add:

```ts
export type ClearResult =
  | { readonly status: "cleared" }
  | { readonly status: "failed"; readonly error: PersistenceError };
```

Track `clearing` and `clearOperation`. Keep `clear` non-`async` so repeated calls return the same promise:

```ts
clear(): Promise<ClearResult> {
  if (this.clearOperation !== undefined) return this.clearOperation;
  this.clearing = true;
  this.cancelTimer();
  if (this.pending !== undefined) {
    this.pending.resolve({ status: "cancelled_by_clear" });
    this.pending = undefined;
    this.pendingReady = false;
  }
  const operation = this.performClear();
  this.clearOperation = operation;
  void operation.then(
    () => this.finishClear(operation),
    () => this.finishClear(operation),
  );
  return operation;
}
```

`performClear` awaits the current active write, deletes `current` in one transaction without parsing it, and resets `recoveryRequired` only after commit. Expected deletion failures return a failed `ClearResult`; unexpected failures reject. Update `scheduleSave` and `flush` to return `cancelled_by_clear` while `clearing` is true.

Add this guard before their recovery checks:

```ts
if (this.clearing) return Promise.resolve({ status: "cancelled_by_clear" });
```

Because `flush` is `async`, its equivalent may return `{ status: "cancelled_by_clear" }` directly.

Use these exact helpers:

```ts
private async performClear(): Promise<ClearResult> {
  if (this.activeWrite !== undefined) await this.activeWrite;
  try {
    const database = await this.openDatabase();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(RECORD_KEY);
    await transactionDone(transaction);
    this.recoveryRequired = false;
    return { status: "cleared" };
  } catch (error: unknown) {
    return { status: "failed", error: mapStorageError(error, "Project clear") };
  }
}

private finishClear(operation: Promise<ClearResult>): void {
  if (this.clearOperation !== operation) return;
  this.clearOperation = undefined;
  this.clearing = false;
}
```

- [ ] **Step 4: Run the persistence tests and typecheck**

Run:

```bash
node --disable-warning=ExperimentalWarning --test test/persistence.test.ts
npm run typecheck
```

Expected: all persistence tests PASS and typecheck exits 0.

- [ ] **Step 5: Commit recovery-aware clear**

```bash
git add src/persistence/service.ts test/persistence.test.ts
git commit -m "feat: clear persisted project safely"
```

---

### Task 4: Verify failure mapping and preserve the last durable record

**Files:**
- Modify: `src/persistence/service.ts`
- Modify: `test/persistence.test.ts`

**Interfaces:**
- Consumes: all public persistence contracts from Tasks 1-3.
- Produces: verified mappings for `storage_unavailable`, `quota_exceeded`, and `transaction_failed`; no new public abstraction.

- [ ] **Step 1: Add focused failure-injection helpers and tests**

Use the native `IDBFactory` constructor seam rather than adding a production storage interface. Add a tiny open-failure stub and a proxy that makes only read-write transactions throw:

```ts
const failingOpenFactory = (error: DOMException): IDBFactory => ({
  open: () => { throw error; },
}) as unknown as IDBFactory;

const failingNextReadwriteFactory = (indexedDB: IDBFactory, error: DOMException): IDBFactory => {
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
```

Append tests:

```ts
test("load maps unavailable IndexedDB", async () => {
  const service = createService(failingOpenFactory(new DOMException("blocked", "SecurityError")));
  const result = await service.load();
  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.equal(result.error.code, "storage_unavailable");
});

test("a failed save preserves the last durable record", async () => {
  const indexedDB = new IDBFactory();
  const original = { ...blankProject(), name: "Durable" };
  await seedRawRecord(indexedDB, { project: original, updatedAt: 123 });
  const service = createService(failingNextReadwriteFactory(
    indexedDB,
    new DOMException("full", "QuotaExceededError"),
  ));
  service.scheduleSave({ ...blankProject(), name: "Rejected" });

  const result = await service.flush();

  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.equal(result.error.code, "quota_exceeded");
  const loaded = await createService(indexedDB).load();
  assert.equal(loaded.status === "loaded" ? loaded.project.name : undefined, "Durable");
});

test("failed clear keeps the recovery gate active", async () => {
  const indexedDB = new IDBFactory();
  await seedRawRecord(indexedDB, { project: { broken: true }, updatedAt: 123 });
  const service = createService(failingNextReadwriteFactory(
    indexedDB,
    new DOMException("aborted", "AbortError"),
  ));
  await service.load();

  const clear = await service.clear();
  const save = await service.scheduleSave(blankProject());

  assert.equal(clear.status, "failed");
  if (clear.status === "failed") assert.equal(clear.error.code, "transaction_failed");
  assert.equal(save.status, "failed");
  if (save.status === "failed") assert.equal(save.error.code, "recovery_required");
});

test("a newer save still runs after an earlier write fails", async () => {
  const indexedDB = new IDBFactory();
  const service = createService(failingNextReadwriteFactory(
    indexedDB,
    new DOMException("aborted", "AbortError"),
  ));
  service.scheduleSave({ ...blankProject(), name: "Failed" });
  assert.equal((await service.flush()).status, "failed");

  service.scheduleSave({ ...blankProject(), name: "Recovered" });
  assert.equal((await service.flush()).status, "saved");
  const loaded = await createService(indexedDB).load();
  assert.equal(loaded.status === "loaded" ? loaded.project.name : undefined, "Recovered");
});
```

- [ ] **Step 2: Run the failure tests and verify the first implementation gaps**

Run:

```bash
node --disable-warning=ExperimentalWarning --test --test-name-pattern="unavailable|failed save|failed clear|newer save" test/persistence.test.ts
```

Expected: at least one test FAIL until synchronous IndexedDB exceptions and failed-clear recovery are mapped exactly as specified.

- [ ] **Step 3: Tighten error boundaries without swallowing programming failures**

Ensure only `DOMException` values become `PersistenceError`. Keep timestamp failures, invalid outbound projects, and other non-storage exceptions rejected or thrown. Add this regression test:

```ts
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
```

- [ ] **Step 4: Run all verification commands**

Run:

```bash
npm test
npm run typecheck
git diff --check
git status --short
```

Expected: 102 existing project tests plus all persistence tests PASS; typecheck and diff check exit 0; status lists only intended Task 4 changes.

Do not add an application shell solely for the browser smoke test. The Codex in-app browser has already passed a direct IndexedDB write/read capability probe; perform edit → autosave → reload → restore only when the real application shell exists.

- [ ] **Step 5: Commit failure coverage**

```bash
git add src/persistence/service.ts test/persistence.test.ts
git commit -m "test: cover persistence failures"
```

---

### Task 5: Final branch verification and handoff

**Files:**
- Review only: `src/persistence/service.ts`
- Review only: `src/persistence/index.ts`
- Review only: `test/persistence.test.ts`
- Review only: `package.json`
- Review only: `package-lock.json`

**Interfaces:**
- Consumes: completed service from Tasks 1-4.
- Produces: verified implementation ready for code review; no source changes unless verification finds a defect.

- [ ] **Step 1: Confirm scope and public exports**

Run:

```bash
rg -n "ProjectPersistenceService|LoadResult|SaveResult|FlushResult|ClearResult" src/persistence
rg -n "history|HistoryEntry|historyCursor" src/persistence test/persistence.test.ts || true
```

Expected: all five persistence contracts are exported; no history persistence exists.

- [ ] **Step 2: Run the clean verification suite**

Run:

```bash
npm test
npm run typecheck
git diff --check main...HEAD
git status --short --branch
```

Expected: every test passes, typecheck exits 0, committed diff has no whitespace errors, and the worktree is clean.

- [ ] **Step 3: Review the complete branch diff**

Run:

```bash
git diff --stat main...HEAD
git diff main...HEAD -- package.json src/persistence test/persistence.test.ts
```

Expected: one development dependency, two production files, one test file, and the approved design/plan documents; no unrelated refactor.

- [ ] **Step 4: Record the verification evidence**

In the implementation handoff, report the exact test count, typecheck result, commits created, and the deferred full-app reload smoke test. Do not claim UI autosave wiring exists; this plan implements only the persistence service boundary.
