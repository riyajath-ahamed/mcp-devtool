/**
 * @configkits/mcp-devtools
 * panel/ws-client.ts — WebSocket client for standalone mode
 *
 * Connects to the WS bridge and dispatches DevToolsEvents on `window`
 * as CustomEvents so the Panel's `useDevToolsEvents` hook picks them up.
 *
 * Configuration is read from `window.__MCP_DEVTOOLS_CONFIG__`, which the
 * standalone server injects into the HTML before serving.
 */

export {};

declare global {
  interface Window {
    __MCP_DEVTOOLS_CONFIG__?: { wsUrl: string };
  }
}

const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 10;

let ws: WebSocket | null = null;
let reconnectAttempts = 0;

function getWsUrl(): string {
  return window.__MCP_DEVTOOLS_CONFIG__?.wsUrl ?? "ws://127.0.0.1:6899";
}

function connect() {
  const url = getWsUrl();
  ws = new WebSocket(url);

  ws.addEventListener("open", () => {
    reconnectAttempts = 0;
    console.debug("[mcp-devtools] connected to bridge at", url);
  });

  ws.addEventListener("message", (ev) => {
    try {
      const event = JSON.parse(ev.data as string);
      window.dispatchEvent(
        new CustomEvent("mcp-devtools:event", { detail: event }),
      );
    } catch (err) {
      console.error("[mcp-devtools] failed to parse message:", err);
    }
  });

  ws.addEventListener("close", () => {
    console.debug("[mcp-devtools] bridge disconnected");
    scheduleReconnect();
  });

  ws.addEventListener("error", () => {
    ws?.close();
  });
}

function scheduleReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;
  reconnectAttempts++;
  setTimeout(connect, RECONNECT_DELAY_MS * Math.min(reconnectAttempts, 4));
}

connect();
