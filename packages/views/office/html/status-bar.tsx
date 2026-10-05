"use client";

import { useState } from "react";
import { CircleHelp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { OfficeStatusBar, OfficeStatusZoom } from "../frame";
import {
  clampZoom,
  HTML_ZOOM_DEFAULT,
  HTML_ZOOM_MAX,
  HTML_ZOOM_MIN,
  htmlStatusFigures,
  stepZoom,
} from "./visual/shell-model";

/** The rows the HTML shortcuts sheet lists; labels reuse existing keys. */
const SHORTCUT_ROWS: readonly { id: string; labelKey: string; keys: string }[] = [
  { id: "undo", labelKey: "office.html.actions.undo", keys: "Ctrl+Z" },
  { id: "redo", labelKey: "office.html.actions.redo", keys: "Ctrl+Y" },
  { id: "save", labelKey: "office.html.actions.save", keys: "Ctrl+S" },
  { id: "mode", labelKey: "office.html.view.label", keys: "Ctrl+\\" },
];

/**
 * The HTML status row (F1/F8): one shared `OfficeStatusBar` carrying the source
 * figures on the left, the selection info and the zoom ladder on the right, and
 * the `?` help affordance last. It lives in the frame's `statusBar` slot - the
 * bar is the bottom-most row, below the assets strip - and the shell no longer
 * draws chrome of its own.
 */
export function HtmlStatusBar({
  text,
  selection = null,
  zoom,
  onZoomChange,
  zoomDisabled,
  joinedBand = false,
}: {
  text: string;
  selection?: { from: number; to: number } | null;
  zoom: number;
  onZoomChange: (percent: number) => void;
  zoomDisabled: boolean;
  joinedBand?: boolean;
}) {
  const { t } = useTranslation();
  const [helpOpen, setHelpOpen] = useState(false);
  const { length, lines, selection: activeSelection } = htmlStatusFigures(text, selection);
  const clamped = clampZoom(zoom);
  return (
    <>
      <OfficeStatusBar
        labelKey="office.html.status.label"
        // F9: when the assets strip sits directly above, the two share ONE band,
        // so the status row drops its own separator and only the strip keeps it.
        className={joinedBand ? "border-t-0" : undefined}
        start={
          <span data-testid="html-status-left">
            <span data-testid="html-status-figures" data-html-length={length} data-html-lines={lines} data-html-language="HTML">
              {t("office.html.status.figures", { length, lines, language: "HTML" })}
            </span>
          </span>
        }
        end={
          <span className="flex items-center gap-2" data-testid="html-status-right">
            <span data-testid="html-status-selection">
              {activeSelection
                ? t("office.html.status.selection", { from: activeSelection.from, to: activeSelection.to })
                : t("office.html.status.selectionNone")}
            </span>
            <span data-testid="html-zoom">
              <OfficeStatusZoom
                value={zoomDisabled ? null : clamped}
                min={HTML_ZOOM_MIN}
                max={HTML_ZOOM_MAX}
                onZoomIn={zoomDisabled ? undefined : () => onZoomChange(stepZoom(clamped, 1))}
                onZoomOut={zoomDisabled ? undefined : () => onZoomChange(stepZoom(clamped, -1))}
                onReset={zoomDisabled ? undefined : () => onZoomChange(HTML_ZOOM_DEFAULT)}
              />
            </span>
            {/*
              m2: the shared `OfficeStatusZoom` carries no live region, so a step
              is silent. The old local `html-zoom-value` announced it; mirror the
              value here instead of editing the shared frame. The region stays
              mounted and only its text changes, so every step is announced.
            */}
            <span className="sr-only" role="status" aria-live="polite" data-testid="html-zoom-live">
              {zoomDisabled ? "" : t("office.html.zoom.level", { percent: clamped })}
            </span>
          </span>
        }
        help={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t("office.html.shortcuts.title")}
            title={t("office.html.shortcuts.title")}
            aria-haspopup="dialog"
            data-testid="html-shortcuts-help-trigger"
            onClick={() => setHelpOpen(true)}
          >
            <CircleHelp aria-hidden />
          </Button>
        }
      />
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent data-testid="html-shortcuts-dialog" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("office.html.shortcuts.title")}</DialogTitle>
            <DialogDescription>{t("office.html.shortcuts.description")}</DialogDescription>
          </DialogHeader>
          <dl className="divide-y divide-border" data-testid="html-shortcuts-list">
            {SHORTCUT_ROWS.map((row) => (
              <div key={row.id} className="flex min-h-8 items-center justify-between gap-4 py-1.5">
                <dt className="text-body text-foreground">{t(row.labelKey)}</dt>
                <dd className="font-mono text-caption text-muted-foreground">{row.keys}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </>
  );
}
