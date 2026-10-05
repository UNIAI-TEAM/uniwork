"use client";

/**
 * Zoom / fit controls for the slide canvas. Zoom is relative to fit width (100% = the slide
 * fills the canvas), which is the same scale the render tree is built at, so the readout
 * never lies about what "fit" means after a container resize.
 *
 * `showFit={false}` is the compact form the status bar mounts (C10: just "- value +").
 */
import { Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { stepZoom, zoomPercent } from "./zoom";

export interface PptxCanvasZoomProps {
  zoom: number;
  onZoomChange: (zoom: number) => void;
  /** Show the "fit to width" control; the status bar hides it (C10). */
  showFit?: boolean;
  className?: string;
}

export function PptxCanvasZoom({ zoom, onZoomChange, showFit = true, className }: PptxCanvasZoomProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const percent = zoomPercent(zoom);
  return (
    <div className={cn("flex items-center gap-0.5", className)} role="group" aria-label={t("zoom_controls_label")} data-pptx-zoom>
      <Button type="button" size="icon-sm" variant="ghost" aria-label={t("zoom_out")} data-pptx-zoom-out onClick={() => onZoomChange(stepZoom(zoom, -1))}>
        <Minus aria-hidden="true" className="size-4" />
      </Button>
      <span className="min-w-12 text-center text-caption tabular-nums text-muted-foreground" data-pptx-zoom-level aria-live="polite">
        {t("zoom_level", { percent })}
      </span>
      <Button type="button" size="icon-sm" variant="ghost" aria-label={t("zoom_in")} data-pptx-zoom-in onClick={() => onZoomChange(stepZoom(zoom, 1))}>
        <Plus aria-hidden="true" className="size-4" />
      </Button>
      {showFit ? (
        <Button type="button" size="sm" variant="ghost" aria-label={t("zoom_fit")} data-pptx-zoom-fit onClick={() => onZoomChange(1)}>
          {t("zoom_fit")}
        </Button>
      ) : null}
    </div>
  );
}
