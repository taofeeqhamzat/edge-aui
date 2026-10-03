/**
 * Durable Local Session Store
 *
 * The testbed previously held the whole session in memory: a reload, a crash or a closed tab
 * lost everything, and the only exit was a manual JSON download from the developer panel
 * (assessment F-16). That is not survivable collection, for a scripted run or otherwise.
 *
 * This module adds a small write-ahead store so an in-progress session survives a reload and
 * a completed trace survives a failed upload. It is deliberately not an offline-sync system:
 * one session record, one trace snapshot, an explicit status, and an explicit retry.
 *
 * The IndexedDB backend is injectable so the logic can be tested without a browser and so a
 * non-browser environment degrades to "no local durability" rather than throwing.
 */

/** Lifecycle of a locally recorded session. */
export type LocalSessionStatus =
  | 'in_progress'
  | 'completed'
  | 'uploaded'
  | 'upload_failed'
  | 'incomplete';

/** Collection state surfaced to the researcher. */
export type CollectionState =
  | 'not_configured'
  | 'pending'
  | 'uploading'
  | 'uploaded'
  | 'failed'
  | 'local_only';

export interface StoredSessionMetadata {
  sessionId: string;
  experimentId?: string;
  conditionId?: string;
  provenance: 'scripted' | 'participant';
  taskId?: string | null;
  startedAtEpochMs: number;
  /** Canonical clock reading when the session was last written. */
  updatedAtEpochMs: number;
  completedAtEpochMs?: number;
  status: LocalSessionStatus;
  /** Why the session is incomplete, when it is. */
  incompleteReason?: string;
  traceSchemaVersion?: string;
  applicationVersion?: string;
  /** Attempts made to upload this session. */
  uploadAttempts: number;
  lastUploadError?: string;
  /** Token included with the upload so a retry cannot create a second row. */
  uploadToken: string;
}

export interface StoredTrace {
  sessionId: string;
  trace: unknown;
  updatedAtEpochMs: number;
  /** True once the trace has been uploaded and can be pruned locally. */
  uploaded: boolean;
}

/**
 * Minimal key-value contract the store needs.
 *
 * Narrower than IndexedDB's own API on purpose: the store's logic is about session
 * lifecycle, not about transactions, and a narrow port keeps that separable and testable.
 */
export interface SessionStorageBackend {
  get(store: 'sessions' | 'traces', key: string): Promise<unknown>;
  put(store: 'sessions' | 'traces', value: StoredSessionMetadata | StoredTrace): Promise<void>;
  delete(store: 'sessions' | 'traces', key: string): Promise<void>;
  getAllSessions(): Promise<StoredSessionMetadata[]>;
  clear(): Promise<void>;
}

const DB_NAME = 'edge-aui-research';
const DB_VERSION = 1;
const SESSION_STORE = 'sessions';
const TRACE_STORE = 'traces';

/**
 * Generates the idempotency token for one session's upload.
 *
 * Used as the conflict target so a retry after a timeout cannot create a duplicate row.
 * Derived from the session id, which is already unique per session, plus a random suffix so
 * a deliberately re-created session id would still be distinguishable.
 */
