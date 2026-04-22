import { randomUUID } from "node:crypto";
import type { ToolCallRecord, DevToolsEvent } from "@configkits/mcp-devtools-core";

const API_URL = "http://127.0.0.1:6900/events";

interface MockTool {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  minLatencyMs: number;
  maxLatencyMs: number;
  errorRate: number;
}

const TOOLS: MockTool[] = [
  {
    name: "read_file",
    args: { path: "/src/index.ts" },
    result: { content: [{ type: "text", text: 'export const app = "hello world";' }] },
    minLatencyMs: 50,
    maxLatencyMs: 200,
    errorRate: 0.05,
  },
  {
    name: "write_file",
    args: { path: "/src/app.ts", content: "export default {}" },
    result: { content: [{ type: "text", text: "File written successfully" }] },
    minLatencyMs: 100,
    maxLatencyMs: 400,
    errorRate: 0.1,
  },
  {
    name: "search_web",
    args: { query: "MCP protocol specification" },
    result: { content: [{ type: "text", text: "Found 12 results for 'MCP protocol specification'" }] },
    minLatencyMs: 500,
    maxLatencyMs: 2000,
    errorRate: 0.15,
  },
  {
    name: "run_command",
    args: { command: "npm test" },
    result: { content: [{ type: "text", text: "PASS  src/app.test.ts\n  Tests: 2 passed" }] },
    minLatencyMs: 1000,
    maxLatencyMs: 4000,
    errorRate: 0.1,
  },
  {
    name: "list_dir",
    args: { path: "/src" },
    result: { content: [{ type: "text", text: "index.ts\napp.ts\nutils.ts\npackage.json" }] },
    minLatencyMs: 30,
    maxLatencyMs: 150,
    errorRate: 0.02,
  },
];

async function sendEvent(event: DevToolsEvent) {
  try {
    await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
  } catch {}
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

async function simulateToolCall(tool: MockTool, sessionId: string, serverId: string) {
  const callId = randomUUID();
  const requestId = Math.floor(Math.random() * 100000);
  const startedAt = Date.now();

  const call: ToolCallRecord = {
    id: callId,
    requestId,
    toolName: tool.name,
    args: tool.args,
    startedAt,
    status: "pending",
    serverId,
    sessionId,
  };

  await sendEvent({ type: "tool:start", call });

  const latency = randomBetween(tool.minLatencyMs, tool.maxLatencyMs);
  await new Promise((r) => setTimeout(r, latency));

  const endedAt = Date.now();
  const isError = Math.random() < tool.errorRate;

  if (isError) {
    const errored: ToolCallRecord = {
      ...call,
      endedAt,
      latencyMs: endedAt - startedAt,
      status: "error",
      error: { code: -32603, message: `${tool.name} failed: simulated error` },
    };
    await sendEvent({ type: "tool:error", call: errored });
    console.log(`  ERR  ${tool.name} (${errored.latencyMs}ms)`);
  } else {
    const completed: ToolCallRecord = {
      ...call,
      endedAt,
      latencyMs: endedAt - startedAt,
      status: "success",
      result: tool.result,
    };
    await sendEvent({ type: "tool:end", call: completed });
    console.log(`  OK   ${tool.name} (${completed.latencyMs}ms)`);
  }
}

async function main() {
  const sessionId = randomUUID();
  const serverId = "mock-server";

  await sendEvent({
    type: "server:connected",
    serverId,
    sessionId,
    timestamp: Date.now(),
  });

  await sendEvent({
    type: "session:start",
    session: {
      id: sessionId,
      serverId,
      startedAt: Date.now(),
      callIds: [],
    },
  });

  console.log("[mock-server] Session started, firing tool calls...\n");

  while (true) {
    const tool = TOOLS[Math.floor(Math.random() * TOOLS.length)]!;
    await simulateToolCall(tool, sessionId, serverId);
    const delay = randomBetween(1500, 4000);
    await new Promise((r) => setTimeout(r, delay));
  }
}

main().catch(console.error);
