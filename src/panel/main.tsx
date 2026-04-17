/**
 * @configkits/mcp-devtools
 * panel/main.tsx — panel entry point
 */

import React from "react";
import { createRoot } from "react-dom/client";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "./system.js";
import { ThemeProvider } from "./theme.jsx";
import { Panel } from "./Panel.jsx";

let container = document.getElementById("__mcp_devtools_panel__");
if (!container) {
  container = document.createElement("div");
  container.id = "__mcp_devtools_panel__";
  (document.body ?? document.documentElement).appendChild(container);
}

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <ChakraProvider value={system}>
      <ThemeProvider>
        <Panel />
      </ThemeProvider>
    </ChakraProvider>
  </React.StrictMode>,
);
