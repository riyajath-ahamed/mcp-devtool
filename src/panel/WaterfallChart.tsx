/**
 * WaterfallChart — D3.js powered network waterfall showing tool call timing.
 *
 * All colors are sourced from ThemeTokens — no hardcoded color literals.
 */

import React, { useRef, useEffect, useMemo } from "react";
import * as d3 from "d3";
import { Box } from "@chakra-ui/react";
import type { ToolCallRecord } from "../core/types.js";
import { EmptyState, formatLatency } from "./shared.jsx";
import { useTheme, getStatusHex } from "./theme.jsx";

interface WaterfallChartProps {
  calls: ToolCallRecord[];
  onSelectCall: (callId: string) => void;
  selectedCallId: string | null;
}

const ROW_HEIGHT = 28;
const LABEL_WIDTH = 140;
const PADDING = { top: 30, right: 16, bottom: 16, left: LABEL_WIDTH + 8 };

export function WaterfallChart({ calls, onSelectCall, selectedCallId }: WaterfallChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { tokens: t } = useTheme();

  const sortedCalls = useMemo(
    () => [...calls].sort((a, b) => a.startedAt - b.startedAt),
    [calls],
  );

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || sortedCalls.length === 0) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const chartHeight = sortedCalls.length * ROW_HEIGHT;
    const height = chartHeight + PADDING.top + PADDING.bottom;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);

    const minTime = d3.min(sortedCalls, (d) => d.startedAt) ?? 0;
    const maxTime = d3.max(sortedCalls, (d) => d.endedAt ?? d.startedAt + 100) ?? minTime + 1000;

    const xScale = d3.scaleLinear().domain([0, maxTime - minTime]).range([PADDING.left, width - PADDING.right]);
    const yScale = d3.scaleBand<number>().domain(sortedCalls.map((_, i) => i)).range([PADDING.top, PADDING.top + chartHeight]).padding(0.25);

    // Background
    svg.append("rect").attr("width", width).attr("height", height).attr("fill", t.waterfallBg);

    // Grid
    const ticks = xScale.ticks(8);
    ticks.forEach((tick) => {
      svg.append("line").attr("x1", xScale(tick)).attr("x2", xScale(tick))
        .attr("y1", PADDING.top).attr("y2", PADDING.top + chartHeight)
        .attr("stroke", t.waterfallGrid).attr("stroke-dasharray", "2,3");
      svg.append("text").attr("x", xScale(tick)).attr("y", PADDING.top - 8)
        .attr("text-anchor", "middle").attr("fill", t.waterfallAxisText)
        .attr("font-size", "10px").attr("font-family", "monospace")
        .text(tick < 1000 ? `${Math.round(tick)}ms` : `${(tick / 1000).toFixed(1)}s`);
    });

    // Rows
    const rows = svg.append("g").selectAll("g.row").data(sortedCalls).join("g")
      .attr("class", "row").attr("transform", (_, i) => `translate(0, ${yScale(i)})`);

    // Labels
    rows.append("text").attr("x", PADDING.left - 8).attr("y", yScale.bandwidth() / 2)
      .attr("dy", "0.35em").attr("text-anchor", "end")
      .attr("fill", (d) => d.id === selectedCallId ? t.waterfallLabelSelected : t.waterfallLabel)
      .attr("font-size", "11px").attr("font-family", "monospace")
      .text((d) => d.toolName.length > 18 ? d.toolName.slice(0, 17) + "\u2026" : d.toolName);

    // Selected bg
    rows.append("rect").attr("x", PADDING.left).attr("y", 0)
      .attr("width", width - PADDING.left - PADDING.right).attr("height", yScale.bandwidth())
      .attr("fill", (d) => d.id === selectedCallId ? t.waterfallSelectedBg : "transparent").attr("rx", 3);

    // Timing bar
    rows.append("rect")
      .attr("x", (d) => xScale(d.startedAt - minTime)).attr("y", 2)
      .attr("width", (d) => { const end = d.endedAt ?? d.startedAt + 100; return Math.max(3, xScale(end - minTime) - xScale(d.startedAt - minTime)); })
      .attr("height", yScale.bandwidth() - 4)
      .attr("fill", (d) => getStatusHex(d.status, t))
      .attr("opacity", (d) => d.status === "pending" ? 0.5 : 0.8).attr("rx", 3)
      .attr("cursor", "pointer").on("click", (_, d) => onSelectCall(d.id));

    // Latency text
    rows.append("text")
      .attr("x", (d) => { const end = d.endedAt ?? d.startedAt + 100; return xScale(end - minTime) + 6; })
      .attr("y", yScale.bandwidth() / 2).attr("dy", "0.35em")
      .attr("fill", t.waterfallLabel).attr("font-size", "10px").attr("font-family", "monospace")
      .text((d) => d.latencyMs !== undefined ? formatLatency(d.latencyMs) : "\u2026");

    rows.style("cursor", "pointer").on("click", (_, d) => onSelectCall(d.id));
    rows.on("mouseenter", function () { d3.select(this).select("rect:nth-child(2)").attr("fill", t.waterfallHoverBg); })
      .on("mouseleave", function (_, d) { d3.select(this).select("rect:nth-child(2)").attr("fill", d.id === selectedCallId ? t.waterfallSelectedBg : "transparent"); });
  }, [sortedCalls, selectedCallId, onSelectCall, t]);

  if (sortedCalls.length === 0) return <EmptyState message="No tool calls to visualize" />;

  return (
    <Box ref={containerRef} w="100%" h="100%" overflow="auto" bg={t.waterfallBg}>
      <svg ref={svgRef} style={{ display: "block", minWidth: "100%" }} />
    </Box>
  );
}
