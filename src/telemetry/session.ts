/**
 * Anonymous Session Lifecycle Manager
 * Implements Stage 4.3 specifications from docs/testbed/prd.md Section 32 & docs/plan/tasks/4.3.md.
 * Manages privacy-preserving session IDs without collecting PII.
 */

import {
  getMonotonicTimestamp,
  setSessionEpochAnchor,
  clearSessionEpochAnchor
} from './normalizer';
import type { ExperimentalCondition } from './events';

/**
 * Machine-readable provenance of a session's telemetry.
 *
 * This is not a label of convenience: it is the switch that decides whether a trace may
 * leave the client. `'scripted'` traces are synthetic, produced by automated/scripted
 * browser sessions, and never represent a human participant. `'participant'` traces
 * require an approved protocol and a consent workflow (ADR-018, ADR-023) and must never be
 * inferred or defaulted into.
 */
export type SessionProvenance = 'scripted' | 'participant';

export interface SessionContext {
  sessionId: string;
  /**
   * Monotonic start time (performance.now()). Retained for within-session deltas only;
   * it is not a legal trace timestamp because it resets on navigation.
   */
  startedAt: number;
  /**
   * Epoch start time (Date.now()). This is the anchor for the canonical trace clock
   * (schema 1.3.0): every trace record timestamp is epoch milliseconds derived from it.
   */
  startedAtEpochMs?: number;
  experimentId?: string;
  conditionId?: ExperimentalCondition;
  taskId?: string;
  /** Whether this telemetry is scripted/synthetic or participant-derived. */
  provenance?: SessionProvenance;
  /**
   * Opaque participant reference. Deliberately optional and never auto-populated: no
   * participant identifier scheme has been approved (ADR-023), and inventing one would
   * create a re-identification surface nobody agreed to.
   */
  participantId?: string | null;
}

export interface StartSessionOptions {
  taskId?: string;
  experimentId?: string;
  conditionId?: ExperimentalCondition;
  provenance?: SessionProvenance;
  participantId?: string | null;
}

export type SessionChangeListener = (session: SessionContext | null) => void;

/**
 * Generates an anonymous, cryptographically pseudo-random UUID v4 string.
 * Strictly free of PII or hardware identifiers.
 */
export function generateAnonymousSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Safe fallback for environments lacking crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export class SessionManager {
  private currentSession: SessionContext | null = null;
  private listeners: Set<SessionChangeListener> = new Set();

  /**
   * Starts a new experimental session with a fresh anonymous ID.
   * Accepts either a bare taskId (legacy call shape) or a full options object.
   */
  public startSession(taskOrOptions?: string | StartSessionOptions): SessionContext {
    const options: StartSessionOptions =
      typeof taskOrOptions === 'string' || taskOrOptions === undefined
        ? { taskId: taskOrOptions as string | undefined }
        : taskOrOptions;

    const startedAt = getMonotonicTimestamp();
    const startedAtEpochMs = Date.now();
    // Establish the canonical trace clock for this session before any record is written.
    setSessionEpochAnchor(startedAtEpochMs, startedAt);

    this.currentSession = {
      sessionId: generateAnonymousSessionId(),
      startedAt,
      startedAtEpochMs,
      experimentId: options.experimentId,
      conditionId: options.conditionId,
      taskId: options.taskId,
      // Default to the safe provenance. A caller must opt in explicitly to anything else.
      provenance: options.provenance ?? 'scripted',
      participantId: options.participantId ?? null
    };
    this.notify();
    return { ...this.currentSession };
  }

  /**
   * Sets the provenance of the active session. Used when a session is recovered from
   * local storage and its provenance must be restored exactly as recorded.
   */
  public setProvenance(provenance: SessionProvenance, participantId?: string | null): void {
    if (!this.currentSession) return;
    this.currentSession.provenance = provenance;
    if (participantId !== undefined) {
      this.currentSession.participantId = participantId;
    }
    this.notify();
  }

  /**
   * Updates the experimental condition for the active session
   * (e.g. switching between a baseline and an adaptive run).
   */
  public setCondition(conditionId: ExperimentalCondition): void {
    if (this.currentSession) {
      this.currentSession.conditionId = conditionId;
      this.notify();
    }
  }

  public getCondition(): ExperimentalCondition | undefined {
    return this.currentSession?.conditionId;
  }

  /**
   * Clears and resets the active session.
   */
  public resetSession(): void {
    this.currentSession = null;
    clearSessionEpochAnchor();
    this.notify();
  }

  /**
   * Restores a previously persisted session verbatim, including its identity, epoch
   * anchor and provenance, so a recovered trace is attributable to the session that
   * actually produced it rather than a freshly generated id.
   */
  public restoreSession(session: SessionContext): SessionContext {
    const restored: SessionContext = {
      ...session,
      provenance: session.provenance ?? 'scripted',
      participantId: session.participantId ?? null
    };
    if (typeof restored.startedAtEpochMs === 'number' && restored.startedAtEpochMs > 0) {
      // Re-anchor against this page's monotonic origin. `restored.startedAt` came from a
      // previous page load, whose monotonic origin no longer applies, so the current
      // monotonic reading is the correct companion value for the preserved epoch start.
      setSessionEpochAnchor(restored.startedAtEpochMs, getMonotonicTimestamp());
    }
    this.currentSession = restored;
    this.notify();
    return { ...restored };
  }

  /**
   * Updates task association for the active session.
   */
  public completeTask(taskId?: string): void {
    if (this.currentSession && taskId) {
      this.currentSession.taskId = taskId;
      this.notify();
    }
  }

  /**
   * Associates a task id with the active session, clearing it when undefined.
   */
  public setTaskId(taskId?: string): void {
    if (!this.currentSession) return;
    this.currentSession.taskId = taskId;
    this.notify();
  }

  /**
   * Returns a copy of the active session context, or null if no session is active.
   */
  public getActiveSession(): SessionContext | null {
    return this.currentSession ? { ...this.currentSession } : null;
  }

  /**
   * Returns true if a session is currently active.
   */
  public isSessionActive(): boolean {
    return this.currentSession !== null;
  }

  /**
   * Subscribes to session lifecycle changes (start, reset).
   */
  public onSessionChange(listener: SessionChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const snapshot = this.getActiveSession();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (err) {
        console.error('[SessionManager] Listener error:', err);
      }
    }
  }
}

/**
 * Singleton shared session manager.
 */
export const sessionManager = new SessionManager();
