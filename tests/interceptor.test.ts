/**
 * @configkits/mcp-devtools
 * interceptor.test.ts — unit tests for TransportInterceptor
 *
 * Uses a MockTransport to simulate the MCP server side, so tests run
 * fully in-process with no network or subprocess dependencies.
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import type {
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

import { TransportInterceptor } from "../src/core/interceptor.js";
import { InternalEventEmitter } from "../src/core/event-emitter.js";
import type { DevToolsEvent, ToolCallRecord } from "../src/core/types.js";

// ─── Mock transport ───────────────────────────────────────────────────────────

/**
 * A fully controllable Transport stub.
 * Call `simulateInbound(msg)` to fire messages as if the server sent them.
 * Inspect `sent` to see what the client sent toward the server.
 */
class MockTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T) => void;
  sessionId = "mock-session";

  sent: JSONRPCMessage[] = [];
  started = false;
  closed = false;

  async start(): Promise<void> {
    this.started = true;
  }

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    this.sent.push(message);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.onclose?.();
  }

  /** Simulate a message arriving from the MCP server */
  simulateInbound(message: JSONRPCMessage): void {
    this.onmessage?.(message);
  }
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const makeToolCallRequest = (
  id: number | string = 1,
  name = "read_file",
  args: Record<string, unknown> = { path: "/etc/hosts" },
): JSONRPCMessage =>
  ({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args },
  }) as JSONRPCMessage;

const makeToolCallResponse = (
  id: number | string = 1,
  result: unknown = { content: [{ type: "text", text: "127.0.0.1 localhost" }] },
): JSONRPCMessage =>
  ({
    jsonrpc: "2.0",
    id,
    result,
  }) as JSONRPCMessage;

const makeToolCallError = (
  id: number | string = 1,
  code = -32603,
  message = "File not found",
): JSONRPCMessage =>
  ({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  }) as JSONRPCMessage;

const makeInitRequest = (id: number | string = 0): JSONRPCMessage =>
  ({
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      clientInfo: { name: "test-client", version: "1.0.0" },
    },
  }) as JSONRPCMessage;

const makeInitResponse = (
  id: number | string = 0,
): JSONRPCMessage =>
  ({
    jsonrpc: "2.0",
    id,
    result: {
      protocolVersion: "2025-11-25",
      capabilities: { tools: {} },
      serverInfo: { name: "test-server", version: "1.0.0" },
    },
  }) as JSONRPCMessage;

// ─── Test helpers ─────────────────────────────────────────────────────────────

function collectEvents(emitter: InternalEventEmitter): DevToolsEvent[] {
  const events: DevToolsEvent[] = [];
  emitter.on((e) => events.push(e));
  return events;
}

