/**
 * @configkits/mcp-devtools
 * standalone/server.ts — standalone devtools server for non-Vite setups
 *
 * Starts:
 *  1. A WebSocket bridge (default port 6899) that streams DevToolsEvents
 *  2. An HTTP server (default port 6898) that serves the panel UI
 *
 * The panel UI is built with Vite from src/panel/ into dist/panel/.
 * This server serves those static assets and injects the WS bridge URL.
 *
 * Any MCP client can pipe events into the bridge by constructing a
 * TransportInterceptor with a shared event emitter, or by POSTing
 * events to the HTTP endpoint.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { WsBridge } from "../core/ws-bridge.js";
import { InternalEventEmitter } from "../core/event-emitter.js";
import { SessionStore } from "../core/session-store.js";
import type { DevToolsEvent } from "../core/types.js";

// ── Panel asset serving ──────────────────────────────────────────────────────

const __dirname = fileURLToPath(new URL(".", import.meta.url));
// When compiled (dist/standalone/server.js), ../panel → dist/panel/ (has assets/) ✓
// When running from src/ in dev (tsx), ../panel → src/panel/ (no assets/) ✗
// Detect by checking for the built assets directory, fall back to dist/panel/.
const PANEL_DIR = existsSync(join(resolve(__dirname, "..", "panel"), "assets"))
  ? resolve(__dirname, "..", "panel")
  : resolve(process.cwd(), "dist", "panel");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".png":  "image/png",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/** Read the built index.html and inject the WS bridge URL as a config script. */
function loadPanelHtml(wsPort: number, host: string): string {
  const indexPath = join(PANEL_DIR, "index.html");
  if (!existsSync(indexPath)) {
    return `<!DOCTYPE html><html><body><pre>Panel not built.\nRun: npm run build:panel</pre></body></html>`;
  }
  const html = readFileSync(indexPath, "utf-8");
  const configScript = `<script>window.__MCP_DEVTOOLS_CONFIG__={wsUrl:"ws://${host}:${wsPort}"};</script>`;
  return html.replace("</head>", `${configScript}\n</head>`);
}

/** Try to serve a static file from the panel dist directory. Returns true if handled. */
function serveStaticFile(req: IncomingMessage, res: ServerResponse): boolean {
  const url = req.url ?? "/";
  // Only serve files under known asset paths
  if (!url.startsWith("/assets/") && url !== "/favicon.ico") return false;

  const filePath = join(PANEL_DIR, url);
  if (!existsSync(filePath)) return false;

  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
  const content = readFileSync(filePath);
  res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "public, max-age=31536000, immutable" });
  res.end(content);
  return true;
}

// ── Server ───────────────────────────────────────────────────────────────────

export interface StandaloneServerOptions {
  /** Port for the HTTP UI server. Default: 6898 */
  uiPort?: number;
  /** Port for the WebSocket bridge. Default: 6899 */
  wsPort?: number;
  /** Host to bind to. Default: "127.0.0.1" */
  host?: string;
}

export function createStandaloneServer(options: StandaloneServerOptions = {}) {
  const uiPort = options.uiPort ?? 6898;
  const wsPort = options.wsPort ?? 6899;
  const host = options.host ?? "127.0.0.1";

  const emitter = new InternalEventEmitter();
  const store = new SessionStore();
  const bridge = new WsBridge(emitter, store, { port: wsPort, host });

  const panelHtml = loadPanelHtml(wsPort, host);

  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    // CORS headers for local dev
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // POST /events — ingest DevToolsEvents from external sources
    if (req.method === "POST" && req.url === "/events") {
      let body = "";
      req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      req.on("end", () => {
        try {
          const event: DevToolsEvent = JSON.parse(body);
          emitter.emit(event);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON" }));
        }
      });
      return;
    }

    // GET /api/sessions — export all session data
    if (req.url === "/api/sessions") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(store.exportAll(), null, 2));
      return;
    }

    // Static assets (JS, CSS, etc.)
    if (serveStaticFile(req, res)) return;

    // GET / — serve the panel UI
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(panelHtml);
  });

  httpServer.listen(uiPort, host, () => {
    console.log(`[mcp-devtools] Panel UI: http://${host}:${uiPort}`);
    console.log(`[mcp-devtools] WS bridge: ws://${host}:${wsPort}`);
    console.log(`[mcp-devtools] POST events to http://${host}:${uiPort}/events`);
  });

  return { httpServer, bridge, emitter, store };
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  const port = parseInt(process.env.MCP_DEVTOOLS_UI_PORT ?? "6898", 10);
  const wsPort = parseInt(process.env.MCP_DEVTOOLS_WS_PORT ?? "6899", 10);

  createStandaloneServer({ uiPort: port, wsPort });
}
