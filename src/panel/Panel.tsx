/**
 * @configkits/mcp-devtools
 * panel/Panel.tsx — Main panel orchestrator (Chakra UI v3)
 *
 * Features:
 *  - Tabbed interface: Stream | Timeline | Waterfall
 *  - Light / dark theme with system preference detection
 *  - Real-time tool call stream with filtering (text, status, time range)
 *  - Session timeline with replay controls (play/pause/step/rewind)
 *  - D3.js network waterfall chart
 *  - Request/response diff viewer in detail drawer
 *  - Session export as JSON
 *  - Shareable deep-links via URL hash
 *
 * All colors are sourced from ThemeTokens — no hardcoded color literals.
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import {
  Box,
  Flex,
  Grid,
  Text,
  Button,
  Input,
  Heading,
} from "@chakra-ui/react";
import type { ToolCallRecord, ToolCallStatus, DevToolsEvent, Session } from "../core/types.js";
import {
  StatusBadge,
  LatencyBar,
  JsonViewer,
  Logo,
  EmptyState,
  formatTime,
  STATUS_LABEL,
} from "./shared.jsx";
import { TimelineView } from "./TimelineView.jsx";
import { WaterfallChart } from "./WaterfallChart.jsx";
import { DiffViewer } from "./DiffViewer.jsx";
import { useTheme, getStatusPalette } from "./theme.jsx";

// ─── Constants ────────────────────────────────────────────────────────────────

type TabId = "stream" | "timeline" | "waterfall";
const TABS: { id: TabId; label: string }[] = [
  { id: "stream", label: "Stream" },
  { id: "timeline", label: "Timeline" },
  { id: "waterfall", label: "Waterfall" },
];

const FILTER_OPTIONS = ["all", "success", "error", "pending", "timeout"] as const;

// ─── State ────────────────────────────────────────────────────────────────────

interface PanelState {
  calls: ToolCallRecord[];
  sessions: Session[];
  callMap: Map<string, ToolCallRecord>;
}

type PanelAction =
  | { type: "snapshot"; sessions: Session[]; calls: ToolCallRecord[] }
  | { type: "tool:start"; call: ToolCallRecord }
  | { type: "tool:end" | "tool:error"; call: ToolCallRecord }
  | { type: "session:start"; session: Session }
  | { type: "session:end"; sessionId: string; endedAt: number };

function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case "snapshot": {
      const callMap = new Map(action.calls.map((c) => [c.id, c]));
      return { calls: action.calls.slice().reverse(), sessions: action.sessions, callMap };
    }
    case "session:start":
      return { ...state, sessions: [action.session, ...state.sessions] };
    case "session:end": {
      const sessions = state.sessions.map((s) =>
        s.id === action.sessionId ? { ...s, endedAt: action.endedAt } : s,
      );
      return { ...state, sessions };
    }
    case "tool:start": {
      const callMap = new Map(state.callMap);
      callMap.set(action.call.id, action.call);
      return { ...state, calls: [action.call, ...state.calls], callMap };
    }
    case "tool:end":
    case "tool:error": {
      const callMap = new Map(state.callMap);
      callMap.set(action.call.id, action.call);
      const calls = state.calls.map((c) => c.id === action.call.id ? action.call : c);
      return { ...state, calls, callMap };
    }
    default:
      return state;
  }
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useDevToolsEvents(): [PanelState, React.Dispatch<PanelAction>] {
  const [state, dispatch] = React.useReducer(panelReducer, { calls: [], sessions: [], callMap: new Map() });

  useEffect(() => {
    function handleEvent(ev: Event) {
      const event = (ev as CustomEvent<DevToolsEvent | { type: "snapshot"; data: { sessions: Session[]; calls: ToolCallRecord[] } }>).detail;
      if (event.type === "snapshot") {
        const snap = event as { type: "snapshot"; data: { sessions: Session[]; calls: ToolCallRecord[] } };
        dispatch({ type: "snapshot", ...snap.data });
        return;
      }
      switch (event.type) {
        case "session:start": dispatch({ type: "session:start", session: event.session }); break;
        case "session:end": dispatch({ type: "session:end", sessionId: event.sessionId, endedAt: event.endedAt }); break;
        case "tool:start": dispatch({ type: "tool:start", call: event.call }); break;
        case "tool:end": case "tool:error": dispatch({ type: "tool:end", call: event.call }); break;
      }
    }
    window.addEventListener("mcp-devtools:event", handleEvent);
    return () => window.removeEventListener("mcp-devtools:event", handleEvent);
  }, []);

  return [state, dispatch];
}

function useDeepLinks(setTab: (tab: TabId) => void, setSelectedCallId: (id: string | null) => void) {
  useEffect(() => {
    function parseHash() {
      const hash = window.location.hash.slice(1);
      if (!hash) return;
      const parts = hash.split("/");
      if (parts[0] === "tab" && parts[1]) setTab(parts[1] as TabId);
      if (parts[0] === "call" && parts[1]) { setSelectedCallId(parts[1]); setTab("stream"); }
    }
    parseHash();
    window.addEventListener("hashchange", parseHash);
    return () => window.removeEventListener("hashchange", parseHash);
  }, [setTab, setSelectedCallId]);
}

function updateHash(tab: TabId, callId?: string | null) {
  if (callId) window.history.replaceState(null, "", `#call/${callId}`);
  else window.history.replaceState(null, "", `#tab/${tab}`);
}

// ─── Theme toggle icon ───────────────────────────────────────────────────────

function ThemeToggle() {
  const { mode, toggle, tokens: t } = useTheme();
  return (
    <Button
      variant="ghost"
      size="xs"
      onClick={toggle}
      title={`Switch to ${mode === "dark" ? "light" : "dark"} mode`}
      fontSize="14px"
      p="0 4px"
      minW="auto"
      h="auto"
      color={t.themeToggleColor}
      _hover={{ color: t.themeToggleHover }}
    >
      {mode === "dark" ? "\u2600" : "\u263E"}
    </Button>
  );
}

// ─── Stream sub-components ───────────────────────────────────────────────────

function CallRow({ call, selected, maxLatencyMs, onClick }: {
  call: ToolCallRecord; selected: boolean; maxLatencyMs: number; onClick: () => void;
}) {
  const { tokens: t } = useTheme();
  const isError = call.status === "error" || call.status === "timeout";
  return (
    <Grid
      templateColumns="64px 1fr 80px 100px" alignItems="center" gap="12px"
      py="7px" px="14px" cursor="pointer"
      bg={selected ? t.bgSelected : "transparent"}
      borderLeft="2px solid" borderLeftColor={selected ? t.accent : "transparent"}
      transition="background 0.1s"
      borderBottom="1px solid" borderBottomColor={t.borderSubtle}
      _hover={{ bg: t.bgHover }}
      onClick={onClick}
    >
      <Text fontSize="11px" color={t.textMuted} fontFamily="mono">{formatTime(call.startedAt)}</Text>
      <Text fontSize="12px" color={isError ? t.errorText : t.textPrimary} fontFamily="mono"
        overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
        {call.toolName}
      </Text>
      <StatusBadge status={call.status} />
      {call.latencyMs !== undefined ? (
        <LatencyBar latencyMs={call.latencyMs} maxLatencyMs={maxLatencyMs} />
      ) : (
        <Text fontSize="11px" color={t.textMuted} fontFamily="mono">---</Text>
      )}
    </Grid>
  );
}

function DetailDrawer({ call, allCalls, onClose }: {
  call: ToolCallRecord; allCalls: ToolCallRecord[]; onClose: () => void;
}) {
  const { tokens: t } = useTheme();
  const [showDiff, setShowDiff] = useState(false);
  const shareUrl = `${window.location.origin}${window.location.pathname}#call/${call.id}`;

  return (
    <Box flex="0 0 380px" borderLeft="1px solid" borderLeftColor={t.border} overflow="auto" p="14px 16px">
      <Flex align="center" justify="space-between" mb="4">
        <Box>
          <Heading as="h3" fontSize="13px" fontWeight="600" color={t.textPrimary} fontFamily="mono">{call.toolName}</Heading>
          <Text fontSize="11px" color={t.textSecondary} mt="2px">
            {call.serverId} · {call.latencyMs !== undefined ? `${call.latencyMs}ms` : "pending..."}
          </Text>
        </Box>
        <Flex align="center" gap="2">
          <StatusBadge status={call.status} />
          <Button variant="ghost" size="xs" onClick={onClose} color={t.textSecondary} fontSize="18px" lineHeight="1" p="0 4px" minW="auto" h="auto">x</Button>
        </Flex>
      </Flex>

      <Flex gap="4px" mb="3">
        <Button size="xs" variant={!showDiff ? "subtle" : "ghost"} colorPalette={!showDiff ? t.accentPalette : undefined}
          onClick={() => setShowDiff(false)} fontSize="10px" fontWeight="600" h="20px" px="8px" minW="auto" borderRadius="sm"
          color={!showDiff ? undefined : t.textMuted}>Data</Button>
        <Button size="xs" variant={showDiff ? "subtle" : "ghost"} colorPalette={showDiff ? t.accentPalette : undefined}
          onClick={() => setShowDiff(true)} fontSize="10px" fontWeight="600" h="20px" px="8px" minW="auto" borderRadius="sm"
          color={showDiff ? undefined : t.textMuted}>Diff</Button>
      </Flex>

      {showDiff ? (
        <DiffViewer calls={allCalls} currentCall={call} />
      ) : (
        <>
          <JsonViewer label="Arguments" data={call.args} />
          {call.result !== undefined && <JsonViewer label="Result" data={call.result} />}
          {call.error !== undefined && <JsonViewer label="Error" data={call.error} />}
        </>
      )}

      <Box mt="4" p="10px 12px" bg={t.bgSurface} borderRadius="md" fontSize="11px" fontFamily="mono" color={t.textSecondary} lineHeight="2">
        <Box>Started: <Text as="span" color={t.textMuted}>{new Date(call.startedAt).toISOString()}</Text></Box>
        {call.endedAt && <Box>Ended: <Text as="span" color={t.textMuted}>{new Date(call.endedAt).toISOString()}</Text></Box>}
        <Box>Request ID: <Text as="span" color={t.textMuted}>{call.requestId}</Text></Box>
        <Box>Session: <Text as="span" color={t.textMuted}>{call.sessionId.slice(0, 8)}...</Text></Box>
      </Box>

      <Flex mt="3" align="center" gap="2">
        <Button variant="outline" size="xs" fontSize="10px" h="22px" px="6px" minW="auto"
          color={t.textSecondary} borderColor={t.border} _hover={{ bg: t.bgHover }}
          onClick={() => navigator.clipboard.writeText(shareUrl)} title={shareUrl}>
          Copy Link
        </Button>
        <Text fontSize="10px" color={t.textDim} fontFamily="mono" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
          #call/{call.id.slice(0, 8)}...
        </Text>
      </Flex>
    </Box>
  );
}

function SessionBar({ sessions }: { sessions: Session[] }) {
  const { tokens: t } = useTheme();
  const active = sessions.find((s) => !s.endedAt);
  const totalCalls = sessions.reduce((acc, s) => acc + s.callIds.length, 0);

  return (
    <Flex align="center" gap="4" px="14px" borderBottom="1px solid" borderBottomColor={t.border} h="32px" flexShrink={0}>
      <Flex align="center" gap="6px">
        <Box w="7px" h="7px" borderRadius="full" bg={active ? t.connectedDot : t.disconnectedDot}
          boxShadow={active ? "0 0 6px rgba(16, 185, 129, 0.4)" : "none"} />
        <Text fontSize="11px" color={t.textSecondary}>
          {active ? `Connected · ${active.serverId}` : "Disconnected"}
        </Text>
      </Flex>
      <Text fontSize="11px" color={t.textMuted}>·</Text>
      <Text fontSize="11px" color={t.textSecondary}>{totalCalls} calls</Text>
      <Text fontSize="11px" color={t.textMuted}>·</Text>
      <Text fontSize="11px" color={t.textSecondary}>{sessions.length} session{sessions.length !== 1 ? "s" : ""}</Text>
      {active?.protocolVersion && (
        <>
          <Text fontSize="11px" color={t.textMuted}>·</Text>
          <Text fontSize="11px" color={t.textMuted}>MCP {active.protocolVersion}</Text>
        </>
      )}
    </Flex>
  );
}

// ─── Stream View ─────────────────────────────────────────────────────────────

function StreamView({ calls, selectedCallId, onSelectCall, filter, filterStatus, timeFrom, timeTo }: {
  calls: ToolCallRecord[]; selectedCallId: string | null; onSelectCall: (id: string | null) => void;
  filter: string; filterStatus: ToolCallStatus | "all"; timeFrom: string; timeTo: string;
}) {
  const { tokens: t } = useTheme();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (listRef.current && !selectedCallId) listRef.current.scrollTop = 0; }, [calls.length, selectedCallId]);

  const filteredCalls = useMemo(() => {
    return calls.filter((call) => {
      const matchesText = filter === "" || call.toolName.toLowerCase().includes(filter.toLowerCase()) || call.serverId.toLowerCase().includes(filter.toLowerCase());
      const matchesStatus = filterStatus === "all" || call.status === filterStatus;
      let matchesTime = true;
      if (timeFrom) { const from = parseTimeInput(timeFrom, call.startedAt); if (from !== null) matchesTime = matchesTime && call.startedAt >= from; }
      if (timeTo) { const to = parseTimeInput(timeTo, call.startedAt); if (to !== null) matchesTime = matchesTime && call.startedAt <= to; }
      return matchesText && matchesStatus && matchesTime;
    });
  }, [calls, filter, filterStatus, timeFrom, timeTo]);

  const maxLatencyMs = useMemo(() => Math.max(1, ...filteredCalls.map((c) => c.latencyMs ?? 0).filter(Boolean)), [filteredCalls]);

  return (
    <Flex flex="1" overflow="hidden" direction="column">
      <Grid templateColumns="64px 1fr 80px 100px" gap="12px" py="6px" px="14px"
        borderBottom="1px solid" borderBottomColor={t.borderSubtle}
        fontSize="10px" color={t.textMuted} fontWeight="600" letterSpacing="0.08em" textTransform="uppercase" flexShrink={0}>
        <Text>Time</Text><Text>Tool</Text><Text>Status</Text><Text>Latency</Text>
      </Grid>
      <Box ref={listRef} flex="1" overflow="auto">
        {filteredCalls.length === 0 ? (
          <EmptyState message={calls.length === 0 ? "Waiting for MCP tool calls..." : "No calls match the current filter"} />
        ) : filteredCalls.map((call) => (
          <CallRow key={call.id} call={call} selected={call.id === selectedCallId} maxLatencyMs={maxLatencyMs}
            onClick={() => onSelectCall(selectedCallId === call.id ? null : call.id)} />
        ))}
      </Box>
    </Flex>
  );
}

function parseTimeInput(value: string, referenceTs: number): number | null {
  const match = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const d = new Date(referenceTs);
  d.setHours(Number(match[1]), Number(match[2]), Number(match[3] ?? 0), 0);
  return d.getTime();
}

// ─── Main Panel ──────────────────────────────────────────────────────────────

export function Panel({ fullscreen = false }: { fullscreen?: boolean } = {}) {
  const { tokens: t } = useTheme();
  const [state] = useDevToolsEvents();
  const [activeTab, setActiveTab] = useState<TabId>("stream");
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [minimized, setMinimized] = useState(false);
  const [filterStatus, setFilterStatus] = useState<ToolCallStatus | "all">("all");
  const [timeFrom, setTimeFrom] = useState("");
  const [timeTo, setTimeTo] = useState("");

  const selectedCall = selectedCallId ? state.callMap.get(selectedCallId) ?? null : null;
  const hasDrawer = selectedCall !== null;

  useDeepLinks(setActiveTab, setSelectedCallId);
  useEffect(() => { updateHash(activeTab, selectedCallId); }, [activeTab, selectedCallId]);

  const handleSelectCall = useCallback((id: string | null) => setSelectedCallId(id), []);

  const handleExport = useCallback(() => {
    const json = JSON.stringify({ sessions: state.sessions, calls: state.calls }, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `mcp-session-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
  }, [state]);

  if (!fullscreen && minimized) {
    return (
      <Flex onClick={() => setMinimized(false)} position="fixed" bottom="16px" right="16px" pointerEvents="all"
        bg={t.bgPanel} border="1px solid" borderColor={t.accent} borderRadius="lg"
        py="6px" px="12px" cursor="pointer" align="center" gap="2"
        fontSize="12px" color={t.textPrimary} boxShadow="lg" zIndex={2147483647}
        _hover={{ bg: t.bgHover }}>
        <Box w="8px" h="8px" borderRadius="full" bg={t.accent} />
        <Text fontWeight="600">mcp-devtools</Text>
        <Text color={t.textSecondary} fontSize="11px">{state.calls.length} calls</Text>
      </Flex>
    );
  }

  return (
    <Flex
      {...(fullscreen
        ? { w: "100%", h: "100vh" }
        : {
            position: "fixed" as const, bottom: "0", right: "0",
            w: hasDrawer ? "920px" : "580px", h: "480px",
            border: "1px solid", borderColor: t.border, borderBottom: "none",
            borderRadius: "12px 12px 0 0", boxShadow: "dark-lg",
            pointerEvents: "all" as const, zIndex: 2147483647,
            transition: "width 0.2s ease",
          }
      )}
      bg={t.bgPanel} direction="column" color={t.textPrimary} overflow="hidden"
    >
      {/* Toolbar */}
      <Flex align="center" gap="2" px="14px" h="40px" borderBottom="1px solid"
        borderBottomColor={t.border} flexShrink={0} bg={t.bgToolbar}>
        <Flex align="center" gap="6px" mr="1">
          <Logo />
          <Text fontSize="12px" fontWeight="600" color={t.textSecondary} letterSpacing="0.02em">mcp-devtools</Text>
        </Flex>

        {/* Tabs */}
        <Flex gap="1px" ml="2" bg={t.bgSurface} borderRadius="md" p="2px">
          {TABS.map((tab) => (
            <Button key={tab.id} size="xs" variant={activeTab === tab.id ? "subtle" : "ghost"}
              colorPalette={activeTab === tab.id ? t.accentPalette : undefined}
              onClick={() => setActiveTab(tab.id)} fontSize="11px" fontWeight="600" h="22px" px="10px"
              minW="auto" borderRadius="sm" color={activeTab === tab.id ? undefined : t.textSecondary}>
              {tab.label}
            </Button>
          ))}
        </Flex>

        <Box flex="1" />

        {/* Stream-only controls */}
        {activeTab === "stream" && (
          <>
            <Input type="text" placeholder="Filter tools..." value={filter}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilter(e.target.value)}
              size="xs" h="24px" w="120px" bg={t.bgSurface} borderColor={t.border} borderRadius="sm" px="8px"
              fontSize="12px" color={t.textPrimary}
              _placeholder={{ color: t.textDim }} _focus={{ borderColor: t.accent, boxShadow: "none" }} />
            <Input type="text" placeholder="From HH:MM" value={timeFrom}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTimeFrom(e.target.value)}
              size="xs" h="24px" w="80px" bg={t.bgSurface} borderColor={t.border} borderRadius="sm" px="8px"
              fontSize="10px" color={t.textPrimary} fontFamily="mono"
              _placeholder={{ color: t.textDim }} _focus={{ borderColor: t.accent, boxShadow: "none" }} />
            <Text fontSize="10px" color={t.textMuted}>-</Text>
            <Input type="text" placeholder="To HH:MM" value={timeTo}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTimeTo(e.target.value)}
              size="xs" h="24px" w="80px" bg={t.bgSurface} borderColor={t.border} borderRadius="sm" px="8px"
              fontSize="10px" color={t.textPrimary} fontFamily="mono"
              _placeholder={{ color: t.textDim }} _focus={{ borderColor: t.accent, boxShadow: "none" }} />
            {FILTER_OPTIONS.map((s) => {
              const isActive = filterStatus === s;
              const palette = s === "all" ? t.accentPalette : getStatusPalette(s, t);
              return (
                <Button key={s} size="xs" variant={isActive ? "subtle" : "ghost"}
                  colorPalette={isActive ? palette : undefined}
                  onClick={() => setFilterStatus(s)} fontSize="10px" fontWeight="600" px="7px" h="20px"
                  minW="auto" letterSpacing="0.06em" textTransform="uppercase" borderRadius="sm"
                  color={isActive ? undefined : t.textMuted}>
                  {s === "all" ? "ALL" : STATUS_LABEL[s as ToolCallStatus]}
                </Button>
              );
            })}
          </>
        )}

        <Button variant="outline" size="xs" onClick={handleExport} title="Export session as JSON" textTransform="uppercase"
          fontSize="11px" color={t.textSecondary} borderColor={t.border} h="22px" px="6px" minW="auto" fontWeight="600"
          _hover={{ bg: t.bgHover }}>Export</Button>
        <ThemeToggle />
        {!fullscreen && (
          <Button variant="ghost" size="xs" onClick={() => setMinimized(true)} title="Minimize"
            fontSize="16px" color={t.textMuted} p="0 4px" minW="auto" h="auto"
            _hover={{ color: t.textPrimary }}>_</Button>
        )}
      </Flex>

      <SessionBar sessions={state.sessions} />

      <Flex flex="1" overflow="hidden">
        {activeTab === "stream" && (
          <StreamView calls={state.calls} selectedCallId={selectedCallId} onSelectCall={handleSelectCall}
            filter={filter} filterStatus={filterStatus} timeFrom={timeFrom} timeTo={timeTo} />
        )}
        {activeTab === "timeline" && (
          <Box flex="1" overflow="hidden">
            <TimelineView calls={state.calls} sessions={state.sessions}
              onSelectCall={(id) => handleSelectCall(id)} selectedCallId={selectedCallId} />
          </Box>
        )}
        {activeTab === "waterfall" && (
          <Box flex="1" overflow="hidden">
            <WaterfallChart calls={state.calls} onSelectCall={(id) => handleSelectCall(id)} selectedCallId={selectedCallId} />
          </Box>
        )}
        {selectedCall && <DetailDrawer call={selectedCall} allCalls={state.calls} onClose={() => setSelectedCallId(null)} />}
      </Flex>
    </Flex>
  );
}
