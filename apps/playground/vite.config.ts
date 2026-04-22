import { defineConfig } from "vite";
import { mcpDevtools } from "@configkits/mcp-devtools-vite";

export default defineConfig({
  plugins: [mcpDevtools({ port: 6899 })],
  server: {
    port: 5173,
    open: true,
  },
});
