import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { InternalEventEmitter, SessionStore } from "@configkits/mcp-devtools-core";
import { WsBridge } from "@configkits/mcp-devtools-bridge";
import type { DevToolsEvent } from "@configkits/mcp-devtools-core";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

function findPanelDir(): string {
  const candidates = [
    resolve(__dirname, "..", "..", "..", "packages", "panel", "dist"),
    resolve(process.cwd(), "packages", "panel", "dist"),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, "index.html"))) return dir;
  }
  return candidates[0]!;
}

const PANEL_DIR = findPanelDir();

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

function loadPanelHtml(wsPort: number, host: string): string {
  const indexPath = join(PANEL_DIR, "index.html");
  if (!existsSync(indexPath)) {
    return `<!DOCTYPE html><html><body><pre>Panel not built.\nRun: pnpm --filter @configkits/mcp-devtools-panel build</pre></body></html>`;
  }
  const html = readFileSync(indexPath, "utf-8");
  const configScript = `<script>window.__MCP_DEVTOOLS_CONFIG__={wsUrl:"ws://${host}:${wsPort}"};</script>`;
  return html.replace("</head>", `${configScript}\n</head>`);
}

function serveStaticFile(req: IncomingMessage, res: ServerResponse): boolean {
  const url = req.url ?? "/";
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

export interface StandaloneServerOptions {
  uiPort?: number;
  wsPort?: number;
  host?: string;
}

export function createStandaloneServer(options: StandaloneServerOptions = {}) {
  const uiPort = options.uiPort ?? 6900;
  const wsPort = options.wsPort ?? 6899;
  const host = options.host ?? "127.0.0.1";

  const emitter = new InternalEventEmitter();
  const store = new SessionStore();
  const bridge = new WsBridge(emitter, store, { port: wsPort, host });

  const panelHtml = loadPanelHtml(wsPort, host);

  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

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

    if (req.url === "/api/sessions" || req.url === "/api/snapshot") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(store.exportAll(), null, 2));
      return;
    }

    if (serveStaticFile(req, res)) return;

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(panelHtml);
  });

  httpServer.listen(uiPort, host, () => {
    console.log(`[mcp-devtools] Panel UI:  http://${host}:${uiPort}`);
    console.log(`[mcp-devtools] WS bridge: ws://${host}:${wsPort}`);
    console.log(`[mcp-devtools] POST events to http://${host}:${uiPort}/events`);
    console.log(`[mcp-devtools] Health check: http://${host}:${uiPort}/health`);
  });

  return { httpServer, bridge, emitter, store };
}

const port = parseInt(process.env["MCP_DEVTOOLS_UI_PORT"] ?? "6900", 10);
const wsPort = parseInt(process.env["MCP_DEVTOOLS_WS_PORT"] ?? "6899", 10);

createStandaloneServer({ uiPort: port, wsPort });