async function setupInterceptor(opts: {
  serverId?: string;
  callTimeoutMs?: number;
  emitRawMessages?: boolean;
}) {
  const inner = new MockTransport();
  const emitter = new InternalEventEmitter();
  const events = collectEvents(emitter);

  const interceptor = new TransportInterceptor(inner, {
    serverId: opts.serverId ?? "test-server",
    callTimeoutMs: opts.callTimeoutMs ?? 5000,
    emitRawMessages: opts.emitRawMessages ?? false,
    eventEmitter: emitter,
  });

  // Wire up client-side onmessage so inbound frames propagate correctly
  const inbound: JSONRPCMessage[] = [];
  interceptor.onmessage = (msg) => inbound.push(msg);

  await interceptor.start();

  return { inner, interceptor, emitter, events, inbound };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TransportInterceptor", () => {

  describe("lifecycle", () => {
    it("emits session:start and server:connected on start()", async () => {
      const { events } = await setupInterceptor({});

      const types = events.map((e) => e.type);
      assert.ok(types.includes("server:connected"), "server:connected missing");
      assert.ok(types.includes("session:start"), "session:start missing");
    });

    it("emits session:end and server:disconnected on close()", async () => {
      const { interceptor, events } = await setupInterceptor({});

      await interceptor.close();

      const types = events.map((e) => e.type);
      assert.ok(types.includes("session:end"), "session:end missing");
      assert.ok(types.includes("server:disconnected"), "server:disconnected missing");
    });

    it("passes start() through to inner transport", async () => {
      const { inner } = await setupInterceptor({});
      assert.equal(inner.started, true);
    });

    it("passes close() through to inner transport", async () => {
      const { interceptor, inner } = await setupInterceptor({});
      await interceptor.close();
      assert.equal(inner.closed, true);
    });
  });

  describe("send() passthrough", () => {
    it("forwards all messages to the inner transport unchanged", async () => {
      const { interceptor, inner } = await setupInterceptor({});
      const msg = makeToolCallRequest(42, "list_files", { dir: "/tmp" });

      await interceptor.send(msg);

      assert.equal(inner.sent.length, 1);
      assert.deepEqual(inner.sent[0], msg);
    });

    it("forwards non-tool messages without recording them as calls", async () => {
      const { interceptor, inner, interceptor: { store } } = await setupInterceptor({});
      const ping: JSONRPCMessage = { jsonrpc: "2.0", method: "ping" } as JSONRPCMessage;

      await interceptor.send(ping);

      assert.equal(inner.sent.length, 1);
      assert.equal(store.allCalls().length, 0);
    });
  });

  describe("tool call — happy path", () => {
    it("records tool:start when a tools/call request is sent", async () => {
      const { interceptor, events } = await setupInterceptor({});

      await interceptor.send(makeToolCallRequest(1, "read_file"));

      const start = events.find((e) => e.type === "tool:start");
      assert.ok(start, "tool:start event not emitted");
      assert.equal((start as { type: string; call: ToolCallRecord }).call.toolName, "read_file");
      assert.equal((start as { type: string; call: ToolCallRecord }).call.status, "pending");
    });

    it("records tool:end when a matching response arrives", async () => {
      const { interceptor, inner, events } = await setupInterceptor({});

      await interceptor.send(makeToolCallRequest(1, "read_file"));
      inner.simulateInbound(makeToolCallResponse(1));

      const end = events.find((e) => e.type === "tool:end");
      assert.ok(end, "tool:end event not emitted");

      const call = (end as { type: string; call: ToolCallRecord }).call;
      assert.equal(call.toolName, "read_file");
      assert.equal(call.status, "success");
      assert.ok(typeof call.latencyMs === "number", "latencyMs should be a number");
      assert.ok(call.latencyMs >= 0, "latencyMs should be non-negative");
      assert.ok(call.endedAt !== undefined, "endedAt should be set");
    });

    it("stores the correct result payload on success", async () => {
      const { interceptor, inner, interceptor: { store } } = await setupInterceptor({});
      const result = { content: [{ type: "text", text: "hello" }] };

      await interceptor.send(makeToolCallRequest(1));
      inner.simulateInbound(makeToolCallResponse(1, result));

      const calls = store.allCalls();
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0]!.result, result);
    });

    it("forwards inbound responses to the client onmessage", async () => {
      const { interceptor, inner, inbound } = await setupInterceptor({});
      const response = makeToolCallResponse(1);

      await interceptor.send(makeToolCallRequest(1));
      inner.simulateInbound(response);

      assert.equal(inbound.length, 1);
      assert.deepEqual(inbound[0], response);
    });
  });

  describe("tool call — error path", () => {
    it("records tool:error when an error response arrives", async () => {
      const { interceptor, inner, events } = await setupInterceptor({});

      await interceptor.send(makeToolCallRequest(2, "delete_file"));
      inner.simulateInbound(makeToolCallError(2, -32603, "Permission denied"));

      const errEvent = events.find((e) => e.type === "tool:error");
      assert.ok(errEvent, "tool:error event not emitted");

      const call = (errEvent as { type: string; call: ToolCallRecord }).call;
      assert.equal(call.status, "error");
      assert.equal(call.error?.code, -32603);
      assert.equal(call.error?.message, "Permission denied");
    });
  });

  describe("multiple concurrent calls", () => {
    it("correctly correlates two overlapping tool calls by request ID", async () => {
      const { interceptor, inner, events } = await setupInterceptor({});

      // Send two calls without waiting for responses
      await interceptor.send(makeToolCallRequest(10, "read_file"));
      await interceptor.send(makeToolCallRequest(11, "write_file"));

      // Respond to them in reverse order
      inner.simulateInbound(makeToolCallResponse(11));
      inner.simulateInbound(makeToolCallResponse(10));

      const ends = events.filter((e) => e.type === "tool:end") as Array<{
        type: string;
        call: ToolCallRecord;
      }>;

      assert.equal(ends.length, 2);

      const byRequestId = Object.fromEntries(
        ends.map((e) => [e.call.requestId, e.call] as [string | number, ToolCallRecord]),
      );

      assert.equal(byRequestId[10]!.toolName, "read_file");
      assert.equal(byRequestId[11]!.toolName, "write_file");
    });
  });

  describe("timeout", () => {
    it("emits tool:error with status=timeout if no response arrives in time", async () => {
      const { interceptor, events } = await setupInterceptor({ callTimeoutMs: 50 });

      await interceptor.send(makeToolCallRequest(99, "slow_tool"));

      // Wait for the timeout to fire
      await new Promise((resolve) => setTimeout(resolve, 120));

      const errEvent = events.find(
        (e) => e.type === "tool:error" &&
          (e as { type: string; call: ToolCallRecord }).call.status === "timeout",
      );
      assert.ok(errEvent, "timeout event not emitted");

      const call = (errEvent as { type: string; call: ToolCallRecord }).call;
      assert.equal(call.toolName, "slow_tool");
      assert.ok(call.error?.message.includes("timed out"));
    });

    it("does not emit timeout if response arrives before deadline", async () => {
      const { interceptor, inner, events } = await setupInterceptor({ callTimeoutMs: 200 });

      await interceptor.send(makeToolCallRequest(3));
      // Respond well within the timeout
      inner.simulateInbound(makeToolCallResponse(3));

      await new Promise((resolve) => setTimeout(resolve, 300));

      const timeouts = events.filter(
        (e) =>
          e.type === "tool:error" &&
          (e as { type: string; call: ToolCallRecord }).call.status === "timeout",
      );
      assert.equal(timeouts.length, 0, "unexpected timeout event fired");
    });
  });

  describe("initialize handshake", () => {
    it("captures protocol version from the initialize response", async () => {
      const { interceptor, inner } = await setupInterceptor({});

      await interceptor.send(makeInitRequest(0));
      inner.simulateInbound(makeInitResponse(0));

      // Give the store a tick to update
      await new Promise((r) => setTimeout(r, 0));

      const sessions = interceptor.store.allSessions();
      assert.equal(sessions.length, 1);
      assert.equal(sessions[0]!.protocolVersion, "2025-11-25");
    });

    it("captures server capabilities from the initialize response", async () => {
      const { interceptor, inner } = await setupInterceptor({});

      await interceptor.send(makeInitRequest(0));
      inner.simulateInbound(makeInitResponse(0));

      await new Promise((r) => setTimeout(r, 0));

      const sessions = interceptor.store.allSessions();
      assert.deepEqual(sessions[0]!.serverCapabilities, { tools: {} });
    });
  });

  describe("raw message emission", () => {
    it("does not emit raw:message by default", async () => {
      const { interceptor, inner, events } = await setupInterceptor({ emitRawMessages: false });

      await interceptor.send(makeToolCallRequest(1));
      inner.simulateInbound(makeToolCallResponse(1));

      const raw = events.filter((e) => e.type === "raw:message");
      assert.equal(raw.length, 0);
    });

    it("emits raw:message for outbound when emitRawMessages=true", async () => {
      const { interceptor, events } = await setupInterceptor({ emitRawMessages: true });

      await interceptor.send(makeToolCallRequest(1));

      const outbound = events.filter(
        (e) => e.type === "raw:message" && (e as { direction: string }).direction === "outbound",
      );
      assert.ok(outbound.length > 0, "no outbound raw:message emitted");
    });
  });

  describe("onBeforeCall hook", () => {
    it("still records the call when hook returns true", async () => {
      const inner = new MockTransport();
      const emitter = new InternalEventEmitter();
      const events = collectEvents(emitter);

      const interceptor = new TransportInterceptor(inner, {
        eventEmitter: emitter,
        onBeforeCall: async () => true,
      });
      await interceptor.start();

      await interceptor.send(makeToolCallRequest(1, "allowed_tool"));

      const start = events.find((e) => e.type === "tool:start");
      assert.ok(start);
    });

    it("skips recording when hook returns false", async () => {
      const inner = new MockTransport();
      const emitter = new InternalEventEmitter();
      const events = collectEvents(emitter);

      const interceptor = new TransportInterceptor(inner, {
        eventEmitter: emitter,
        onBeforeCall: async () => false,
      });
      await interceptor.start();

      await interceptor.send(makeToolCallRequest(1, "blocked_tool"));

      const start = events.find((e) => e.type === "tool:start");
      assert.equal(start, undefined, "tool:start should not be emitted when hook blocks");
    });
  });

  describe("SessionStore", () => {
    it("associates calls with the correct session", async () => {
      const { interceptor, inner } = await setupInterceptor({});

      await interceptor.send(makeToolCallRequest(1, "tool_a"));
      inner.simulateInbound(makeToolCallResponse(1));

      const sessions = interceptor.store.allSessions();
      assert.equal(sessions.length, 1);

      const calls = interceptor.store.callsForSession(sessions[0]!.id);
      assert.equal(calls.length, 1);
      assert.equal(calls[0]!.toolName, "tool_a");
    });

    it("exportSession returns session and its calls", async () => {
      const { interceptor, inner } = await setupInterceptor({});

      await interceptor.send(makeToolCallRequest(1));
      inner.simulateInbound(makeToolCallResponse(1));

      const sessionId = interceptor.store.allSessions()[0]!.id;
      const exported = interceptor.store.exportSession(sessionId);

      assert.ok(exported);
      assert.equal(exported.calls.length, 1);
    });
  });

  describe("serverId", () => {
    it("tags calls with the configured serverId", async () => {
      const { interceptor, inner } = await setupInterceptor({ serverId: "filesystem-server" });

      await interceptor.send(makeToolCallRequest(1));
      inner.simulateInbound(makeToolCallResponse(1));

      const calls = interceptor.store.allCalls();
      assert.equal(calls[0]!.serverId, "filesystem-server");
    });
  });
});
