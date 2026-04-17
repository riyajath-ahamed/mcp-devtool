/**
 * @configkits/mcp-devtools
 * interceptor.ts — MCP Transport Interceptor
 *
 * Wraps any MCP Transport implementation (stdio, Streamable HTTP, SSE)
 * and intercepts all JSON-RPC frames in both directions without altering
 * the protocol behavior visible to the real client or server.
 *
 * Architecture:
 *
 *   ┌─────────────────┐   send()    ┌──────────────────────┐   send()   ┌────────────┐
 *   │   MCP Client    │ ──────────▶ │ TransportInterceptor │ ─────────▶ │ MCP Server │
 *   │  (your agent)   │ ◀────────── │   (this file)        │ ◀───────── │            │
 *   └─────────────────┘  onmessage  └──────────────────────┘  onmessage └────────────┘
 *                                            │
 *                                            │ emit()
 *                                            ▼
 *                                   DevToolsEventEmitter
 *                                   (WS bridge, logger, tests)
 *
 * Usage:
 *
 *   import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
 *   import { TransportInterceptor } from "@configkits/mcp-devtools";
 *
 *   const base = new StdioClientTransport({ command: "node", args: ["server.js"] });
 *   const transport = new TransportInterceptor(base, { serverId: "my-server" });
 *
 *   const client = new Client({ name: "my-agent", version: "1.0.0" }, {});
 *   await client.connect(transport);  // drop-in replacement — zero other changes
 */

