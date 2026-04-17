/**
 * Demo client — simulates MCP tool calls by sending events
 * to the standalone server's /events endpoint and also
 * connects to the WS bridge to display the panel.
 */

import { randomUUID } from "../utils.js";

const API_URL = "http://127.0.0.1:6898/events";
const WS_URL = "ws://127.0.0.1:6899";

let currentSessionId = randomUUID();
let currentServerId = "demo-server";
let callCount = 0;

// ── WebSocket connection to receive events for the panel ────────────────────

let ws: WebSocket | null = null;

function connectWs() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => log("Connected to WS bridge", "success");
  ws.onclose = () => {
    log("WS disconnected, reconnecting...", "error");
    setTimeout(connectWs, 2000);
  };
  ws.onerror = () => ws?.close();
  ws.onmessage = (ev) => {
    try {
      const event = JSON.parse(ev.data);
      window.dispatchEvent(new CustomEvent("mcp-devtools:event", { detail: event }));
    } catch {}
  };
}

connectWs();

// ── Emit a session start on load ────────────────────────────────────────────

sendEvent({
  type: "session:start",
  session: {
    id: currentSessionId,
    serverId: currentServerId,
    startedAt: Date.now(),
    callIds: [],
  },
});

sendEvent({
  type: "server:connected",
  serverId: currentServerId,
  sessionId: currentSessionId,
  timestamp: Date.now(),
});

// ── Public API used by the HTML buttons ─────────────────────────────────────

const MOCK_RESULTS: Record<string, unknown> = {
  read_file: { content: [{ type: "text", text: 'export const app = "hello world";' }] },
  write_file: { content: [{ type: "text", text: "File written successfully" }] },
  list_directory: { content: [{ type: "text", text: "index.ts\napp.ts\nutils.ts\npackage.json" }] },
  search_code: { content: [{ type: "text", text: "Found 3 matches:\n  src/app.ts:12 // TODO: refactor\n  src/utils.ts:5 // TODO: add types\n  src/index.ts:8 // TODO: optimize" }] },
  run_terminal: { content: [{ type: "text", text: "PASS  src/app.test.ts\n  ✓ should render (12ms)\n  ✓ should handle click (8ms)\n\nTest Suites: 1 passed\nTests: 2 passed" }] },
  github_search: { content: [{ type: "text", text: "Found 12 repositories matching 'mcp devtools'" }] },
};

(window as any).simulateCall = async function (toolName: string, args: Record<string, unknown>) {
  const callId = randomUUID();
  const requestId = ++callCount;
  const startedAt = Date.now();

  const call = {
    id: callId,
    requestId,
    toolName,
    args,
    startedAt,
    status: "pending" as const,
    serverId: currentServerId,
    sessionId: currentSessionId,
  };

  await sendEvent({ type: "tool:start", call });
  log(`→ ${toolName}(${JSON.stringify(args)})`, "info");

  // Simulate latency
  const latency = 50 + Math.random() * 400;
  setTimeout(async () => {
    const endedAt = Date.now();
    const completed = {
      ...call,
      endedAt,
      latencyMs: endedAt - startedAt,
      status: "success" as const,
      result: MOCK_RESULTS[toolName] ?? { content: [{ type: "text", text: "OK" }] },
    };
    await sendEvent({ type: "tool:end", call: completed });
    log(`✓ ${toolName} (${completed.latencyMs}ms)`, "success");
  }, latency);
};

(window as any).simulateError = async function () {
  const callId = randomUUID();
  const requestId = ++callCount;
  const startedAt = Date.now();

  const call = {
    id: callId,
    requestId,
    toolName: "delete_file",
    args: { path: "/etc/passwd" },
    startedAt,
    status: "pending" as const,
    serverId: currentServerId,
    sessionId: currentSessionId,
  };

  await sendEvent({ type: "tool:start", call });
  log("→ delete_file(/etc/passwd)", "info");

  setTimeout(async () => {
    const endedAt = Date.now();
    const errored = {
      ...call,
      endedAt,
      latencyMs: endedAt - startedAt,
      status: "error" as const,
      error: { code: -32603, message: "Permission denied: cannot delete system files" },
    };
    await sendEvent({ type: "tool:error", call: errored });
    log("✗ delete_file — Permission denied", "error");
  }, 150);
};

(window as any).simulateSlow = async function () {
  const callId = randomUUID();
  const requestId = ++callCount;
  const startedAt = Date.now();

  const call = {
    id: callId,
    requestId,
    toolName: "analyze_codebase",
    args: { depth: "full", include: "**/*.ts" },
    startedAt,
    status: "pending" as const,
    serverId: currentServerId,
    sessionId: currentSessionId,
  };

  await sendEvent({ type: "tool:start", call });
  log("→ analyze_codebase (slow...)", "info");

  setTimeout(async () => {
    const endedAt = Date.now();
    const completed = {
      ...call,
      endedAt,
      latencyMs: endedAt - startedAt,
      status: "success" as const,
      result: { content: [{ type: "text", text: "Analysis complete: 142 files, 8,412 LOC, 3 potential issues" }] },
    };
    await sendEvent({ type: "tool:end", call: completed });
    log(`✓ analyze_codebase (${completed.latencyMs}ms)`, "success");
  }, 3000);
};

(window as any).simulateBurst = async function () {
  const tools = ["read_file", "list_directory", "search_code", "write_file", "run_terminal"];
  for (let i = 0; i < 5; i++) {
    const tool = tools[i]!;
    setTimeout(() => {
      (window as any).simulateCall(tool, { index: i, burst: true });
    }, i * 100);
  }
};

(window as any).simulateSession = async function () {
  // End current session
  await sendEvent({
    type: "session:end",
    sessionId: currentSessionId,
    endedAt: Date.now(),
    totalCalls: callCount,
  });

  await sendEvent({
    type: "server:disconnected",
    serverId: currentServerId,
    sessionId: currentSessionId,
    timestamp: Date.now(),
  });

  // Start new session
  currentSessionId = randomUUID();
  callCount = 0;

  await sendEvent({
    type: "server:connected",
    serverId: currentServerId,
    sessionId: currentSessionId,
    timestamp: Date.now(),
  });

  await sendEvent({
    type: "session:start",
    session: {
      id: currentSessionId,
      serverId: currentServerId,
      startedAt: Date.now(),
      callIds: [],
    },
  });

  log("New session started: " + currentSessionId.slice(0, 8), "info");
};

// ── Helpers ─────────────────────────────────────────────────────────────────

async function sendEvent(event: any) {
  try {
    await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
  } catch {
    // Server might not be running yet
  }
}

function log(message: string, type: string = "") {
  const logEl = document.getElementById("log");
  if (!logEl) return;
  const entry = document.createElement("div");
  entry.className = "entry " + type;
  const time = new Date().toLocaleTimeString("en-US", { hour12: false });
  entry.textContent = `[${time}] ${message}`;
  logEl.prepend(entry);
}
