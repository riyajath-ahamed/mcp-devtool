import type { Plugin, ViteDevServer } from "vite";
import { WsBridge } from "@configkits/mcp-devtools-bridge";
import { InternalEventEmitter, SessionStore } from "@configkits/mcp-devtools-core";
import type { DevToolsEventEmitter } from "@configkits/mcp-devtools-core";

export interface McpDevtoolsPluginOptions {
  port?: number;
  injectPanel?: boolean;
  eventEmitter?: DevToolsEventEmitter;
  sessionStore?: SessionStore;
}

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

    function mountPanel() {
      if (panelRoot) return;

      const host = document.createElement('div');
      host.id = '__mcp_devtools_host__';
      host.style.cssText = 'position:fixed;bottom:0;right:0;z-index:2147483647;pointer-events:none;';
      document.body.appendChild(host);

      const shadow = host.attachShadow({ mode: 'open' });
      panelRoot = shadow;

      const script = document.createElement('script');
      script.type = 'module';
      script.src = '/@mcp-devtools/panel.js';
      shadow.appendChild(script);
    }

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
          const host = document.getElementById('__mcp_devtools_host__');
          if (host) {
            host.dispatchEvent(new CustomEvent('mcp-devtools:event', {
              detail: event,
              bubbles: false,
            }));
          }
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