import { randomUUID } from "node:crypto";
import type {
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { isJSONRPCRequest, isJSONRPCResponse, isJSONRPCErrorResponse } from "@modelcontextprotocol/sdk/types.js";

import { InternalEventEmitter } from "./event-emitter.js";
import { SessionStore } from "./session-store.js";
import type {
  DevToolsEventEmitter,
  InterceptorOptions,
  ToolCallRecord,
} from "./types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const TOOL_CALL_METHOD = "tools/call" as const;
const INITIALIZE_METHOD = "initialize" as const;
const DEFAULT_TIMEOUT_MS = 30_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isToolCallRequest(msg: JSONRPCMessage): msg is JSONRPCMessage & {
  id: string | number;
  method: "tools/call";
  params: { name: string; arguments?: Record<string, unknown> };
} {
  return (
    isJSONRPCRequest(msg) &&
    msg.method === TOOL_CALL_METHOD &&
    typeof (msg as { params?: { name?: unknown } }).params?.name === "string"
  );
}

function isInitializeRequest(msg: JSONRPCMessage): boolean {
  return isJSONRPCRequest(msg) && msg.method === INITIALIZE_METHOD;
}

function isInitializeResponse(
  msg: JSONRPCMessage,
  pendingInitId: string | number | null,
): boolean {
  return (
    pendingInitId !== null &&
    isJSONRPCResponse(msg) &&
    "id" in msg &&
    msg.id === pendingInitId
  );
}

// ─── TransportInterceptor ────────────────────────────────────────────────────

/**
 * Drop-in Transport wrapper that records all MCP traffic without modifying it.
 *
 * The interceptor creates one Session per transport lifecycle (start → close).
 * Within a session it tracks every tools/call pair, computing latency from the
 * request timestamp to the response timestamp.
 *
 * Timeout handling: A per-call timer fires after `callTimeoutMs`. If no
 * response has arrived by then the call is marked "timeout" and emitted so
 * the UI can surface it immediately rather than leaving a dangling entry.
 */
export class TransportInterceptor implements Transport {
  // ── Transport interface callbacks ─────────────────────────────────────────
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(
    message: T,
    extra?: { requestInfo?: unknown; authInfo?: unknown },
  ) => void;
  sessionId?: string;

  // ── Internal state ────────────────────────────────────────────────────────
  private readonly inner: Transport;
  private readonly options: {
    serverId: string;
    emitRawMessages: boolean;
    callTimeoutMs: number;
    onBeforeCall?: InterceptorOptions["onBeforeCall"];
    onAfterCall?: InterceptorOptions["onAfterCall"];
  };

  private readonly emitter: DevToolsEventEmitter;
  readonly store: SessionStore;

  private currentSessionId: string | null = null;
  private pendingInitRequestId: string | number | null = null;

  /**
   * Map of JSON-RPC request ID → timeout handle.
   * Each pending tool call has an entry. Cleared when the response arrives
   * or when the timeout fires.
   */
  private callTimeouts = new Map<string | number, ReturnType<typeof setTimeout>>();

  constructor(inner: Transport, options: InterceptorOptions = {}) {
    this.inner = inner;
    this.options = {
      serverId: options.serverId ?? "default",
      emitRawMessages: options.emitRawMessages ?? false,
      callTimeoutMs: options.callTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      onBeforeCall: options.onBeforeCall,
      onAfterCall: options.onAfterCall,
    };
    this.emitter = options.eventEmitter ?? new InternalEventEmitter();
    this.store = new SessionStore();

    // Forward the inner transport's session ID if it generates one
    if (inner.sessionId) {
      this.sessionId = inner.sessionId;
    }
  }

  // ── Transport interface ───────────────────────────────────────────────────

  async start(): Promise<void> {
    // Wire up callbacks on the inner transport BEFORE starting it so we
    // never miss a message that fires synchronously during start().
    this.inner.onmessage = (message, extra) => {
      this.handleInbound(message);
      // Forward to whoever called us (the MCP Client)
      this.onmessage?.(message, extra);
    };

    this.inner.onclose = () => {
      this.handleClose();
      this.onclose?.();
    };

    this.inner.onerror = (error) => {
      this.onerror?.(error);
    };

    await this.inner.start();

    // Sync session ID after start in case the transport sets it during start()
    if (this.inner.sessionId && !this.sessionId) {
      this.sessionId = this.inner.sessionId;
    }

    // Create the session record for this transport lifecycle
    const sessionId = randomUUID();
    this.currentSessionId = sessionId;

    const session = this.store.createSession({
      id: sessionId,
      serverId: this.options.serverId,
      startedAt: Date.now(),
    });

    this.emitter.emit({ type: "server:connected", serverId: this.options.serverId, sessionId, timestamp: Date.now() });
    this.emitter.emit({ type: "session:start", session });
  }

  async send(
    message: JSONRPCMessage,
    options?: TransportSendOptions,
  ): Promise<void> {
    // Intercept outbound tool calls before forwarding
    if (isToolCallRequest(message)) {
      await this.handleOutboundToolCall(message);
    } else if (isInitializeRequest(message) && isJSONRPCRequest(message)) {
      // Track the initialize request ID so we can parse the response
      this.pendingInitRequestId = message.id;
    }

    if (this.options.emitRawMessages && this.currentSessionId) {
      this.emitter.emit({
        type: "raw:message",
        sessionId: this.currentSessionId,
        serverId: this.options.serverId,
        direction: "outbound",
        message,
        timestamp: Date.now(),
      });
    }

    // Always forward to the real transport — we never block the protocol
    await this.inner.send(message, options);
  }

  async close(): Promise<void> {
    await this.inner.close();
    // handleClose() will fire via inner.onclose → this.handleClose()
    // but call it directly in case the inner transport skips the callback
    this.handleClose();
  }

  setProtocolVersion(version: string): void {
    this.inner.setProtocolVersion?.(version);
  }

  // ── Event subscription ────────────────────────────────────────────────────

  /**
   * Subscribe to all DevTools events emitted by this interceptor.
   * Returns an unsubscribe function.
   *
   * @example
   * const unsub = transport.subscribe(event => {
   *   if (event.type === "tool:end") console.log(event.call.latencyMs);
   * });
   */
  subscribe(
    listener: Parameters<DevToolsEventEmitter["on"]>[0],
  ): () => void {
    return this.emitter.on(listener);
  }

  // ── Inbound handling (server → client) ───────────────────────────────────

  private handleInbound(message: JSONRPCMessage): void {
    const sessionId = this.currentSessionId;
    if (!sessionId) return;

    // Capture server capabilities from the initialize response
    if (isInitializeResponse(message, this.pendingInitRequestId)) {
      this.handleInitializeResponse(message as JSONRPCMessage & { result: unknown });
      this.pendingInitRequestId = null;
    }

    // Match tool call responses (success or error) back to their pending records
    if ((isJSONRPCResponse(message) || isJSONRPCErrorResponse(message)) && "id" in message && message.id !== undefined) {
      const pending = this.store.getPendingCall(message.id, sessionId);
      if (pending) {
        this.handleToolCallResponse(pending, message as JSONRPCMessage & {
          id: string | number;
          result?: unknown;
          error?: { code: number; message: string; data?: unknown };
        });
        return;
      }
    }

    // Emit raw frame if configured
    if (this.options.emitRawMessages) {
      this.emitter.emit({
        type: "raw:message",
        sessionId,
        serverId: this.options.serverId,
        direction: "inbound",
        message,
        timestamp: Date.now(),
      });
    }
  }

  // ── Outbound tool call handling ───────────────────────────────────────────

  private async handleOutboundToolCall(
    message: JSONRPCMessage & {
      id: string | number;
      params: { name: string; arguments?: Record<string, unknown> };
    },
  ): Promise<void> {
    const sessionId = this.currentSessionId;
    if (!sessionId) return;

    const callId = randomUUID();
    const now = Date.now();

    const call: ToolCallRecord = {
      id: callId,
      requestId: message.id,
      toolName: message.params.name,
      args: message.params.arguments ?? {},
      startedAt: now,
      status: "pending",
      serverId: this.options.serverId,
      sessionId,
    };

    // Allow the consumer to cancel the call (useful for test mocking)
    if (this.options.onBeforeCall) {
      const proceed = await this.options.onBeforeCall(call);
      if (!proceed) return;
    }

    this.store.saveCall(call);
    this.emitter.emit({ type: "tool:start", call: { ...call } });

    // Arm the timeout timer
    const timer = setTimeout(() => {
      this.handleToolCallTimeout(call);
    }, this.options.callTimeoutMs);

    this.callTimeouts.set(message.id, timer);
  }

  // ── Inbound tool call response ────────────────────────────────────────────

  private async handleToolCallResponse(
    pending: ToolCallRecord,
    message: JSONRPCMessage & {
      id: string | number;
      result?: unknown;
      error?: { code: number; message: string; data?: unknown };
    },
  ): Promise<void> {
    // Disarm timeout — we got a response in time
    const timer = this.callTimeouts.get(message.id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.callTimeouts.delete(message.id);
    }

    const now = Date.now();
    const isError = "error" in message && message.error !== undefined;

    const completed: ToolCallRecord = {
      ...pending,
      endedAt: now,
      latencyMs: now - pending.startedAt,
      status: isError ? "error" : "success",
      ...(isError
        ? {
            error: {
              code: (message.error as { code: number }).code,
              message: (message.error as { message: string }).message,
              data: (message.error as { data?: unknown }).data,
            },
          }
        : { result: message.result }),
    };

    this.store.saveCall(completed);

    const eventType = isError ? "tool:error" : "tool:end";
    this.emitter.emit({ type: eventType, call: completed });

    await this.options.onAfterCall?.(completed);
  }

  // ── Timeout handling ──────────────────────────────────────────────────────

  private handleToolCallTimeout(call: ToolCallRecord): void {
    // Check it hasn't already resolved between the timer firing and now
    const current = this.store.getCall(call.id);
    if (!current || current.status !== "pending") return;

    const now = Date.now();
    const timedOut: ToolCallRecord = {
      ...current,
      endedAt: now,
      latencyMs: now - current.startedAt,
      status: "timeout",
      error: {
        code: -32001,
        message: `Tool call "${current.toolName}" timed out after ${this.options.callTimeoutMs}ms`,
      },
    };

    this.store.saveCall(timedOut);
    this.callTimeouts.delete(call.requestId);

    this.emitter.emit({ type: "tool:error", call: timedOut });
  }

  // ── Initialize response parsing ───────────────────────────────────────────

  private handleInitializeResponse(
    message: JSONRPCMessage & { result: unknown },
  ): void {
    const sessionId = this.currentSessionId;
    if (!sessionId) return;

    const result = message.result as {
      protocolVersion?: string;
      capabilities?: Record<string, unknown>;
    } | null;

    if (!result) return;

    const meta: Partial<Pick<import("./types.js").Session, "protocolVersion" | "serverCapabilities">> = {};
    if (result.protocolVersion !== undefined) meta.protocolVersion = result.protocolVersion;
    if (result.capabilities !== undefined) meta.serverCapabilities = result.capabilities;
    this.store.updateSessionMeta(sessionId, meta);
  }

  // ── Close handling ────────────────────────────────────────────────────────

  private handleClose(): void {
    const sessionId = this.currentSessionId;
    if (!sessionId) return;

    // Clear all pending timers to avoid memory leaks
    for (const [, timer] of this.callTimeouts) {
      clearTimeout(timer);
    }
    this.callTimeouts.clear();

    const now = Date.now();
    const session = this.store.endSession(sessionId, now);

    this.emitter.emit({
      type: "session:end",
      sessionId,
      endedAt: now,
      totalCalls: session?.callIds.length ?? 0,
    });

    this.emitter.emit({
      type: "server:disconnected",
      serverId: this.options.serverId,
      sessionId,
      timestamp: now,
    });

    this.currentSessionId = null;
  }
}
