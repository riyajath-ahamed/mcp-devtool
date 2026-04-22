/**
 * @configkits/mcp-devtools
 * types.ts — shared type definitions across the interceptor, event bus, and UI bridge
 */

import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

// ─── Tool call lifecycle ────────────────────────────────────────────────────

export type ToolCallStatus = "pending" | "success" | "error" | "timeout";

/**
 * A single recorded tool call with full timing and payload information.
 * This is the core unit of data that flows through the event bus and gets
 * stored in the session, displayed in the stream panel, and exported.
 */
export interface ToolCallRecord {
  /** Unique ID for this specific tool call invocation */
  id: string;
  /** JSON-RPC request ID, used to correlate request with response */
  requestId: string | number;
  /** Name of the MCP tool being called (e.g. "read_file", "github_search") */
  toolName: string;
  /** Raw arguments passed to the tool */
  args: Record<string, unknown>;
  /** Wall-clock timestamp when the call was dispatched */
  startedAt: number;
  /** Wall-clock timestamp when the response (or error) arrived */
  endedAt?: number;
  /** Derived latency in milliseconds (endedAt - startedAt) */
  latencyMs?: number;
  /** Final status of the call */
  status: ToolCallStatus;
  /** Raw response payload on success */
  result?: unknown;
  /** Error payload on failure */
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
  /** Which MCP server this call was routed to */
  serverId: string;
  /** Session this call belongs to */
  sessionId: string;
}

// ─── Session ────────────────────────────────────────────────────────────────

/**
 * An agent session — a logical grouping of all tool calls that occur
 * within a single MCP client lifecycle (connect → close).
 */
export interface Session {
  id: string;
  serverId: string;
  /** ISO timestamp of session start */
  startedAt: number;
  endedAt?: number;
  /** Ordered list of tool call IDs in this session */
  callIds: string[];
  /** Negotiated MCP protocol version */
  protocolVersion?: string;
  /** Capabilities reported by the server during initialize */
  serverCapabilities?: Record<string, unknown>;
}

// ─── Events ─────────────────────────────────────────────────────────────────

/**
 * All event types emitted by the interceptor and consumed by the WS bridge.
 * These are the messages broadcast to the browser UI panel.
 */
export type DevToolsEvent =
  | SessionStartEvent
  | SessionEndEvent
  | ToolCallStartEvent
  | ToolCallEndEvent
  | ToolCallErrorEvent
  | RawMessageEvent
  | ServerConnectedEvent
  | ServerDisconnectedEvent;

export interface SessionStartEvent {
  type: "session:start";
  session: Session;
}

export interface SessionEndEvent {
  type: "session:end";
  sessionId: string;
  endedAt: number;
  totalCalls: number;
}

export interface ToolCallStartEvent {
  type: "tool:start";
  call: ToolCallRecord;
}

export interface ToolCallEndEvent {
  type: "tool:end";
  call: ToolCallRecord;
}

export interface ToolCallErrorEvent {
  type: "tool:error";
  call: ToolCallRecord;
}

/** Emitted for every raw JSON-RPC frame (non-tool messages) */
export interface RawMessageEvent {
  type: "raw:message";
  sessionId: string;
  serverId: string;
  direction: "outbound" | "inbound";
  message: JSONRPCMessage;
  timestamp: number;
}

export interface ServerConnectedEvent {
  type: "server:connected";
  serverId: string;
  sessionId: string;
  timestamp: number;
}

export interface ServerDisconnectedEvent {
  type: "server:disconnected";
  serverId: string;
  sessionId: string;
  timestamp: number;
  reason?: string;
}

// ─── Interceptor config ─────────────────────────────────────────────────────

export interface InterceptorOptions {
  /**
   * Human-readable server identifier shown in the UI.
   * Defaults to "default" — override when connecting to multiple servers.
   */
  serverId?: string;

  /**
   * Emit raw JSON-RPC frames (not just tool calls) to the event bus.
   * Useful for debugging initialization handshakes. Default: false.
   */
  emitRawMessages?: boolean;

  /**
   * Tool call timeout in milliseconds. Calls that exceed this duration
   * are marked as "timeout" in the UI. Default: 30_000.
   */
  callTimeoutMs?: number;

  /**
   * Hook called before each tool call is dispatched.
   * Return false to cancel the call (useful for mocking in tests).
   */
  onBeforeCall?: (call: Omit<ToolCallRecord, "status" | "endedAt" | "latencyMs">) => boolean | Promise<boolean>;

  /**
   * Hook called after each tool call completes (success or error).
   */
  onAfterCall?: (call: ToolCallRecord) => void | Promise<void>;

  /**
   * Custom event emitter — inject your own to fan-out events to multiple
   * consumers (e.g. WS bridge + file logger). Defaults to internal emitter.
   */
  eventEmitter?: DevToolsEventEmitter;
}

// ─── Event emitter contract ──────────────────────────────────────────────────

export interface DevToolsEventEmitter {
  emit(event: DevToolsEvent): void;
  on(listener: (event: DevToolsEvent) => void): () => void;
}
