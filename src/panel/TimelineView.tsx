/**
 * TimelineView — Chronological event timeline with session replay controls.
 *
 * Shows every event (tool:start, tool:end, session:start, etc.) in time order.
 * Replay mode: play/pause/step through events as if they're happening live.
 *
 * All colors are sourced from ThemeTokens — no hardcoded color literals.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Box, Flex, Text, Button, Badge } from "@chakra-ui/react";
import type { ToolCallRecord, Session } from "../core/types.js";
import { formatTimePrecise, EmptyState } from "./shared.jsx";
import { useTheme, getEventMeta } from "./theme.jsx";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TimelineEvent {
  id: string;
  timestamp: number;
  type: "tool:start" | "tool:end" | "tool:error" | "session:start" | "session:end";
  toolName?: string;
  status?: string;
  latencyMs?: number;
  callId?: string;
  sessionId: string;
  serverId?: string;
}

interface TimelineViewProps {
  calls: ToolCallRecord[];
  sessions: Session[];
  onSelectCall: (callId: string) => void;
  selectedCallId: string | null;
}

const REPLAY_SPEEDS = [0.5, 1, 2, 4, 8] as const;

// ─── Build timeline events from calls and sessions ────────────────────────────

function buildTimelineEvents(calls: ToolCallRecord[], sessions: Session[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const session of sessions) {
    events.push({ id: `session-start-${session.id}`, timestamp: session.startedAt, type: "session:start", sessionId: session.id, serverId: session.serverId });
    if (session.endedAt) {
      events.push({ id: `session-end-${session.id}`, timestamp: session.endedAt, type: "session:end", sessionId: session.id, serverId: session.serverId });
    }
  }

  for (const call of calls) {
    events.push({ id: `tool-start-${call.id}`, timestamp: call.startedAt, type: "tool:start", toolName: call.toolName, callId: call.id, sessionId: call.sessionId, serverId: call.serverId });
    if (call.endedAt) {
      events.push({
        id: `tool-end-${call.id}`, timestamp: call.endedAt,
        type: call.status === "error" || call.status === "timeout" ? "tool:error" : "tool:end",
        toolName: call.toolName, status: call.status, latencyMs: call.latencyMs, callId: call.id, sessionId: call.sessionId,
      });
    }
  }

  events.sort((a, b) => a.timestamp - b.timestamp);
  return events;
}

// ─── Timeline Event Row ──────────────────────────────────────────────────────

function TimelineEventRow({ event, selected, dimmed, onClick }: {
  event: TimelineEvent; selected: boolean; dimmed: boolean; onClick: () => void;
}) {
  const { tokens: t } = useTheme();
  const meta = getEventMeta(event.type, t);

  return (
    <Flex
      align="center" gap="10px" py="6px" px="14px" cursor="pointer"
      bg={selected ? t.bgSelected : "transparent"}
      borderLeft="2px solid" borderLeftColor={selected ? t.accent : "transparent"}
      opacity={dimmed ? 0.35 : 1} transition="all 0.15s"
      borderBottom="1px solid" borderBottomColor={t.borderSubtle}
      _hover={{ bg: t.bgHover }}
      onClick={onClick}
    >
      <Text fontSize="11px" color={t.textMuted} fontFamily="mono" minW="85px" flexShrink={0}>
        {formatTimePrecise(event.timestamp)}
      </Text>
      <Flex w="20px" h="20px" align="center" justify="center" borderRadius="sm"
        bg={meta.bg} color={t.eventIconText} fontSize="11px" fontWeight="700" flexShrink={0} opacity={0.9}>
        {meta.icon}
      </Flex>
      <Badge colorPalette={meta.palette} variant="subtle" fontSize="9px" fontWeight="600"
        letterSpacing="0.08em" px="5px" py="0" borderRadius="sm" fontFamily="mono" flexShrink={0}>
        {meta.label}
      </Badge>
      <Text fontSize="12px" color={t.textPrimary} fontFamily="mono" flex="1"
        overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
        {event.toolName ?? event.serverId ?? event.sessionId.slice(0, 8)}
      </Text>
      {event.latencyMs !== undefined && (
        <Text fontSize="11px" color={t.textSecondary} fontFamily="mono" flexShrink={0}>
          {event.latencyMs}ms
        </Text>
      )}
    </Flex>
  );
}

// ─── Replay Controls ─────────────────────────────────────────────────────────

function ReplayControls({ isPlaying, onPlay, onPause, onStepBack, onStepForward, onReset, speed, onSpeedChange, currentIndex, totalEvents, onSeek }: {
  isPlaying: boolean; onPlay: () => void; onPause: () => void; onStepBack: () => void;
  onStepForward: () => void; onReset: () => void; speed: number; onSpeedChange: (speed: number) => void;
  currentIndex: number; totalEvents: number; onSeek: (index: number) => void;
}) {
  const { tokens: t } = useTheme();

  return (
    <Flex align="center" gap="6px" px="14px" py="6px" borderBottom="1px solid"
      borderBottomColor={t.border} bg={t.bgToolbar} flexShrink={0}>
      <Button variant="ghost" size="xs" onClick={onReset} minW="auto" h="22px" px="4px"
        color={t.textSecondary} title="Reset to start">&#x23EE;</Button>
      <Button variant="ghost" size="xs" onClick={onStepBack} minW="auto" h="22px" px="4px"
        color={t.textSecondary} title="Step back" disabled={currentIndex <= 0}>&#x23EA;</Button>
      <Button variant={isPlaying ? "subtle" : "solid"} colorPalette={isPlaying ? t.dangerPalette : t.accentPalette}
        size="xs" onClick={isPlaying ? onPause : onPlay} minW="auto" h="24px" px="10px"
        fontSize="11px" fontWeight="600">
        {isPlaying ? "Pause" : "Play"}
      </Button>
      <Button variant="ghost" size="xs" onClick={onStepForward} minW="auto" h="22px" px="4px"
        color={t.textSecondary} title="Step forward" disabled={currentIndex >= totalEvents - 1}>&#x23E9;</Button>

      <Box flex="1" mx="6px">
        <Box position="relative" h="6px">
          <Box h="4px" bg={t.bgMuted} borderRadius="full" mt="1px" />
          <Box position="absolute" top="1px" left="0" h="4px"
            w={`${totalEvents > 0 ? ((currentIndex + 1) / totalEvents) * 100 : 0}%`}
            bg={t.accent} borderRadius="full" transition="width 0.1s" />
          <input type="range" min={0} max={Math.max(totalEvents - 1, 0)} value={currentIndex}
            onChange={(e) => onSeek(Number(e.target.value))}
            style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "6px", opacity: 0, cursor: "pointer" }} />
        </Box>
      </Box>

      <Text fontSize="10px" color={t.textSecondary} fontFamily="mono" minW="48px" textAlign="center">
        {currentIndex + 1}/{totalEvents}
      </Text>

      <Flex gap="2px">
        {REPLAY_SPEEDS.map((s) => (
          <Button key={s} variant={speed === s ? "subtle" : "ghost"} colorPalette={speed === s ? t.accentPalette : undefined}
            size="xs" fontSize="10px" fontWeight="600" minW="auto" h="20px" px="5px" borderRadius="sm"
            color={speed === s ? undefined : t.textMuted} onClick={() => onSpeedChange(s)}>
            {s}x
          </Button>
        ))}
      </Flex>
    </Flex>
  );
}

// ─── Main Timeline View ──────────────────────────────────────────────────────

export function TimelineView({ calls, sessions, onSelectCall, selectedCallId }: TimelineViewProps) {
  const events = useMemo(() => buildTimelineEvents(calls, sessions), [calls, sessions]);
  const [replayIndex, setReplayIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const isReplaying = replayIndex >= 0;

  useEffect(() => {
    if (!isPlaying || replayIndex >= events.length - 1) {
      if (isPlaying && replayIndex >= events.length - 1) setIsPlaying(false);
      return;
    }
    const current = events[replayIndex], next = events[replayIndex + 1];
    if (!current || !next) return;
    const scaledDelay = Math.max(50, Math.min((next.timestamp - current.timestamp) / speed, 2000));
    timerRef.current = setTimeout(() => setReplayIndex((i) => i + 1), scaledDelay);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [isPlaying, replayIndex, events, speed]);

  useEffect(() => {
    if (isReplaying && listRef.current) {
      const row = listRef.current.querySelector(`[data-idx="${replayIndex}"]`);
      row?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [replayIndex, isReplaying]);

  const handlePlay = useCallback(() => { if (replayIndex < 0) setReplayIndex(0); setIsPlaying(true); }, [replayIndex]);
  const handlePause = useCallback(() => setIsPlaying(false), []);
  const handleReset = useCallback(() => { setIsPlaying(false); setReplayIndex(-1); }, []);
  const handleStepForward = useCallback(() => { setIsPlaying(false); setReplayIndex((i) => Math.min(i + 1, events.length - 1)); }, [events.length]);
  const handleStepBack = useCallback(() => { setIsPlaying(false); setReplayIndex((i) => Math.max(i - 1, 0)); }, []);
  const handleSeek = useCallback((idx: number) => { setIsPlaying(false); setReplayIndex(idx); }, []);

  if (events.length === 0) return <EmptyState message="No events recorded yet" />;

  return (
    <Flex direction="column" h="100%">
      <ReplayControls isPlaying={isPlaying} onPlay={handlePlay} onPause={handlePause}
        onStepBack={handleStepBack} onStepForward={handleStepForward} onReset={handleReset}
        speed={speed} onSpeedChange={setSpeed} currentIndex={isReplaying ? replayIndex : events.length - 1}
        totalEvents={events.length} onSeek={handleSeek} />
      <Box ref={listRef} flex="1" overflow="auto">
        {events.map((event, idx) => (
          <TimelineEventRow key={event.id} event={event} selected={event.callId === selectedCallId}
            dimmed={isReplaying && idx > replayIndex}
            onClick={() => event.callId && onSelectCall(event.callId)} />
        ))}
      </Box>
    </Flex>
  );
}
