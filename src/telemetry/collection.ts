/**
 * Research Trace Collection
 *
 * Owns the whole path from an in-memory trace to a durable research record:
 *
 *   recorder ──► local write-ahead (IndexedDB) ──► [provenance gate] ──► Supabase
 *
 * Three properties matter more than the mechanism:
 * 1. **Nothing is silent.** Every outcome is a state the researcher can read: not configured,
 *    pending, uploading, uploaded, failed (with the error), or local-only.
 * 2. **Failure is retryable.** A failed upload is kept locally with its attempt count and the
 *    reason, and can be retried deliberately. There are no hidden retries.
 * 3. **Provenance gates egress.** A trace may only leave the client when its declared
 *    provenance is permitted by the build's collection mode (ADR-018).
 */

import {
  resolveSupabaseCollectionConfig,
  mayUploadProvenance,
  type SupabaseCollectionConfig
} from '../config/supabaseConfig';
import { experimentRecorder } from './recorder';
import { sessionManager } from './session';
import {
  LocalSessionStore,
  type CollectionState,
  type SessionStorageBackend,
  type StoredSessionMetadata
} from './localStore';
import {
  ResearchCollectionClient,
  type UploadResult
} from './collectionClient';
import {
  TRACE_CLOCK_MODE,
  EXPERIMENT_TRACE_SCHEMA_VERSION,
  type SerializableExperimentTrace
} from './traceSchema';
import { APPLICATION_VERSION, POLICY_VERSION } from './version';

export interface CollectionStatus {
  state: CollectionState;
  /** Whether a durable local store is available at all. */
  durable: boolean;
  /** Whether upload is configured for this build. */
  configured: boolean;
  mode: SupabaseCollectionConfig['mode'];
  currentSessionId?: string;
  uploadAttempts: number;
  lastError?: string;
  /** A session left open by a previous page load, if one was found. */
  recoverableSessionId?: string;
  /** Why the recoverable session is incomplete. */
  recoverableReason?: string;
  pendingUploads: number;
}

export interface CollectionOptions {
  config?: SupabaseCollectionConfig;
  store?: LocalSessionStore;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Derives the upload payload from an exported trace.
 *
 * Kept separate from the transport so the mapping is testable and reviewable on its own:
 * this function is where "what leaves the browser" is decided.
 */
export function buildSessionRecord(
  trace: SerializableExperimentTrace,
  uploadToken: string
): Parameters<ResearchCollectionClient['createSession']>[0] {
  const session = trace.session;
  const metadata = trace.metadata;

  return {
    session_id: session.sessionId,
    upload_token: uploadToken,
    experiment_id: session.experimentId ?? metadata?.experimentId ?? null,
    condition_id: session.conditionId ?? metadata?.conditionId ?? null,
    provenance: session.provenance ?? metadata?.provenance ?? 'scripted',
    participant_id: session.participantId ?? null,
    task_id: session.taskId ?? trace.task?.currentTaskId ?? null,
    trace_schema_version: trace.schemaVersion,
    application_version: metadata?.applicationVersion ?? APPLICATION_VERSION,
    model_version: metadata?.modelVersion ?? null,
    policy_version: metadata?.policyVersion ?? POLICY_VERSION,
    status: metadata?.finalTaskStatus ?? 'unknown',
    started_at:
      typeof session.startedAtEpochMs === 'number' && session.startedAtEpochMs > 0
        ? new Date(session.startedAtEpochMs).toISOString()
        : null,
    completed_at: null,
    metadata: {
      clock: metadata?.clock ?? TRACE_CLOCK_MODE,
      traceSchemaVersion: trace.schemaVersion,
      conditionId: metadata?.conditionId ?? null,
      finalTaskStatus: metadata?.finalTaskStatus ?? null,
      evidenceProvider: metadata?.executionProvider ?? null,
      uiVersion: metadata?.uiVersion ?? null,
      settlementDelayMs: metadata?.settlementDelayMs ?? null,
      // Integrity warnings and truncation evidence travel with the record: a consumer must be
      // able to tell a whole capture from a truncated one without re-deriving it.
      integrityWarnings: metadata?.integrityWarnings ?? [],
      evictions: metadata?.evictions ?? null,
      mining: metadata?.mining ?? null
    }
  };
}

export class ResearchCollection {
  private readonly store: LocalSessionStore;
  private readonly client: ResearchCollectionClient;
  private readonly config: SupabaseCollectionConfig;

