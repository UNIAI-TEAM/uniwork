"use client";

import { Circle, MoveDiagonal, Minus, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { PdfDrawingType, PdfEditOperation } from "../types";

export interface PdfDrawingToolsProps {
  page: number;
  rect: [number, number, number, number] | null;
  disabled?: boolean;
  color?: [number, number, number];
  width?: number;
  fill?: [number, number, number];
  onDrawing: (operation: Extract<PdfEditOperation, { op: "add_drawing" }>) => void;
}

const ICONS = { rect: Square, ellipse: Circle, line: Minus, arrow: MoveDiagonal } as const;

export function PdfDrawingTools({ page, rect, disabled = false, color = [0, 0, 0], width = 1, fill, onDrawing }: PdfDrawingToolsProps) {
  const { t } = useTranslation();
  const blocked = disabled || rect === null;
  const apply = (type: PdfDrawingType) => {
    if (!rect) return;
    const geometry = type === "line" || type === "arrow"
      ? { start: { x: rect[0], y: rect[1] }, end: { x: rect[2], y: rect[3] } }
      : { rect: { x: rect[0], y: rect[1], width: rect[2] - rect[0], height: rect[3] - rect[1] } };
    onDrawing({ op: "add_drawing", target: { page, geometry }, kind: type, color, width, ...(fill ? { fill } : {}) });
  };
  return <div className="flex items-center gap-1" data-testid="pdf-drawing-tools" aria-label={t("office.pdf.drawings.label")} role="group">
    {(Object.keys(ICONS) as PdfDrawingType[]).map((type) => { const Icon = ICONS[type]; return <Button key={type} type="button" variant="toolbar" size="icon-sm" disabled={blocked} aria-label={t(`office.pdf.drawings.${type}`)} onClick={() => apply(type)}><Icon aria-hidden /></Button>; })}
  </div>;
}
