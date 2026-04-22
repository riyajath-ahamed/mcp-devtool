const API_URL = "http://127.0.0.1:6900/events";
const WS_URL = "ws://127.0.0.1:6899";

function randomUUID(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

let currentSessionId = randomUUID();
let currentServerId = "demo-server";
let callCount = 0;

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

const MOCK_RESULTS: Record<string, unknown> = {
  read_file: { content: [{ type: "text", text: 'export const app = "hello world";' }] },
  write_file: { content: [{ type: "text", text: "File written successfully" }] },
  list_dir: { content: [{ type: "text", text: "index.ts\napp.ts\nutils.ts\npackage.json" }] },
  search_web: { content: [{ type: "text", text: "Found 12 results for 'MCP protocol'" }] },
  run_command: { content: [{ type: "text", text: "PASS  src/app.test.ts\n  Tests: 2 passed" }] },
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
      result: { content: [{ type: "text", text: "Analysis complete: 142 files, 8,412 LOC" }] },
    };
    await sendEvent({ type: "tool:end", call: completed });
    log(`✓ analyze_codebase (${completed.latencyMs}ms)`, "success");
  }, 3000);
};

(window as any).simulateBurst = async function () {
  const tools = ["read_file", "list_dir", "search_web", "write_file", "run_command"];
  for (let i = 0; i < 5; i++) {
    const tool = tools[i]!;
    setTimeout(() => {
      (window as any).simulateCall(tool, { index: i, burst: true });
    }, i * 100);
  }
};

(window as any).simulateSession = async function () {
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

async function sendEvent(event: any) {
  try {
    await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
  } catch {}
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
