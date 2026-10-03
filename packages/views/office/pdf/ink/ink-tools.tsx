"use client";

import { Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { PdfEditOperation } from "../types";

export interface PdfInkToolsProps {
  page: number;
  points: readonly { x: number; y: number }[];
  disabled?: boolean;
  color?: [number, number, number];
  width?: number;
  onInk: (operation: Extract<PdfEditOperation, { op: "add_drawing" }>) => void;
}

export function PdfInkTools({ page, points, disabled = false, color = [0, 0, 0], width = 2, onInk }: PdfInkToolsProps) {
  const { t } = useTranslation();
  return <Button type="button" variant="toolbar" size="icon-sm" data-testid="pdf-ink-tools" disabled={disabled || points.length < 2} aria-label={t("office.pdf.ink.draw", { defaultValue: "Draw" })} onClick={() => { if (points.length >= 2) onInk({ op: "add_drawing", target: { page, geometry: { points: points.map((point) => ({ ...point })) } }, kind: "ink", color, width }); }}><Pencil aria-hidden /></Button>;
}
