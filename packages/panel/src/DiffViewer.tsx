/**
 * DiffViewer — Side-by-side request/response diff viewer.
 *
 * All colors are sourced from ThemeTokens — no hardcoded color literals.
 */

import React, { useMemo, useState } from "react";
import { Box, Flex, Text, Button, Badge, Code } from "@chakra-ui/react";
import type { ToolCallRecord } from "@configkits/mcp-devtools-core";
import { StatusBadge, formatTime } from "./shared.jsx";
import { useTheme } from "./theme.jsx";

interface DiffViewerProps {
  calls: ToolCallRecord[];
  currentCall: ToolCallRecord;
}

interface DiffLine {
  type: "same" | "add" | "remove";
  text: string;
  lineNum: { left?: number; right?: number };
}

function computeDiff(a: string, b: string): DiffLine[] {
  const linesA = a.split("\n"), linesB = b.split("\n");
  const m = linesA.length, n = linesB.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    dp[i][j] = linesA[i - 1] === linesB[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  let i = m, j = n;
  const stack: DiffLine[] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && linesA[i - 1] === linesB[j - 1]) { stack.push({ type: "same", text: linesA[i - 1], lineNum: { left: i, right: j } }); i--; j--; }
    else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) { stack.push({ type: "add", text: linesB[j - 1], lineNum: { right: j } }); j--; }
    else { stack.push({ type: "remove", text: linesA[i - 1], lineNum: { left: i } }); i--; }
  }
  stack.reverse();
  return stack;
}

const DIFF_SIGNS = { same: " ", add: "+", remove: "-" };

function DiffBlock({ title, diff }: { title: string; diff: DiffLine[] }) {
  const { tokens: t } = useTheme();
  const addCount = diff.filter((d) => d.type === "add").length;
  const removeCount = diff.filter((d) => d.type === "remove").length;

  const colors = {
    same:   { bg: "transparent", sign: t.textDim, text: t.textMuted },
    add:    { bg: t.diffAddBg, sign: t.diffAddText, text: t.diffAddText },
    remove: { bg: t.diffRemoveBg, sign: t.diffRemoveText, text: t.diffRemoveText },
  };

  return (
    <Box mb="3">
      <Flex align="center" gap="2" mb="6px">
        <Text fontSize="11px" fontWeight="600" color={t.textSecondary} letterSpacing="0.08em" textTransform="uppercase">
          {title}
        </Text>
        {addCount > 0 && <Badge colorPalette={t.diffAddPalette} variant="subtle" fontSize="9px" px="4px" py="0" borderRadius="sm">+{addCount}</Badge>}
        {removeCount > 0 && <Badge colorPalette={t.diffRemovePalette} variant="subtle" fontSize="9px" px="4px" py="0" borderRadius="sm">-{removeCount}</Badge>}
      </Flex>
      <Box borderRadius="md" border="1px solid" borderColor={t.borderSubtle} overflow="hidden" bg={t.bgCode}>
        {diff.map((line, idx) => {
          const c = colors[line.type];
          return (
            <Flex key={idx} bg={c.bg} fontSize="12px" fontFamily="mono" lineHeight="1.6">
              <Text w="20px" textAlign="center" color={c.sign} flexShrink={0} userSelect="none" fontWeight="600">
                {DIFF_SIGNS[line.type]}
              </Text>
              <Text w="32px" textAlign="right" px="4px" color={t.textDim} flexShrink={0} userSelect="none" fontSize="10px">
                {line.lineNum.left ?? ""}
              </Text>
              <Code flex="1" px="8px" py="1px" bg="transparent" color={c.text} whiteSpace="pre" fontSize="12px">
                {line.text}
              </Code>
            </Flex>
          );
        })}
      </Box>
    </Box>
  );
}

export function DiffViewer({ calls, currentCall }: DiffViewerProps) {
  const { tokens: t } = useTheme();
  const comparableCalls = useMemo(
    () => calls.filter((c) => c.toolName === currentCall.toolName && c.id !== currentCall.id && c.status !== "pending"),
    [calls, currentCall],
  );
  const [compareCallId, setCompareCallId] = useState<string | null>(null);
  const compareCall = compareCallId ? comparableCalls.find((c) => c.id === compareCallId) : null;

  const argsDiff = useMemo(() => {
    if (!compareCall) return null;
    return computeDiff(JSON.stringify(compareCall.args, null, 2), JSON.stringify(currentCall.args, null, 2));
  }, [compareCall, currentCall]);

  const resultDiff = useMemo(() => {
    if (!compareCall || compareCall.result === undefined || currentCall.result === undefined) return null;
    return computeDiff(JSON.stringify(compareCall.result, null, 2), JSON.stringify(currentCall.result, null, 2));
  }, [compareCall, currentCall]);

  if (comparableCalls.length === 0) {
    return <Box p="3"><Text fontSize="11px" color={t.textMuted} fontStyle="italic">No other calls to &ldquo;{currentCall.toolName}&rdquo; to compare with.</Text></Box>;
  }

  return (
    <Box>
      <Box mb="3">
        <Text fontSize="11px" fontWeight="600" color={t.textSecondary} letterSpacing="0.08em" textTransform="uppercase" mb="6px">Compare With</Text>
        <Flex gap="4px" flexWrap="wrap">
          {comparableCalls.slice(0, 8).map((c) => (
            <Button key={c.id} size="xs" variant={compareCallId === c.id ? "subtle" : "outline"}
              colorPalette={compareCallId === c.id ? t.accentPalette : undefined}
              onClick={() => setCompareCallId(compareCallId === c.id ? null : c.id)}
              fontSize="10px" fontFamily="mono" h="22px" px="6px" minW="auto" borderColor={t.border}>
              {formatTime(c.startedAt)}
              <Box as="span" ml="4px"><StatusBadge status={c.status} /></Box>
            </Button>
          ))}
        </Flex>
      </Box>
      {compareCall && argsDiff && (
        <>
          <DiffBlock title="Arguments Diff" diff={argsDiff} />
          {resultDiff && <DiffBlock title="Result Diff" diff={resultDiff} />}
        </>
      )}
    </Box>
  );
}