  private state: CollectionState;
  private lastError?: string;
  private recoverable: StoredSessionMetadata | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: CollectionOptions = {}) {
    this.config = options.config ?? resolveSupabaseCollectionConfig();
    this.store = options.store ?? new LocalSessionStore();
    this.client = new ResearchCollectionClient({
      config: this.config,
      fetchImpl: options.fetchImpl
    });
    // `local_only` is distinct from `not_configured`: one means the build has no store, the
    // other means it has one but was never given anywhere to send traces.
    this.state = this.config.configured ? 'pending' : this.store.durable ? 'local_only' : 'not_configured';
  }

  public getStatus(): CollectionStatus {
    return {
      state: this.state,
      durable: this.store.durable,
      configured: this.config.configured,
      mode: this.config.mode,
      currentSessionId: experimentRecorder.getSessionId(),
      uploadAttempts: this.recoverable?.uploadAttempts ?? 0,
      lastError: this.lastError,
      recoverableSessionId: this.recoverable?.sessionId,
      recoverableReason: this.recoverable?.incompleteReason,
      pendingUploads: 0
    };
  }

  /**
   * Registers the active session locally and detects one left open by a previous load.
   *
   * Detection is reported, never auto-recovered: silently resuming a session would mix two
   * page loads' telemetry into one record and call it complete.
   */
  public async beginSession(): Promise<CollectionStatus> {
    const session = sessionManager.getActiveSession();
    if (!session) return this.getStatus();

    this.recoverable = await this.store.findRecoverableSession();
    if (this.recoverable && this.recoverable.sessionId !== session.sessionId) {
      await this.store.markIncomplete(
        this.recoverable.sessionId,
        'Page was reloaded or closed while this session was still in progress'
      );
    }

    await this.store.beginSession({
      sessionId: session.sessionId,
      experimentId: session.experimentId,
      conditionId: session.conditionId,
      provenance: session.provenance ?? 'scripted',
      taskId: session.taskId ?? null,
      startedAtEpochMs: session.startedAtEpochMs ?? Date.now(),
      traceSchemaVersion: EXPERIMENT_TRACE_SCHEMA_VERSION,
      applicationVersion: APPLICATION_VERSION
    });

    return this.getStatus();
  }

  /**
   * Periodically writes the current trace snapshot locally.
   *
   * This is the write-ahead that makes a reload survivable. It runs on a timer rather than
   * per event so a dense pointer stream does not turn every event into a storage write.
   */
  public startPeriodicFlush(intervalMs = 5000): void {
    if (!this.store.durable || this.flushTimer !== null) return;
    this.flushTimer = setInterval(() => {
      void this.flushLocal();
    }, intervalMs);
  }

