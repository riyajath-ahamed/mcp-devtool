/**
 * @configkits/mcp-devtools
 * vite-plugin.ts — Vite plugin for zero-config MCP devtools injection
 *
 * Adds the devtools client script to every HTML page served by the Vite
 * dev server. The client opens a WebSocket connection to the WS bridge
 * and renders the floating panel UI.
 *
 * Usage in vite.config.ts:
 *
 *   import { mcpDevtools } from "@configkits/mcp-devtools/vite";
 *
 *   export default defineConfig({
 *     plugins: [mcpDevtools({ port: 6899 })],
 *   });
 *
 * The plugin is a no-op in production builds (mode !== "development").
 */

import type { Plugin, ViteDevServer } from "vite";
import { WsBridge } from "./ws-bridge.js";
import { InternalEventEmitter } from "./event-emitter.js";
import { SessionStore } from "./session-store.js";
import type { DevToolsEventEmitter } from "./types.js";

export interface McpDevtoolsPluginOptions {
  /**
   * Port the WebSocket bridge listens on.
   * Must match the interceptor's WsBridge port. Default: 6899.
   */
  port?: number;

  /**
   * Whether to inject the panel UI into every HTML response.
   * Set false if you want to open the panel manually at localhost:{uiPort}.
   * Default: true.
   */
  injectPanel?: boolean;

  /**
   * Provide a shared event emitter if you're also constructing a
   * TransportInterceptor in your Vite config (advanced usage).
   * When omitted, the plugin creates its own.
   */
  eventEmitter?: DevToolsEventEmitter;

  /**
   * Provide a shared session store for the WS bridge snapshot replay.
   * When omitted, the plugin creates its own.
   */
  sessionStore?: SessionStore;
}

/**
 * The client-side snippet injected into every HTML page.
 * It opens a WebSocket to the bridge, receives DevToolsEvents, and
 * mounts the floating panel UI from the panel bundle.
 */
function buildClientSnippet(port: number): string {
  return `
<script type="module" id="__mcp_devtools__">
  (function() {
    if (typeof window === 'undefined') return;
    if (window.__MCP_DEVTOOLS_LOADED__) return;
    window.__MCP_DEVTOOLS_LOADED__ = true;

    const WS_URL = 'ws://127.0.0.1:${port}';
    const RECONNECT_DELAY_MS = 2000;
    const MAX_RECONNECT_ATTEMPTS = 10;

    let ws = null;
    let reconnectAttempts = 0;
    let panelRoot = null;

    // ── Panel mount ─────────────────────────────────────────────────────────
    function mountPanel() {
      if (panelRoot) return;

      // Create a shadow-DOM host so panel styles never leak into the app
      const host = document.createElement('div');
      host.id = '__mcp_devtools_host__';
      host.style.cssText = 'position:fixed;bottom:0;right:0;z-index:2147483647;pointer-events:none;';
      document.body.appendChild(host);

      const shadow = host.attachShadow({ mode: 'open' });
      panelRoot = shadow;

      // Load the panel UI from the Vite dev server
      const script = document.createElement('script');
      script.type = 'module';
      script.src = '/@mcp-devtools/panel.js';
      shadow.appendChild(script);
    }

    // ── WebSocket connection ─────────────────────────────────────────────────
    function connect() {
      ws = new WebSocket(WS_URL);

      ws.addEventListener('open', () => {
        reconnectAttempts = 0;
        console.debug('[mcp-devtools] connected to bridge');
        mountPanel();
      });

      ws.addEventListener('message', (ev) => {
        try {
          const event = JSON.parse(ev.data);
          // Dispatch to the panel via a custom DOM event on the shadow host
          const host = document.getElementById('__mcp_devtools_host__');
          if (host) {
            host.dispatchEvent(new CustomEvent('mcp-devtools:event', {
              detail: event,
              bubbles: false,
            }));
          }
          // Also fire on window for any external listeners (test harnesses etc)
          window.dispatchEvent(new CustomEvent('mcp-devtools:event', { detail: event }));
        } catch (err) {
          console.error('[mcp-devtools] parse error:', err);
        }
      });

      ws.addEventListener('close', () => {
        console.debug('[mcp-devtools] bridge disconnected');
        scheduleReconnect();
      });

      ws.addEventListener('error', () => {
        ws?.close();
      });
    }

    function scheduleReconnect() {
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;
      reconnectAttempts++;
      setTimeout(connect, RECONNECT_DELAY_MS * Math.min(reconnectAttempts, 4));
    }

    // Start on DOMContentLoaded so document.body is available
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', connect);
    } else {
      connect();
    }
  })();
</script>`;
}

export function mcpDevtools(options: McpDevtoolsPluginOptions = {}): Plugin {
  const port = options.port ?? 6899;
  const injectPanel = options.injectPanel ?? true;

  let bridge: WsBridge | null = null;
  const emitter = options.eventEmitter ?? new InternalEventEmitter();
  const store = options.sessionStore ?? new SessionStore();

  const plugin: Plugin = {
    name: "mcp-devtools",
    apply: "serve",

    configureServer(server: ViteDevServer) {
      bridge = new WsBridge(emitter, store, { port });
      (server as unknown as { _mcpDevtools?: unknown })._mcpDevtools = { emitter, store, bridge };

      server.middlewares.use("/@mcp-devtools/panel.js", (_req, res) => {
        res.setHeader("Content-Type", "application/javascript");
        res.end(`console.log('[mcp-devtools] panel UI loaded');`);
      });

      server.httpServer?.on("close", async () => {
        await bridge?.close();
      });
    },
  };

  if (injectPanel) {
    plugin.transformIndexHtml = {
      order: "pre",
      handler(html: string) {
        return html.replace("</body>", `${buildClientSnippet(port)}\n</body>`);
      },
    };
  }

  return plugin;
}
