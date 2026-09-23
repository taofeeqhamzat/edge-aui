/**
 * Anonymous Session Lifecycle Manager
 * Implements Stage 4.3 specifications from docs/testbed/prd.md Section 32 & docs/plan/tasks/4.3.md.
 * Manages privacy-preserving session IDs without collecting PII.
 */

import { getMonotonicTimestamp } from './normalizer';
import type { ExperimentalCondition } from './events';

export interface SessionContext {
  sessionId: string;
  /**
   * Monotonic start time (performance.now()). Retained for within-session deltas.
   */
  startedAt: number;
  /**
   * Epoch start time (Date.now()). Required because `startedAt` is monotonic and
   * cannot be subtracted from `Date.now()` — mixing the two clocks produced a
   * meaningless `metadata.durationMs` (assessment §16.4).
   */
  startedAtEpochMs?: number;
  experimentId?: string;
  conditionId?: ExperimentalCondition;
  taskId?: string;
}

export interface StartSessionOptions {
  taskId?: string;
  experimentId?: string;
  conditionId?: ExperimentalCondition;
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

    this.currentSession = {
      sessionId: generateAnonymousSessionId(),
      startedAt: getMonotonicTimestamp(),
      startedAtEpochMs: Date.now(),
      experimentId: options.experimentId,
      conditionId: options.conditionId,
      taskId: options.taskId
    };
    this.notify();
    return { ...this.currentSession };
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
    this.notify();
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