export function generateUploadToken(sessionId: string): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${sessionId}:${random}`;
}

/** IndexedDB-backed implementation. Unavailable environments return a null backend. */
function createIndexedDbBackend(): SessionStorageBackend | null {
  if (typeof indexedDB === 'undefined') return null;

  let dbPromise: Promise<IDBDatabase> | null = null;

  const open = (): Promise<IDBDatabase> => {
    if (!dbPromise) {
      dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(SESSION_STORE)) {
            db.createObjectStore(SESSION_STORE, { keyPath: 'sessionId' });
          }
          if (!db.objectStoreNames.contains(TRACE_STORE)) {
            db.createObjectStore(TRACE_STORE, { keyPath: 'sessionId' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
      });
    }
    return dbPromise;
  };

  const withStore = async <T>(
    store: string,
    mode: IDBTransactionMode,
    run: (s: IDBObjectStore) => IDBRequest<T>
  ): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const request = run(tx.objectStore(store));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    });
  };

  return {
    get: (store, key) => withStore<unknown>(store, 'readonly', (s) => s.get(key)),
    put: async (store, value) => {
      await withStore(store, 'readwrite', (s) => s.put(value));
    },
    delete: async (store, key) => {
      await withStore(store, 'readwrite', (s) => s.delete(key));
    },
    getAllSessions: () => withStore<StoredSessionMetadata[]>(SESSION_STORE, 'readonly', (s) => s.getAll()),
    clear: async () => {
      await withStore(SESSION_STORE, 'readwrite', (s) => s.clear());
      await withStore(TRACE_STORE, 'readwrite', (s) => s.clear());
    }
  };
}

/** In-memory backend, used when IndexedDB is unavailable and by tests. */
export function createMemoryBackend(): SessionStorageBackend {
  const sessions = new Map<string, StoredSessionMetadata>();
  const traces = new Map<string, StoredTrace>();
  return {
    get: async (store, key) =>
      store === 'sessions' ? sessions.get(key) ?? null : traces.get(key) ?? null,
    put: async (store, value) => {
      if (store === 'sessions') {
        sessions.set(value.sessionId, value as StoredSessionMetadata);
      } else {
        traces.set(value.sessionId, value as StoredTrace);
      }
    },
    delete: async (store, key) => {
      if (store === 'sessions') sessions.delete(key);
      else traces.delete(key);
    },
    getAllSessions: async () => Array.from(sessions.values()),
    clear: async () => {
      sessions.clear();
      traces.clear();
    }
  };
}

export class LocalSessionStore {
  private backend: SessionStorageBackend | null;
  /** False when no durable backend is available; surfaced instead of silently no-op'ing. */
  public readonly durable: boolean;

  constructor(backend?: SessionStorageBackend | null) {
    if (backend !== undefined) {
      this.backend = backend;
      this.durable = backend !== null;
    } else {
      this.backend = createIndexedDbBackend();
      this.durable = this.backend !== null;
    }
  }

  /** Starts or re-opens the record for a session. */
  public async beginSession(
    metadata: Omit<
      StoredSessionMetadata,
      'updatedAtEpochMs' | 'uploadAttempts' | 'uploadToken' | 'status'
    > & { status?: LocalSessionStatus; uploadToken?: string }
  ): Promise<StoredSessionMetadata> {
    const existing = await this.getSession(metadata.sessionId);
    const record: StoredSessionMetadata = {
      ...metadata,
      status: metadata.status ?? existing?.status ?? 'in_progress',
      updatedAtEpochMs: Date.now(),
      uploadAttempts: existing?.uploadAttempts ?? 0,
      uploadToken: metadata.uploadToken ?? existing?.uploadToken ?? generateUploadToken(metadata.sessionId),
      lastUploadError: existing?.lastUploadError
    };
    await this.backend?.put('sessions', record);
    return record;
  }

  public async getSession(sessionId: string): Promise<StoredSessionMetadata | null> {
    if (!this.backend) return null;
    return (await this.backend.get('sessions', sessionId)) as StoredSessionMetadata | null;
  }

  public async listSessions(): Promise<StoredSessionMetadata[]> {
    if (!this.backend) return [];
    const sessions = await this.backend.getAllSessions();
    return sessions.sort((a, b) => b.updatedAtEpochMs - a.updatedAtEpochMs);
  }

  /**
   * Persists the latest trace snapshot for a session.
   *
   * Called periodically and on completion. The snapshot replaces the previous one rather
   * than accumulating, so local storage cannot grow without bound within a session.
   */
  public async saveTrace(sessionId: string, trace: unknown): Promise<void> {
    await this.backend?.put('traces', {
      sessionId,
      trace,
      updatedAtEpochMs: Date.now(),
      uploaded: false
    } satisfies StoredTrace);
  }

  public async getTrace(sessionId: string): Promise<StoredTrace | null> {
    if (!this.backend) return null;
    return (await this.backend.get('traces', sessionId)) as StoredTrace | null;
  }

  public async markCompleted(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) return;
    await this.backend?.put('sessions', {
      ...session,
      status: 'completed',
      completedAtEpochMs: Date.now(),
      updatedAtEpochMs: Date.now()
    } satisfies StoredSessionMetadata);
  }

  /** Raises the upload attempt count and records why it failed. */
  public async markUploadFailed(sessionId: string, error: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) return;
    await this.backend?.put('sessions', {
      ...session,
      status: 'upload_failed',
      uploadAttempts: session.uploadAttempts + 1,
      lastUploadError: error,
      updatedAtEpochMs: Date.now()
    } satisfies StoredSessionMetadata);
  }

  public async markUploaded(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (session) {
      await this.backend?.put('sessions', {
        ...session,
        status: 'uploaded',
        lastUploadError: undefined,
        updatedAtEpochMs: Date.now()
      } satisfies StoredSessionMetadata);
    }
  }

  /**
   * Marks a session that was left open by a previous page load.
   *
   * This is the recovery decision that matters most: a session interrupted by a reload is
   * *incomplete*, and must never be presented or uploaded as a finished capture.
   */
  public async markIncomplete(sessionId: string, reason: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) return;
    await this.backend?.put('sessions', {
      ...session,
      status: 'incomplete',
      incompleteReason: reason,
      updatedAtEpochMs: Date.now()
    } satisfies StoredSessionMetadata);
  }

  /**
   * Finds a session that was still open when the page last unloaded.
   *
   * Returns it so the caller can offer recovery rather than silently discarding it, which is
   * what "reload does not silently discard a recoverable session" requires.
   */
  public async findRecoverableSession(): Promise<StoredSessionMetadata | null> {
    const sessions = await this.listSessions();
    return sessions.find((s) => s.status === 'in_progress') ?? null;
  }

  /** Sessions that are complete but not yet uploaded. */
  public async listPendingUploads(): Promise<StoredSessionMetadata[]> {
    const sessions = await this.listSessions();
    return sessions.filter((s) => s.status === 'completed' || s.status === 'upload_failed');
  }

  /** Removes a session record and its trace. */
  public async discard(sessionId: string): Promise<void> {
    await this.backend?.delete('sessions', sessionId);
    await this.backend?.delete('traces', sessionId);
  }

  public async clearAll(): Promise<void> {
    await this.backend?.clear();
  }
}
