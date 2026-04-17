/**
 * @configkits/mcp-devtools
 * ws-bridge.ts — WebSocket server that streams DevTools events to the browser UI
 *
 * Starts a local WebSocket server (default port 6899). The React panel
 * connects to this and receives a stream of DevToolsEvent frames as JSON.
 *
 * On connection, the bridge replays the full current session store so the
 * panel gets complete state even if the browser was opened after events fired.
 */

import { WebSocketServer, WebSocket } from "ws";
import type { DevToolsEvent, DevToolsEventEmitter } from "./types.js";
import type { SessionStore } from "./session-store.js";

export interface WsBridgeOptions {
  /** Port to listen on. Default: 6899 */
  port?: number;
  /** Host to bind to. Default: "127.0.0.1" (never expose to network) */
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

    // Subscribe to all future events and broadcast to all connected panels
    this.unsubscribe = this.emitter.on((event) => {
      this.broadcast(event);
    });

    console.log(`[mcp-devtools] WS bridge listening on ws://${host}:${port}`);
  }

  private onClientConnected(ws: WebSocket): void {
    // Replay historical state so late-opening panels get full picture
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
