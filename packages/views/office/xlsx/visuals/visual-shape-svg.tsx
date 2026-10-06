import type { ReactElement } from "react";
import type { XlsxVisualShape } from "@uniwork/office-engine/xlsx";

interface Props {
  shape: XlsxVisualShape;
  width: number;
  height: number;
}

function arrowPoints(w: number, h: number, right: boolean): string {
  const head = w * 0.5;
  const top = h * 0.25;
  const bottom = h * 0.75;
  const pts: [number, number][] = right
    ? [[0, top], [w - head, top], [w - head, 0], [w, h / 2], [w - head, h], [w - head, bottom], [0, bottom]]
    : [[w, top], [head, top], [head, 0], [0, h / 2], [head, h], [head, bottom], [w, bottom]];
  return pts.map(([x, y]) => `${x},${y}`).join(" ");
}

/** Preset shape filling its box; decorative, the caller names it. */
export function XlsxVisualShapeSvg({ shape, width, height }: Props): ReactElement {
  const w = Math.max(2, width);
  const h = Math.max(2, height);
  const fill = shape.fillColor ?? "var(--chart-1)";
  const common = { "data-testid": "xlsx-visual-shape", className: "stroke-border", style: { fill }, strokeWidth: 1 } as const;
  const inset = 0.5;
  let body: ReactElement;
  switch (shape.shapeType) {
    case "rect":
      body = <rect {...common} x={inset} y={inset} width={w - 1} height={h - 1} />;
      break;
    case "roundRect": {
      const rx = Math.min(w, h) * 0.16;
      body = <rect {...common} x={inset} y={inset} width={w - 1} height={h - 1} rx={rx} ry={rx} />;
      break;
    }
    case "ellipse":
      body = <ellipse {...common} cx={w / 2} cy={h / 2} rx={w / 2 - inset} ry={h / 2 - inset} />;
      break;
    case "triangle":
      body = <path {...common} d={`M${w / 2},${inset} L${w - inset},${h - inset} L${inset},${h - inset} Z`} />;
      break;
    case "rightArrow":
      body = <polygon {...common} points={arrowPoints(w, h, true)} />;
      break;
    case "leftArrow":
      body = <polygon {...common} points={arrowPoints(w, h, false)} />;
      break;
    case "line":
      body = <path data-testid="xlsx-visual-shape" className="stroke-foreground" fill="none" strokeWidth={2} d={`M1,1 L${w - 1},${h - 1}`} />;
      break;
    default:
      body = <rect {...common} x={inset} y={inset} width={w - 1} height={h - 1} />;
  }
  const fontSize = Math.min(14, Math.max(9, h / 4));
  return (
    <svg aria-hidden="true" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {body}
      {shape.text ? (
        <text x={w / 2} y={h / 2} textAnchor="middle" dominantBaseline="central" fontSize={fontSize} fill="currentColor">
          {shape.text}
        </text>
      ) : null}
    </svg>
  );
}
