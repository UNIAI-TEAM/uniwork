import type { ReactElement } from "react";
import type { XlsxVisualChart } from "@uniwork/office-engine/xlsx";

interface Props {
  chart: XlsxVisualChart;
  width: number;
  height: number;
  label: string;
}

const TEXT = "fill-muted-foreground";

const colour = (index: number): string => `var(--chart-${(index % 5) + 1})`;

function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, Math.max(1, max - 1)).join("")}…`;
}

function formatTick(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${+(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${+(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${+(value / 1e3).toFixed(1)}K`;
  return String(+value.toFixed(2));
}

function point(cx: number, cy: number, r: number, angle: number): [number, number] {
  return [cx + r * Math.sin(angle), cy - r * Math.cos(angle)];
}

function slicePath(cx: number, cy: number, outer: number, inner: number, from: number, to: number): string {
  const end = Math.min(to, from + Math.PI * 2 - 0.0001);
  const large = end - from > Math.PI ? 1 : 0;
  const [x0, y0] = point(cx, cy, outer, from);
  const [x1, y1] = point(cx, cy, outer, end);
  if (inner <= 0) return `M${cx},${cy} L${x0},${y0} A${outer},${outer} 0 ${large} 1 ${x1},${y1} Z`;
  const [x2, y2] = point(cx, cy, inner, end);
  const [x3, y3] = point(cx, cy, inner, from);
  return `M${x0},${y0} A${outer},${outer} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${inner},${inner} 0 ${large} 0 ${x3},${y3} Z`;
}

interface LegendEntry {
  name: string;
  index: number;
}

function Legend({ entries, x, y, width, size }: { entries: LegendEntry[]; x: number; y: number; width: number; size: number }): ReactElement {
  const slot = Math.max(40, width / Math.max(1, entries.length));
  const chars = Math.max(3, Math.floor((slot - size - 6) / (size * 0.6)));
  return (
    <g data-testid="xlsx-visual-legend">
      {entries.map((entry, i) => (
        <g key={entry.index} transform={`translate(${x + i * slot},${y})`}>
          <rect width={size} height={size} y={-size + 2} style={{ fill: colour(entry.index) }} />
          <text x={size + 4} fontSize={size} className={TEXT} fill="currentColor">
            {truncate(entry.name, chars)}
          </text>
        </g>
      ))}
    </g>
  );
}

function PieChart({ chart, w, h, top, bottom, size }: { chart: XlsxVisualChart; w: number; h: number; top: number; bottom: number; size: number }): ReactElement {
  const series = chart.series[0];
  const values = (series?.values ?? []).map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = values.reduce((a, b) => a + b, 0);
  const cx = w / 2;
  const cy = (top + h - bottom) / 2;
  const outer = Math.max(4, Math.min(w, h - top - bottom) / 2 - 4);
  const inner = chart.chartType === "doughnut" ? outer * 0.55 : 0;
  let angle = 0;
  const slices: ReactElement[] = [];
  values.forEach((value, i) => {
    if (value <= 0 || total <= 0) return;
    const sweep = (value / total) * Math.PI * 2;
    slices.push(
      <path key={i} data-testid="xlsx-visual-slice" d={slicePath(cx, cy, outer, inner, angle, angle + sweep)} style={{ fill: colour(i) }} className="stroke-background" strokeWidth={1} />,
    );
    angle += sweep;
  });
  const legend = values.map((_, i) => ({ name: series?.categories[i] ?? String(i + 1), index: i }));
  return (
    <>
      {slices}
      <Legend entries={legend.slice(0, 8)} x={8} y={h - 6} width={w - 16} size={size} />
    </>
  );
}

