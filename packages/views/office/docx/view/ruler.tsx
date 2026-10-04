"use client";

import { useTranslation } from "react-i18next";
import type { RendererSection } from "@uniwork/office-upstream/docs-renderer-editor";
import { cn } from "@uniwork/ui/lib/utils";
import { docxRulerIndentMarkers, docxRulerModel, type DocxRulerIndent } from "./ruler-model";

export interface DocxRulerProps {
  /** The canvas section's settings (`spec.sections[0]`); null before open. */
  settings: RendererSection["settings"] | null;
  /** Display zoom, so the ruler tracks the zoomed paper; 100 = page width. */
  zoomPercent?: number;
  /** The caret paragraph's direct indents in twips; absent = geometry only. */
  indent?: DocxRulerIndent | null;
  className?: string;
}

/** Read-only Word-style horizontal ruler: page width, margin zones, inch ticks
 *  and the current paragraph's indent markers. No drag editing in this task. */
export function DocxRuler({ settings, zoomPercent = 100, indent, className }: DocxRulerProps) {
  const { t } = useTranslation();
  const model = docxRulerModel(settings, zoomPercent);
  if (!model) return null;
  const markers = docxRulerIndentMarkers(indent, model, zoomPercent);

  return (
    <div
      role="img"
      aria-label={t("office.docx.view.ruler.label")}
      data-testid="docx-ruler"
      className={cn("relative h-4 shrink-0 select-none overflow-hidden border-b border-border bg-muted/40 text-caption", className)}
      style={{ width: `${model.widthPx}px` }}
    >
      <span
        aria-hidden="true"
        data-testid="docx-ruler-margin-left"
        className="absolute inset-y-0 bg-muted"
        style={{ left: 0, width: `${model.marginLeftPx}px` }}
      />
      <span
        aria-hidden="true"
        data-testid="docx-ruler-margin-right"
        className="absolute inset-y-0 bg-muted"
        style={{ left: `${model.widthPx - model.marginRightPx}px`, width: `${model.marginRightPx}px` }}
      />
      {model.ticks.map((tick) => (
        <span
          key={tick.inch}
          aria-hidden="true"
          className="absolute top-0 -translate-x-1/2 text-faint-foreground"
          style={{ left: `${tick.leftPx}px` }}
        >
          {tick.inch}
        </span>
      ))}
      {markers ? (
        <>
          <span
            aria-hidden="true"
            data-testid="docx-ruler-indent-left"
            className="absolute bottom-0 h-2 w-px bg-foreground"
            style={{ left: `${markers.leftPx}px` }}
          />
          {markers.firstLinePx === null ? null : (
            <span
              aria-hidden="true"
              data-testid="docx-ruler-indent-first-line"
              className="absolute bottom-0 h-1.5 w-2 -translate-x-1/2 bg-foreground"
              style={{ left: `${markers.firstLinePx}px` }}
            />
          )}
          {markers.rightPx === null ? null : (
            <span
              aria-hidden="true"
              data-testid="docx-ruler-indent-right"
              className="absolute bottom-0 h-2 w-px bg-foreground"
              style={{ left: `${markers.rightPx}px` }}
            />
          )}
        </>
      ) : null}
    </div>
  );
}
