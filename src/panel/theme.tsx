/**
 * Theme context — light/dark mode for all panel components.
 *
 * Uses React context + a comprehensive token map so every component
 * (including the D3 waterfall) reads consistent colors.
 *
 * ALL colors across the UI are derived from these tokens — no component
 * should contain hardcoded color literals.
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";

// ─── Token definitions ───────────────────────────────────────────────────────

export interface ThemeTokens {
  /** Current mode */
  mode: "light" | "dark";

  // ── Backgrounds ──────────────────────────────────────────────────────────
  bgPanel: string;
  bgToolbar: string;
  bgSurface: string;
  bgMuted: string;
  bgCode: string;
  bgHover: string;
  bgSelected: string;

  // ── Text ─────────────────────────────────────────────────────────────────
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textDim: string;

  // ── Borders ──────────────────────────────────────────────────────────────
  border: string;
  borderSubtle: string;

  // ── Accent ───────────────────────────────────────────────────────────────
  accent: string;
  accentMuted: string;
  accentText: string;
  /** Chakra colorPalette name for accent interactive elements */
  accentPalette: string;

  // ── Danger ───────────────────────────────────────────────────────────────
  /** Chakra colorPalette name for destructive/danger actions */
  dangerPalette: string;

  // ── Status (hex values for direct rendering) ─────────────────────────────
  statusPending: string;
  statusSuccess: string;
  statusError: string;
  statusTimeout: string;

  // ── Status palettes (for Chakra colorPalette prop) ───────────────────────
  statusPendingPalette: string;
  statusSuccessPalette: string;
  statusErrorPalette: string;
  statusTimeoutPalette: string;

  // ── Specific ─────────────────────────────────────────────────────────────
  connectedDot: string;
  disconnectedDot: string;
  errorText: string;

  // ── Latency bar ──────────────────────────────────────────────────────────
  latencyLow: string;
  latencyMed: string;
  latencyHigh: string;

  // ── Logo ─────────────────────────────────────────────────────────────────
  logoFill: string;
  logoFillMuted: string;

  // ── Empty state ──────────────────────────────────────────────────────────
  emptyIconPrimary: string;
  emptyIconSecondary: string;

  // ── Theme toggle ─────────────────────────────────────────────────────────
  themeToggleColor: string;
  themeToggleHover: string;

  // ── Event types (timeline) ───────────────────────────────────────────────
  eventSessionPalette: string;
  eventCallPalette: string;
  eventResponsePalette: string;
  eventErrorPalette: string;
  eventDefaultPalette: string;

  eventSessionBg: string;
  eventCallBg: string;
  eventResponseBg: string;
  eventErrorBg: string;
  eventDefaultBg: string;
  eventIconText: string;

  // ── Waterfall / D3 ──────────────────────────────────────────────────────
  waterfallBg: string;
  waterfallGrid: string;
  waterfallAxisText: string;
  waterfallLabel: string;
  waterfallLabelSelected: string;
  waterfallSelectedBg: string;
  waterfallHoverBg: string;
  waterfallBarFallback: string;

  // ── Diff ─────────────────────────────────────────────────────────────────
  diffAddBg: string;
  diffAddText: string;
  diffAddPalette: string;
  diffRemoveBg: string;
  diffRemoveText: string;
  diffRemovePalette: string;

  // ── Scrollbar ────────────────────────────────────────────────────────────
  scrollThumb: string;
  scrollThumbHover: string;
}

// ─── Dark tokens ─────────────────────────────────────────────────────────────

