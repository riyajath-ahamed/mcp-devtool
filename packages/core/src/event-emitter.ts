/**
 * @configkits/mcp-devtools
 * event-emitter.ts — lightweight typed event bus
 *
 * A minimal pub/sub bus with no external deps. The WS bridge,
 * file logger, and test harness all subscribe to this.
 */

import type { DevToolsEvent, DevToolsEventEmitter } from "./types.js";

export class InternalEventEmitter implements DevToolsEventEmitter {
  private listeners = new Set<(event: DevToolsEvent) => void>();

  emit(event: DevToolsEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        // A crashing listener must never break the intercept path.
        // Swallow and continue so every other listener still fires.
        console.error("[mcp-devtools] listener threw:", err);
      }
    }
  }

  /**
   * Subscribe to all events.
   * @returns Unsubscribe function — call it to stop listening.
   */
  on(listener: (event: DevToolsEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}
