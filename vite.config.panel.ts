/**
 * Vite config for building the panel UI into static assets.
 *
 * Output goes to dist/panel/ and is served by the standalone server.
 * Run: vite build --config vite.config.panel.ts
 */

import { defineConfig } from "vite";

export default defineConfig({
  root: "src/panel",
  build: {
    outDir: "../../dist/panel",
    emptyOutDir: true,
  },
});