const darkTokens: ThemeTokens = {
  mode: "dark",

  bgPanel: "#18181b",
  bgToolbar: "#09090b",
  bgSurface: "rgba(255,255,255,0.04)",
  bgMuted: "rgba(255,255,255,0.06)",
  bgCode: "#09090b",
  bgHover: "rgba(255,255,255,0.06)",
  bgSelected: "rgba(255,255,255,0.08)",

  textPrimary: "#e4e4e7",
  textSecondary: "#71717a",
  textMuted: "#52525b",
  textDim: "#3f3f46",

  border: "rgba(255,255,255,0.08)",
  borderSubtle: "rgba(255,255,255,0.04)",

  accent: "#94a3b8",
  accentMuted: "#64748b",
  accentText: "#ffffff",
  accentPalette: "gray",

  dangerPalette: "red",

  statusPending: "#eab308",
  statusSuccess: "#22c55e",
  statusError: "#ef4444",
  statusTimeout: "#2dd4bf",

  statusPendingPalette: "yellow",
  statusSuccessPalette: "green",
  statusErrorPalette: "red",
  statusTimeoutPalette: "teal",

  connectedDot: "#4ade80",
  disconnectedDot: "#52525b",
  errorText: "#fca5a5",

  latencyLow: "#4ade80",
  latencyMed: "#facc15",
  latencyHigh: "#f87171",

  logoFill: "#94a3b8",
  logoFillMuted: "#94a3b844",

  emptyIconPrimary: "#374151",
  emptyIconSecondary: "#1f2937",

  themeToggleColor: "#fde047",
  themeToggleHover: "#fef08a",

  eventSessionPalette: "blue",
  eventCallPalette: "cyan",
  eventResponsePalette: "green",
  eventErrorPalette: "red",
  eventDefaultPalette: "gray",

  eventSessionBg: "#3b82f6",
  eventCallBg: "#06b6d4",
  eventResponseBg: "#22c55e",
  eventErrorBg: "#ef4444",
  eventDefaultBg: "#6b7280",
  eventIconText: "#ffffff",

  waterfallBg: "#0c0c0c",
  waterfallGrid: "#27272a",
  waterfallAxisText: "#52525b",
  waterfallLabel: "#71717a",
  waterfallLabelSelected: "#e4e4e7",
  waterfallSelectedBg: "rgba(148, 163, 184, 0.08)",
  waterfallHoverBg: "rgba(255, 255, 255, 0.03)",
  waterfallBarFallback: "#52525b",

  diffAddBg: "rgba(34, 197, 94, 0.08)",
  diffAddText: "#86efac",
  diffAddPalette: "green",
  diffRemoveBg: "rgba(239, 68, 68, 0.08)",
  diffRemoveText: "#fca5a5",
  diffRemovePalette: "red",

  scrollThumb: "#27272a",
  scrollThumbHover: "#3f3f46",
};

// ─── Light tokens ────────────────────────────────────────────────────────────

