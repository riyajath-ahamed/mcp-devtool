import { WebSocketServer, WebSocket } from "ws";
import type { DevToolsEvent, DevToolsEventEmitter } from "@configkits/mcp-devtools-core";
import type { SessionStore } from "@configkits/mcp-devtools-core";

export interface WsBridgeOptions {
  port?: number;
  host?: string;
}

export class WsBridge {
  private wss: WebSocketServer;
  private unsubscribe?: () => void;

  constructor(
    private readonly emitter: DevToolsEventEmitter,
    private readonly store: SessionStore,
    options: WsBridgeOptions = {},
  ) {
    const port = options.port ?? 6899;
    const host = options.host ?? "127.0.0.1";

    this.wss = new WebSocketServer({ port, host });

    this.wss.on("connection", (ws) => {
      this.onClientConnected(ws);
    });

    this.unsubscribe = this.emitter.on((event) => {
      this.broadcast(event);
    });

    console.log(`[mcp-devtools] WS bridge listening on ws://${host}:${port}`);
  }

  private onClientConnected(ws: WebSocket): void {
    const snapshot = this.store.exportAll();
    ws.send(
      JSON.stringify({ type: "snapshot", data: snapshot }),
    );

    ws.on("error", (err) => {
      console.error("[mcp-devtools] ws client error:", err.message);
    });
  }

  private broadcast(event: DevToolsEvent): void {
    const payload = JSON.stringify(event);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  async close(): Promise<void> {
    this.unsubscribe?.();
    return new Promise((resolve, reject) => {
      this.wss.close((err) => (err ? reject(err) : resolve()));
    });
  }
}
