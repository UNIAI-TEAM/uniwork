"use client";

import { Highlighter, Minus, Underline } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { PdfEditOperation, PdfMarkupType, PdfTextMarkupSelection } from "../types";

export interface PdfTextMarkupToolsProps {
  selection: PdfTextMarkupSelection | null;
  disabled?: boolean;
  onMarkup: (operation: Extract<PdfEditOperation, { op: "add_markup" }>) => void;
}

const MARKUP_COLORS: Record<PdfMarkupType, [number, number, number]> = {
  highlight: [1, 0.85, 0],
  underline: [0, 0, 0],
  strikeout: [0, 0, 0],
};

const MARKUP_ICONS = {
  highlight: Highlighter,
  underline: Underline,
  strikeout: Minus,
} as const;

/** Text-only PDF markups. Geometry remains owned by the canvas/host selection
 * contract; this component only emits a typed operation. */
export function PdfTextMarkupTools({ selection, disabled = false, onMarkup }: PdfTextMarkupToolsProps) {
  const { t } = useTranslation();
  const blocked = disabled || selection === null;
  const apply = (type: PdfMarkupType) => {
    if (!selection) return;
    onMarkup({ op: "add_markup", target: selection, type, color: MARKUP_COLORS[type] });
  };

  return (
    <div className="flex flex-wrap items-center gap-1" data-testid="pdf-text-markup-tools" aria-label={t("office.pdf.markups.label")} role="group">
      {(Object.keys(MARKUP_ICONS) as PdfMarkupType[]).map((type) => {
        const Icon = MARKUP_ICONS[type];
        const label = t(`office.pdf.markups.${type}`);
        // Icon plus visible name: an icon-only row in a side panel says nothing
        // about which button is which until it is hovered.
        return <Button key={type} type="button" variant="outline" size="sm" className="whitespace-nowrap" disabled={blocked} onClick={() => apply(type)}><Icon aria-hidden />{label}</Button>;
      })}
    </div>
  );
}