const lightTokens: ThemeTokens = {
  mode: "light",

  bgPanel: "#ffffff",
  bgToolbar: "#f8fafc",
  bgSurface: "#dde0e4",
  bgMuted: "#e4e7eb",
  bgCode: "#f5f7fa",
  bgHover: "#f1f5f9",
  bgSelected: "#f1f5f9",

  textPrimary: "#1a202c",
  textSecondary: "#334155",
  textMuted: "#64748b",
  textDim: "#94a3b8",

  border: "#e2e8f0",
  borderSubtle: "#f1f5f9",

  accent: "#0f172a",
  accentMuted: "#e4e7eb",
  accentText: "#ffffff",
  accentPalette: "gray",

  dangerPalette: "red",

  statusPending: "#ca8a04",
  statusSuccess: "#16a34a",
  statusError: "#dc2626",
  statusTimeout: "#0d9488",

  statusPendingPalette: "yellow",
  statusSuccessPalette: "green",
  statusErrorPalette: "red",
  statusTimeoutPalette: "teal",

  connectedDot: "#16a34a",
  disconnectedDot: "#cbd2d9",
  errorText: "#dc2626",

  latencyLow: "#16a34a",
  latencyMed: "#ca8a04",
  latencyHigh: "#dc2626",

  logoFill: "#0f172a",
  logoFillMuted: "#0f172a44",

  emptyIconPrimary: "#cbd2d9",
  emptyIconSecondary: "#e4e7eb",

  themeToggleColor: "#64748b",
  themeToggleHover: "#334155",

  eventSessionPalette: "blue",
  eventCallPalette: "cyan",
  eventResponsePalette: "green",
  eventErrorPalette: "red",
  eventDefaultPalette: "gray",

  eventSessionBg: "#3b82f6",
  eventCallBg: "#06b6d4",
  eventResponseBg: "#16a34a",
  eventErrorBg: "#dc2626",
  eventDefaultBg: "#7b8794",
  eventIconText: "#ffffff",

  waterfallBg: "#ffffff",
  waterfallGrid: "#e2e8f0",
  waterfallAxisText: "#94a3b8",
  waterfallLabel: "#64748b",
  waterfallLabelSelected: "#0f172a",
  waterfallSelectedBg: "rgba(15, 23, 42, 0.04)",
  waterfallHoverBg: "rgba(0, 0, 0, 0.02)",
  waterfallBarFallback: "#7b8794",

  diffAddBg: "rgba(34, 197, 94, 0.06)",
  diffAddText: "#15803d",
  diffAddPalette: "green",
  diffRemoveBg: "rgba(239, 68, 68, 0.06)",
  diffRemoveText: "#dc2626",
  diffRemovePalette: "red",

  scrollThumb: "#cbd2d9",
  scrollThumbHover: "#9aa5b1",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Get Chakra colorPalette name for a tool call status */
export function getStatusPalette(status: string, tokens: ThemeTokens): string {
  switch (status) {
    case "pending": return tokens.statusPendingPalette;
    case "success": return tokens.statusSuccessPalette;
    case "error":   return tokens.statusErrorPalette;
    case "timeout": return tokens.statusTimeoutPalette;
    default:        return tokens.accentPalette;
  }
}

/** Get hex color for a tool call status (for D3 / canvas rendering) */
export function getStatusHex(status: string, tokens: ThemeTokens): string {
  switch (status) {
    case "pending": return tokens.statusPending;
    case "success": return tokens.statusSuccess;
    case "error":   return tokens.statusError;
    case "timeout": return tokens.statusTimeout;
    default:        return tokens.waterfallBarFallback;
  }
}

/** Get timeline event metadata from tokens */
export function getEventMeta(type: string, tokens: ThemeTokens): { palette: string; bg: string; label: string; icon: string } {
  switch (type) {
    case "session:start": return { palette: tokens.eventSessionPalette, bg: tokens.eventSessionBg, label: "SESSION START", icon: "\u25B6" };
    case "session:end":   return { palette: tokens.eventSessionPalette, bg: tokens.eventSessionBg, label: "SESSION END", icon: "\u25A0" };
    case "tool:start":    return { palette: tokens.eventCallPalette, bg: tokens.eventCallBg, label: "CALL", icon: "\u2192" };
    case "tool:end":      return { palette: tokens.eventResponsePalette, bg: tokens.eventResponseBg, label: "RESPONSE", icon: "\u2190" };
    case "tool:error":    return { palette: tokens.eventErrorPalette, bg: tokens.eventErrorBg, label: "ERROR", icon: "!" };
    default:              return { palette: tokens.eventDefaultPalette, bg: tokens.eventDefaultBg, label: type, icon: "?" };
  }
}

// ─── Context ─────────────────────────────────────────────────────────────────

interface ThemeCtx {
  tokens: ThemeTokens;
  mode: "light" | "dark";
  toggle: () => void;
}

const ThemeContext = createContext<ThemeCtx>({
  tokens: darkTokens,
  mode: "dark",
  toggle: () => {},
});

export function useTheme(): ThemeCtx {
  return useContext(ThemeContext);
}

// ─── Provider ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "mcp-devtools-theme";

function getInitialMode(): "light" | "dark" {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {}
  // Respect system preference
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<"light" | "dark">(getInitialMode);

  const toggle = useCallback(() => {
    setMode((m) => {
      const next = m === "dark" ? "light" : "dark";
      try { localStorage.setItem(STORAGE_KEY, next); } catch {}
      return next;
    });
  }, []);

  // Listen for system preference changes
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const handler = (e: MediaQueryListEvent) => {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) setMode(e.matches ? "dark" : "light");
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const tokens = mode === "dark" ? darkTokens : lightTokens;

  return (
    <ThemeContext.Provider value={{ tokens, mode, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}