  public stopPeriodicFlush(): void {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /** Writes the current trace snapshot to the local store. */
  public async flushLocal(): Promise<void> {
    const sessionId = experimentRecorder.getSessionId();
    if (!sessionId || !this.store.durable) return;
    try {
      await this.store.saveTrace(sessionId, experimentRecorder.exportSerializable());
    } catch (err) {
      console.warn('[ResearchCollection] Local trace flush failed:', err);
    }
  }

  /**
   * Completes the session: persist locally, then attempt upload if permitted.
   *
   * Returns the resulting status. A failure never throws — losing the session is worse than a
   * failed upload, so the local record is kept regardless.
   */
  public async completeSession(): Promise<CollectionStatus> {
    const session = sessionManager.getActiveSession();
    const sessionId = experimentRecorder.getSessionId() ?? session?.sessionId;
    if (!sessionId) return this.getStatus();

    const trace = experimentRecorder.exportSerializable();

    if (this.store.durable) {
      await this.store.saveTrace(sessionId, trace);
      await this.store.markCompleted(sessionId);
    }

    const provenance = trace.session.provenance ?? trace.metadata?.provenance ?? 'scripted';

    if (!this.config.configured) {
      this.state = this.store.durable ? 'local_only' : 'not_configured';
      this.lastError = undefined;
      return this.getStatus();
    }

    if (!mayUploadProvenance(provenance, this.config.mode)) {
      // Refused by the provenance gate, not by a technical failure. Recorded as such so the
      // reason is never mistaken for a network problem.
      this.state = 'local_only';
      this.lastError = `Upload refused: provenance '${provenance}' is not permitted by collection mode '${this.config.mode}'`;
      return this.getStatus();
    }

    return this.upload(sessionId, trace);
  }

  /**
   * Uploads one session, idempotently.
   *
   * Called on completion and by an explicit researcher retry. The session row is inserted
   * first and the trace second, so a partial failure leaves a session record whose trace is
   * missing rather than an orphaned trace nobody can find.
   */
  public async upload(sessionId: string, trace?: SerializableExperimentTrace): Promise<CollectionStatus> {
    this.state = 'uploading';

    let record = await this.store.getSession(sessionId);
    let payload = trace;

    if (!payload) {
      const stored = await this.store.getTrace(sessionId);
      payload = stored?.trace as SerializableExperimentTrace | undefined;
    }
    if (!payload) {
      this.state = 'failed';
      this.lastError = 'No trace snapshot is available to upload';
      return this.getStatus();
    }

    if (!record) {
      // A recovery path: the trace exists locally but its metadata record was lost. Create
      // one so the upload is still attributable.
      record = await this.store.beginSession({
        sessionId,
        experimentId: payload.session.experimentId,
        conditionId: payload.session.conditionId,
        provenance: payload.session.provenance ?? 'scripted',
        taskId: payload.session.taskId ?? null,
        startedAtEpochMs: payload.session.startedAtEpochMs ?? Date.now()
      });
    }

    const sessionResult: UploadResult = await this.client.createSession(
      buildSessionRecord(payload, record.uploadToken)
    );
    if (!sessionResult.ok) {
      return this.recordFailure(sessionId, `Session record rejected: ${sessionResult.error}`);
    }

    const traceResult: UploadResult = await this.client.uploadTrace({
      session_id: sessionId,
      upload_token: record.uploadToken,
      trace: payload,
      trace_schema_version: payload.schemaVersion
    });
    if (!traceResult.ok) {
      return this.recordFailure(sessionId, `Trace payload rejected: ${traceResult.error}`);
    }

    await this.store.markUploaded(sessionId);
    this.state = 'uploaded';
    this.lastError = undefined;
    return this.getStatus();
  }

  /** Retries every session that is complete but not uploaded. */
  public async retryPendingUploads(): Promise<CollectionStatus> {
    if (!this.config.configured) {
      this.state = this.store.durable ? 'local_only' : 'not_configured';
      return this.getStatus();
    }

    const pending = await this.store.listPendingUploads();
    if (pending.length === 0) {
      this.state = 'uploaded';
      return this.getStatus();
    }

    for (const session of pending) {
      await this.upload(session.sessionId);
      if (this.state === 'failed') {
        // Stop at the first failure: a systematic problem (bad key, RLS misconfiguration)
        // should not be retried once per queued session.
        return this.getStatus();
      }
    }
    return this.getStatus();
  }

  private async recordFailure(sessionId: string, error: string): Promise<CollectionStatus> {
    this.state = 'failed';
    this.lastError = error;
    await this.store.markUploadFailed(sessionId, error);
    // Re-read so the surfaced attempt count is the stored one.
    this.recoverable = await this.store.getSession(sessionId);
    return this.getStatus();
  }

  /** Discards a session locally. Used by the researcher's discard control. */
  public async discard(sessionId: string): Promise<void> {
    await this.store.discard(sessionId);
    if (this.recoverable?.sessionId === sessionId) {
      this.recoverable = null;
    }
  }

  public async listSessions(): Promise<StoredSessionMetadata[]> {
    return this.store.listSessions();
  }
}

/**
 * Builds a collection instance with an explicit backend, for tests and for callers that
 * already own a store.
 */
export function createResearchCollection(
  options: CollectionOptions & { backend?: SessionStorageBackend }
): ResearchCollection {
  if (options.backend) {
    return new ResearchCollection({
      ...options,
      store: options.store ?? new LocalSessionStore(options.backend)
    });
  }
  return new ResearchCollection(options);
}
