/**
 * Custom Chakra UI v3 system — applies the project's visual theme
 * (soft light background, Inter font, rounded corners, slate palette).
 */

import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

const customConfig = defineConfig({
  globalCss: {
    body: {
      bg: "#f8fafc",
      color: "#1a202c",
    },
  },
  theme: {
    tokens: {
      colors: {
        brand: {
          50: { value: "#f5f7fa" },
          100: { value: "#e4e7eb" },
          200: { value: "#cbd2d9" },
          300: { value: "#9aa5b1" },
          400: { value: "#7b8794" },
          500: { value: "#616e7c" },
          600: { value: "#52606d" },
          700: { value: "#3e4c59" },
          800: { value: "#323f4b" },
          900: { value: "#1f2933" },
        },
      },
      fonts: {
        heading: { value: "Inter, sans-serif" },
        body: { value: "Inter, sans-serif" },
      },
      radii: {
        md: { value: "8px" },
        lg: { value: "12px" },
      },
    },
  },
});

export const system = createSystem(defaultConfig, customConfig);
