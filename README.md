# @configkits/mcp-devtools

Browser DevTools-style inspector for MCP (Model Context Protocol) tool calls and agent sessions.

Intercept, record, and visualize every tool call your AI agent makes — with latency tracking, session grouping, and a real-time browser UI.

## Architecture

```
┌─────────────────┐   send()    ┌──────────────────────┐   send()   ┌────────────┐
│   MCP Client    │ ──────────▶ │ TransportInterceptor │ ─────────▶ │ MCP Server │
│  (your agent)   │ ◀────────── │                      │ ◀───────── │            │
└─────────────────┘  onmessage  └──────────────────────┘  onmessage └────────────┘
                                         │
                                         │ emit(DevToolsEvent)
                                         ▼
                                ┌──────────────────┐
                                │ InternalEventEmitter │
                                └────────┬─────────┘
                                         │
                                         ▼
                                ┌──────────────────┐     WebSocket      ┌──────────────────┐
                                │    WS Bridge     │ ──────────────────▶ │   Browser Panel  │
                                │  (port 6899)     │                    │   (React + D3)   │
                                └──────────────────┘                    └──────────────────┘
```

The system has three layers: **Core** (interception + event bus), **Server** (HTTP + WebSocket delivery), and **Panel** (browser UI).

### Core Layer (`src/core/`)

| Module | Purpose |
|---|---|
| `interceptor.ts` | `TransportInterceptor` — drop-in wrapper around any MCP `Transport` (stdio, HTTP, SSE). Intercepts all JSON-RPC frames bidirectionally without altering protocol behavior. Tracks `tools/call` request/response pairs, computes latency, and handles timeouts. |
| `event-emitter.ts` | `InternalEventEmitter` — lightweight typed pub/sub bus. All events flow through this. Listeners are crash-isolated so a failing subscriber never breaks the intercept path. |
| `session-store.ts` | `SessionStore` — in-memory store for `Session` and `ToolCallRecord` objects. Supports export, pruning, and pending-call lookup by JSON-RPC request ID. |
| `ws-bridge.ts` | `WsBridge` — WebSocket server that broadcasts `DevToolsEvent` frames to all connected browser panels. On connection, replays the full session store snapshot so late-opening panels get complete state. |
| `vite-plugin.ts` | `mcpDevtools()` — Vite plugin that injects the panel client script into every HTML page during development. Automatically starts the WS bridge and handles reconnection. No-op in production builds. |
| `types.ts` | All shared TypeScript types: `ToolCallRecord`, `Session`, `DevToolsEvent` union (8 event types), `InterceptorOptions`, `DevToolsEventEmitter` interface. |

### Event Types

```
session:start  →  A new MCP client session began
session:end    →  Session closed (with total call count)
tool:start     →  Outbound tools/call request dispatched
tool:end       →  Successful tool call response received
tool:error     →  Tool call returned an error or timed out
raw:message    →  Raw JSON-RPC frame (opt-in, both directions)
server:connected    →  Transport started
server:disconnected →  Transport closed
```

### Server Layer

**Vite Plugin** (`src/core/vite-plugin.ts`)

For Vite-based projects. Injects a client-side script that opens a WebSocket connection to the bridge and mounts the panel UI as a floating overlay inside a Shadow DOM host (styles never leak into the app).

**Standalone Server** (`src/standalone/server.ts`)

For non-Vite setups. Starts two servers:

- **HTTP** (default `:6898`) — serves the pre-built panel UI and exposes `POST /events` for ingesting events from external sources and `GET /api/sessions` for exporting session data.
- **WebSocket** (default `:6899`) — the WS bridge that streams events to the panel in real time.

### Panel Layer (`src/panel/`)

A React application built with Chakra UI v3 and D3.js, compiled into a standalone bundle via Vite.

| Module | Purpose |
|---|---|
| `Panel.tsx` | Main orchestrator — tabbed interface, filtering (text/status/time range), URL hash deep-linking, session export, minimize/restore. |
| `TimelineView.tsx` | Chronological event timeline with session replay controls (play/pause/step/rewind). |
| `WaterfallChart.tsx` | D3.js-powered network waterfall chart showing tool call timing as horizontal bars. |
| `DiffViewer.tsx` | Side-by-side request/response diff viewer in the detail drawer. |
| `shared.tsx` | Reusable components: `StatusBadge`, `LatencyBar`, `JsonViewer`, `Logo`, `EmptyState`. |
| `theme.tsx` | Light/dark theme system with comprehensive token map. All colors across the UI derive from `ThemeTokens` — no hardcoded color literals. Persists preference to localStorage and respects `prefers-color-scheme`. |
| `system.ts` | Custom Chakra UI v3 system configuration (Inter font, slate palette, rounded corners). |
| `ws-client.ts` | WebSocket client for standalone mode — connects to the bridge and dispatches events as `CustomEvent` on `window`. |
| `main.tsx` | Panel entry point — mounts React into `#__mcp_devtools_panel__`. |

### Data Flow

1. Your MCP client sends a `tools/call` JSON-RPC request through the `TransportInterceptor`.
2. The interceptor records the call as `pending` in the `SessionStore` and emits a `tool:start` event.
3. The request passes through unmodified to the real MCP server.
4. When the server responds, the interceptor matches the response to the pending call, computes latency, updates the store, and emits `tool:end` or `tool:error`.
5. The `WsBridge` broadcasts each event as JSON to all connected WebSocket clients.
6. The browser panel receives events, updates its React state, and renders the stream/timeline/waterfall views.

If a tool call exceeds `callTimeoutMs` (default 30s) without a response, the interceptor marks it as `timeout` and emits `tool:error`.

## Usage

### With Vite

```ts
// vite.config.ts
import { mcpDevtools } from "@configkits/mcp-devtools/vite";

export default defineConfig({
  plugins: [mcpDevtools({ port: 6899 })],
});
```

### Intercepting MCP Transport

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { TransportInterceptor } from "@configkits/mcp-devtools";

const base = new StdioClientTransport({ command: "node", args: ["server.js"] });
const transport = new TransportInterceptor(base, { serverId: "my-server" });

const client = new Client({ name: "my-agent", version: "1.0.0" }, {});
await client.connect(transport); // drop-in replacement
```

### Standalone Server

```bash
npm run dev
# Panel UI:  http://127.0.0.1:6898
# WS bridge: ws://127.0.0.1:6899
# POST events to http://127.0.0.1:6898/events
```

## Scripts

| Script | Description |
|---|---|
| `npm run build` | Build panel UI + compile TypeScript |
| `npm run build:panel` | Build only the panel UI bundle |
| `npm run dev` | Start the standalone devtools server |
| `npm run demo` | Start the interactive demo (simulated MCP calls) |
| `npm test` | Run interceptor unit tests |
| `npm run typecheck` | TypeScript type checking |

## Demo

The `demo/` directory contains an interactive demo that simulates MCP tool calls without a real MCP server. It sends mock events to the standalone server's HTTP endpoint and connects to the WS bridge to display the panel.

```bash
# Terminal 1: start the standalone server
npm run dev

# Terminal 2: start the demo
npm run demo
```

## Dependencies

- **Runtime**: `ws` (WebSocket server), `@chakra-ui/react` + `@emotion/react` (UI), `d3` (waterfall chart)
- **Peer**: `@modelcontextprotocol/sdk`, `react`, `react-dom`, `vite` (optional)

## License

MIT
