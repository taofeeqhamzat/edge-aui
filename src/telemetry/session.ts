/**
 * Anonymous Session Lifecycle Manager
 * Implements Stage 4.3 specifications from clipboard.9.md Section 32 & docs/plan/tasks/4.3.md.
 * Manages privacy-preserving session IDs without collecting PII.
 */

import { getMonotonicTimestamp } from './normalizer';

export interface SessionContext {
  sessionId: string;
  startedAt: number;
  taskId?: string;
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
   */
  public startSession(taskId?: string): SessionContext {
    this.currentSession = {
      sessionId: generateAnonymousSessionId(),
      startedAt: getMonotonicTimestamp(),
      taskId
    };
    this.notify();
    return { ...this.currentSession };
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
