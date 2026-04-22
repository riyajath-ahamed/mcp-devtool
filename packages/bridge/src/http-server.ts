import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { DevToolsEvent, DevToolsEventEmitter } from "@configkits/mcp-devtools-core";
import type { SessionStore } from "@configkits/mcp-devtools-core";

export interface HttpServerOptions {
  port?: number;
  host?: string;
}

export function createHttpServer(
  emitter: DevToolsEventEmitter,
  store: SessionStore,
  options: HttpServerOptions = {},
) {
  const port = options.port ?? 6900;
  const host = options.host ?? "127.0.0.1";

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

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  httpServer.listen(port, host, () => {
    console.log(`[mcp-devtools] HTTP server listening on http://${host}:${port}`);
  });

  return httpServer;
}