function AxisChart({ chart, w, h, top, bottom, size }: { chart: XlsxVisualChart; w: number; h: number; top: number; bottom: number; size: number }): ReactElement {
  const horizontal = chart.chartType === "bar";
  const all = chart.series.flatMap((s) => s.values.filter((v) => Number.isFinite(v)));
  const min = Math.min(0, ...all);
  const max = Math.max(0, ...all) === min ? min + 1 : Math.max(0, ...all);
  const left = horizontal ? 8 + size * 5 : 8 + size * 3.2;
  const plotX = left;
  const plotY = top + 4;
  const plotW = Math.max(10, w - left - 10);
  const plotH = Math.max(10, h - plotY - bottom - size - 16);
  const count = Math.max(1, ...chart.series.map((s) => s.values.length));
  const categories = chart.series[0]?.categories ?? [];
  const ticks = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4);
  const valueSpan = horizontal ? plotW : plotH;
  const scale = (v: number): number => ((v - min) / (max - min)) * valueSpan;
  const band = (horizontal ? plotH : plotW) / count;
  const zero = scale(0);
  const seriesCount = Math.max(1, chart.series.length);
  const barSize = Math.max(1, (band * 0.7) / seriesCount);

  const gridLines = ticks.map((t, i) => {
    const p = scale(t);
    const pos = horizontal ? plotX + p : plotY + plotH - p;
    return (
      <g key={i}>
        {horizontal ? (
          <line x1={pos} x2={pos} y1={plotY} y2={plotY + plotH} className="stroke-border" strokeWidth={0.5} />
        ) : (
          <line x1={plotX} x2={plotX + plotW} y1={pos} y2={pos} className="stroke-border" strokeWidth={0.5} />
        )}
        <text
          x={horizontal ? pos : plotX - 4}
          y={horizontal ? plotY + plotH + size + 2 : pos + size / 3}
          textAnchor={horizontal ? "middle" : "end"}
          fontSize={size}
          className={TEXT}
          fill="currentColor"
        >
          {formatTick(t)}
        </text>
      </g>
    );
  });

  const maxChars = horizontal ? Math.floor((left - 10) / (size * 0.6)) : Math.max(2, Math.floor(band / (size * 0.6)));
  const labels = Array.from({ length: count }, (_, i) => {
    const text = truncate(categories[i] ?? String(i + 1), maxChars);
    const mid = i * band + band / 2;
    if (count > 24 && i % Math.ceil(count / 24) !== 0) return null;
    return horizontal ? (
      <text key={i} x={plotX - 4} y={plotY + mid + size / 3} textAnchor="end" fontSize={size} className={TEXT} fill="currentColor">
        {text}
      </text>
    ) : (
      <text key={i} x={plotX + mid} y={plotY + plotH + size + 12} textAnchor="middle" fontSize={size} className={TEXT} fill="currentColor">
        {text}
      </text>
    );
  });

  const marks: ReactElement[] = [];
  chart.series.forEach((series, si) => {
    const fill = colour(si);
    if (chart.chartType === "column" || horizontal) {
      series.values.forEach((value, i) => {
        const v = Number.isFinite(value) ? value : 0;
        const len = Math.abs(scale(v) - zero);
        const start = i * band + band * 0.15 + si * barSize;
        const rect = horizontal
          ? { x: plotX + Math.min(scale(v), zero), y: plotY + start, width: len, height: barSize }
          : { x: plotX + start, y: plotY + plotH - Math.max(scale(v), zero), width: barSize, height: len };
        marks.push(<rect key={`${si}-${i}`} data-testid="xlsx-visual-bar" {...rect} style={{ fill }} />);
      });
      return;
    }
    const pts = series.values.map((value, i): [number, number] => [plotX + i * band + band / 2, plotY + plotH - scale(Number.isFinite(value) ? value : 0)]);
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (!first || !last) return;
    const line = pts.map(([x, y]) => `${x},${y}`).join(" ");
    if (chart.chartType === "area") {
      const base = plotY + plotH - zero;
      marks.push(<polygon key={`a-${si}`} points={`${first[0]},${base} ${line} ${last[0]},${base}`} style={{ fill, opacity: 0.4 }} />);
    }
    marks.push(<polyline key={`l-${si}`} points={line} fill="none" style={{ stroke: fill }} strokeWidth={2} />);
    pts.forEach(([x, y], i) => marks.push(<circle key={`p-${si}-${i}`} data-testid="xlsx-visual-point" cx={x} cy={y} r={2.5} style={{ fill }} />));
  });

  const baseline = horizontal ? (
    <line x1={plotX + zero} x2={plotX + zero} y1={plotY} y2={plotY + plotH} className="stroke-foreground" strokeWidth={1} />
  ) : (
    <line x1={plotX} x2={plotX + plotW} y1={plotY + plotH - zero} y2={plotY + plotH - zero} className="stroke-foreground" strokeWidth={1} />
  );

  const legend = chart.series.length >= 2 ? chart.series.map((s, i) => ({ name: s.name || String(i + 1), index: i })) : [];
  return (
    <>
      {gridLines}
      {marks}
      {baseline}
      {labels}
      {legend.length > 0 ? <Legend entries={legend.slice(0, 8)} x={8} y={h - 6} width={w - 16} size={size} /> : null}
    </>
  );
}

/** Pure SVG rendering of a chart definition; transparent background. */
export function XlsxVisualChartSvg({ chart, width, height, label }: Props): ReactElement {
  const w = Math.max(40, width);
  const h = Math.max(40, height);
  const size = Math.min(13, Math.max(9, Math.round(h / 22)));
  const top = chart.title ? size + 14 : 4;
  const isPie = chart.chartType === "pie" || chart.chartType === "doughnut";
  const hasLegend = isPie || chart.series.length >= 2;
  const bottom = hasLegend ? size + 10 : 4;
  return (
    <svg role="img" aria-label={label} width={w} height={h} viewBox={`0 0 ${w} ${h}`} fontFamily="inherit">
      {chart.title ? (
        <text x={w / 2} y={size + 4} textAnchor="middle" fontSize={size + 2} fontWeight={600} className="fill-foreground">
          {truncate(chart.title, Math.floor(w / ((size + 2) * 0.6)))}
        </text>
      ) : null}
      {isPie ? (
        <PieChart chart={chart} w={w} h={h} top={top} bottom={bottom} size={size} />
      ) : (
        <AxisChart chart={chart} w={w} h={h} top={top} bottom={bottom} size={size} />
      )}
    </svg>
  );
}
