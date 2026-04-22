# @configkits/mcp-devtools

Browser DevTools-style inspector for MCP (Model Context Protocol) tool calls and agent sessions.

Intercept, record, and visualize every tool call your AI agent makes — with latency tracking, session grouping, and a real-time browser UI.

## Packages

This is a pnpm monorepo with four published packages:

| Package | Description |
|---|---|
| [`@configkits/mcp-devtools-core`](packages/core/) | Types, interceptor, event emitter, session store — no framework deps, pure Node.js |
| [`@configkits/mcp-devtools-bridge`](packages/bridge/) | WebSocket server + HTTP server that stream events to the browser panel |
| [`@configkits/mcp-devtools-vite`](packages/vite-plugin/) | Vite plugin — auto-injects the panel into every page during dev |
| [`@configkits/mcp-devtools-panel`](packages/panel/) | React + D3.js browser UI — stream, timeline, waterfall, diff viewer |

Plus two internal apps:

| App | Description |
|---|---|
| [`playground`](apps/playground/) | Vite demo app with mock MCP server for testing |
| [`standalone`](apps/standalone/) | Express-style HTTP server serving the panel at `:6900` |

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

### Data Flow

1. Your MCP client sends a `tools/call` JSON-RPC request through the `TransportInterceptor`.
2. The interceptor records the call as `pending` in the `SessionStore` and emits a `tool:start` event.
3. The request passes through unmodified to the real MCP server.
4. When the server responds, the interceptor matches the response to the pending call, computes latency, updates the store, and emits `tool:end` or `tool:error`.
5. The `WsBridge` broadcasts each event as JSON to all connected WebSocket clients.
6. The browser panel receives events, updates its React state, and renders the stream/timeline/waterfall views.

## Quick Start

### With Vite

```bash
npm i @configkits/mcp-devtools-core @configkits/mcp-devtools-vite
```

```ts
// vite.config.ts
import { mcpDevtools } from "@configkits/mcp-devtools-vite";

export default defineConfig({
  plugins: [mcpDevtools({ port: 6899 })],
});
```

```ts
// src/agent.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { TransportInterceptor } from "@configkits/mcp-devtools-core";

const base = new StdioClientTransport({ command: "node", args: ["server.js"] });
const transport = new TransportInterceptor(base, { serverId: "my-server" });

const client = new Client({ name: "my-agent", version: "1.0.0" }, {});
await client.connect(transport);
```

### Standalone (any client)

```bash
npm i @configkits/mcp-devtools-core @configkits/mcp-devtools-bridge
```

```ts
import { InternalEventEmitter, SessionStore } from "@configkits/mcp-devtools-core";
import { WsBridge } from "@configkits/mcp-devtools-bridge";

const emitter = new InternalEventEmitter();
const store = new SessionStore();
new WsBridge(emitter, store, { port: 6899 });

// Then wrap your transport with TransportInterceptor({ eventEmitter: emitter })
```

### Default Ports

| Service | Default |
|---|---|
| WS bridge | `ws://127.0.0.1:6899` |
| Standalone panel UI | `http://localhost:6900` |
| Vite panel bundle | `/@mcp-devtools/panel.js` |

## Development

```bash
# Install dependencies
pnpm install

# Build all packages (respects dependency order via Turbo)
pnpm build

# Run tests
pnpm test

# Start the playground dev server
pnpm --filter playground dev

# Start the standalone server
pnpm --filter standalone dev
```

### Build Order

Turbo ensures packages build in dependency order:

```
core → bridge → vite-plugin → panel
                            → playground
                            → standalone
```

## Publishing

All four packages are version-linked via [Changesets](https://github.com/changesets/changesets):

```bash
pnpm changeset        # Create a changeset
pnpm changeset version # Bump versions
pnpm release          # Build + publish all
```

## License

MIT
