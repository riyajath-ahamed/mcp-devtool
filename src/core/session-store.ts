/**
 * @configkits/mcp-devtools
 * session-store.ts — in-memory store for sessions and tool call records
 *
 * Designed to be injected into the interceptor so tests can inspect
 * state without going through the WebSocket bridge.
 */

import type { Session, ToolCallRecord } from "./types.js";

export class SessionStore {
  private sessions = new Map<string, Session>();
  private calls = new Map<string, ToolCallRecord>();

  // ── Sessions ────────────────────────────────────────────────────────────

  createSession(partial: Omit<Session, "callIds">): Session {
    const session: Session = { ...partial, callIds: [] };
    this.sessions.set(session.id, session);
    return session;
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  endSession(id: string, endedAt: number): Session | undefined {
    const session = this.sessions.get(id);
    if (session) {
      session.endedAt = endedAt;
    }
    return session;
  }

  updateSessionMeta(
    id: string,
    meta: Partial<Pick<Session, "protocolVersion" | "serverCapabilities">>,
  ): void {
    const session = this.sessions.get(id);
    if (session) {
      Object.assign(session, meta);
    }
  }

  allSessions(): Session[] {
    return [...this.sessions.values()];
  }

  // ── Tool calls ───────────────────────────────────────────────────────────

  saveCall(call: ToolCallRecord): void {
    this.calls.set(call.id, call);

    const session = this.sessions.get(call.sessionId);
    if (session && !session.callIds.includes(call.id)) {
      session.callIds.push(call.id);
    }
  }

  getCall(id: string): ToolCallRecord | undefined {
    return this.calls.get(id);
  }

  /** Find a pending call by its JSON-RPC request ID */
  getPendingCall(
    requestId: string | number,
    sessionId: string,
  ): ToolCallRecord | undefined {
    for (const call of this.calls.values()) {
      if (
        call.requestId === requestId &&
        call.sessionId === sessionId &&
        call.status === "pending"
      ) {
        return call;
      }
    }
    return undefined;
  }

  callsForSession(sessionId: string): ToolCallRecord[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return session.callIds
      .map((id) => this.calls.get(id))
      .filter(Boolean) as ToolCallRecord[];
  }

  allCalls(): ToolCallRecord[] {
    return [...this.calls.values()];
  }

  // ── Export ───────────────────────────────────────────────────────────────

  exportSession(sessionId: string): {
    session: Session;
    calls: ToolCallRecord[];
  } | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return { session, calls: this.callsForSession(sessionId) };
  }

  exportAll(): { sessions: Session[]; calls: ToolCallRecord[] } {
    return {
      sessions: this.allSessions(),
      calls: this.allCalls(),
    };
  }

  // ── Maintenance ──────────────────────────────────────────────────────────

  /**
   * Prune sessions older than maxAgeMs.
   * Safe to call periodically in long-running devserver processes.
   */
  prune(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    let pruned = 0;

    for (const [id, session] of this.sessions) {
      const age = session.endedAt ?? session.startedAt;
      if (age < cutoff) {
        // Remove calls belonging to this session
        for (const callId of session.callIds) {
          this.calls.delete(callId);
        }
        this.sessions.delete(id);
        pruned++;
      }
    }

    return pruned;
  }

  clear(): void {
    this.sessions.clear();
    this.calls.clear();
  }
}
