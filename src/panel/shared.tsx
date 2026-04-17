/**
 * Shared components used across Stream, Timeline, and Waterfall views.
 *
 * All colors are sourced from ThemeTokens — no hardcoded color literals.
 */

import React, { useState, useMemo } from "react";
import { Box, Flex, Text, Badge, Code } from "@chakra-ui/react";
import type { ToolCallStatus } from "../core/types.js";
import { useTheme, getStatusPalette } from "./theme.jsx";

// ─── Constants ───────────────────────────────────────────────────────────────

export const STATUS_LABEL: Record<ToolCallStatus, string> = {
  pending: "PENDING",
  success: "OK",
  error:   "ERR",
  timeout: "TIMEOUT",
};

// Re-export helpers from theme so existing imports keep working
export { getStatusPalette, getStatusHex } from "./theme.jsx";

// ─── Components ──────────────────────────────────────────────────────────────

export function StatusBadge({ status }: { status: ToolCallStatus }) {
  const { tokens: t } = useTheme();

  return (
    <Badge
      colorPalette={getStatusPalette(status, t)}
      variant="subtle"
      fontSize="10px"
      fontWeight="700"
      letterSpacing="0.06em"
      px="6px"
      py="1px"
      borderRadius="sm"
      fontFamily="mono"
      minW="52px"
      textAlign="center"
    >
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function LatencyBar({ latencyMs, maxLatencyMs }: { latencyMs: number; maxLatencyMs: number }) {
  const { tokens: t } = useTheme();
  const pct = Math.min((latencyMs / Math.max(maxLatencyMs, 1)) * 100, 100);
  const color = latencyMs < 100 ? t.latencyLow : latencyMs < 500 ? t.latencyMed : t.latencyHigh;

  return (
    <Flex align="center" gap="6px" minW="80px">
      <Box flex="1" h="4px" bg={t.bgMuted} borderRadius="sm" overflow="hidden">
        <Box w={`${pct}%`} h="100%" bg={color} borderRadius="sm" transition="width 0.3s ease" />
      </Box>
      <Text fontSize="11px" color={t.textMuted} fontFamily="mono" minW="42px" textAlign="right">
        {formatLatency(latencyMs)}
      </Text>
    </Flex>
  );
}

export function JsonViewer({ label, data }: { label: string; data: unknown }) {
  const { tokens: t } = useTheme();
  const [expanded, setExpanded] = useState(true);
  const formatted = useMemo(() => JSON.stringify(data, null, 2), [data]);

  return (
    <Box mb="3">
      <Flex
        as="button"
        onClick={() => setExpanded((e) => !e)}
        align="center"
        gap="6px"
        cursor="pointer"
        fontSize="11px"
        fontWeight="600"
        color={t.textSecondary}
        letterSpacing="0.08em"
        textTransform="uppercase"
        mb="6px"
        userSelect="none"
        bg="transparent"
        border="none"
        p="0"
      >
        <Text
          as="span"
          fontSize="9px"
          transform={expanded ? "rotate(90deg)" : "rotate(0)"}
          transition="transform 0.15s"
          display="inline-block"
        >
          ▶
        </Text>
        {label}
      </Flex>
      {expanded && (
        <Code
          display="block"
          whiteSpace="pre-wrap"
          p="10px 12px"
          bg={t.bgCode}
          borderRadius="md"
          fontSize="12px"
          lineHeight="1.7"
          color={t.textPrimary}
          overflowX="auto"
          fontFamily="mono"
          wordBreak="break-all"
          borderWidth="1px"
          borderColor={t.borderSubtle}
        >
          {formatted}
        </Code>
      )}
    </Box>
  );
}

export function Logo() {
  const { tokens: t } = useTheme();

  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="1" width="5" height="5" rx="1" fill={t.logoFill} />
      <rect x="8" y="1" width="5" height="5" rx="1" fill={t.logoFillMuted} />
      <rect x="1" y="8" width="5" height="5" rx="1" fill={t.logoFillMuted} />
      <rect x="8" y="8" width="5" height="5" rx="1" fill={t.logoFill} />
    </svg>
  );
}

export function EmptyState({ message }: { message: string }) {
  const { tokens: t } = useTheme();

  return (
    <Flex align="center" justify="center" h="100%" color={t.textDim} fontSize="13px" direction="column" gap="2">
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <rect x="4" y="4" width="10" height="10" rx="2" fill={t.emptyIconPrimary} />
        <rect x="18" y="4" width="10" height="10" rx="2" fill={t.emptyIconSecondary} />
        <rect x="4" y="18" width="10" height="10" rx="2" fill={t.emptyIconSecondary} />
        <rect x="18" y="18" width="10" height="10" rx="2" fill={t.emptyIconPrimary} />
      </svg>
      <Text>{message}</Text>
    </Flex>
  );
}

// ─── Utilities ───────────────────────────────────────────────────────────────

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatTimePrecise(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
    + "." + String(d.getMilliseconds()).padStart(3, "0");
}

export function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
