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

export type SaveResult =
  | { readonly status: "saved"; readonly updatedAt: number }
  | { readonly status: "cancelled_by_clear" }
  | { readonly status: "failed"; readonly error: PersistenceError };

export type FlushResult = SaveResult | { readonly status: "idle" };

export type ClearResult =
  | { readonly status: "cleared" }
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

export class ProjectPersistenceService {
  private readonly options: ProjectPersistenceOptions;
  private databasePromise: Promise<IDBDatabase> | undefined;
  private recoveryRequired = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: PendingSave | undefined;
  private pendingReady = false;
  private activeWrite: Promise<SaveResult> | undefined;
  private clearing = false;
  private clearOperation: Promise<ClearResult> | undefined;

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

  scheduleSave(project: Project): Promise<SaveResult> {
    if (this.clearing) return Promise.resolve({ status: "cancelled_by_clear" });
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
    if (this.clearing) return { status: "cancelled_by_clear" };
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

  private decodeStoredValue(value: unknown): LoadResult {
    if (!isRecord(value) || !isRecord(value.project)) {
      this.enterRecovery();
      return { status: "failed", error: persistenceError("corrupt_record", "Stored project record is malformed") };
    }
    const schemaVersion = value.project.schemaVersion;
    if (typeof schemaVersion === "number" && Number.isInteger(schemaVersion)
      && schemaVersion !== SUPPORTED_PROJECT_SCHEMA_VERSION) {
      this.enterRecovery();
      return { status: "failed", error: persistenceError("unsupported_schema", `Project schema ${schemaVersion} is unsupported`) };
    }
    if (!Number.isInteger(value.updatedAt) || (value.updatedAt as number) < 0) {
      this.enterRecovery();
      return { status: "failed", error: persistenceError("corrupt_record", "Stored project update time is invalid") };
    }
    try {
      validateProject(value.project as unknown as Project, this.options.catalog);
    } catch (error: unknown) {
      if (!(error instanceof DomainError)) throw error;
      this.enterRecovery();
      return { status: "failed", error: persistenceError("corrupt_record", "Stored project failed validation", error) };
    }
    return {
      status: "loaded",
      project: value.project as unknown as Project,
      updatedAt: value.updatedAt as number,
    };
  }

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
    if (this.recoveryRequired) {
      this.enterRecovery();
      return;
    }
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

  private enterRecovery(): void {
    this.recoveryRequired = true;
    this.cancelTimer();
    if (this.pending === undefined) return;
    const pending = this.pending;
    this.pending = undefined;
    this.pendingReady = false;
    pending.resolve({
      status: "failed",
      error: persistenceError("recovery_required", "Clear the unreadable stored project before saving"),
    });
  }

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
}
