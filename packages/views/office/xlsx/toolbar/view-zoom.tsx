"use client";

import { Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { clampZoom, stepZoom, XLSX_ZOOM_DEFAULT, XLSX_ZOOM_PRESETS } from "../view/zoom";
import { useViewEcho, XLSX_ZOOM_SET_COMMAND, zoomRatioTarget } from "./view-echo";
import type { XlsxToolbarGroupProps } from "./types";

/** View > zoom: the stepper, the presets and the reset. Zoom is session view
 *  state and the port exposes no zoom read, so the control keeps an echo of
 *  its own changes; the echo is owned by the TOOLBAR (`viewEcho`) so a ribbon
 *  tab switch cannot reset it while the renderer keeps its zoom. Every action
 *  sends the ABSOLUTE `set-zoom-ratio` target, so the applied zoom is correct
 *  even if the echo is ever stale; nothing is persisted. */
export function XlsxViewZoomGroup({ commands, viewEcho }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const echo = useViewEcho(viewEcho);
  const percent = echo.zoomPercent;

  const apply = (next: number, reset = false) => {
    if (!commands) return;
    const clamped = clampZoom(next);
    if (reset) void commands.execute(XLSX_ZOOM_SET_COMMAND, zoomRatioTarget(XLSX_ZOOM_DEFAULT));
    else void commands.execute(XLSX_ZOOM_SET_COMMAND, zoomRatioTarget(clamped));
    echo.setZoomPercent(clamped);
  };
  const blocked = !commands || undefined;

  return (
    <>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.xlsx.view.zoom.out")}
        aria-disabled={blocked}
        onClick={() => apply(stepZoom(percent, -1))}
      >
        <Minus aria-hidden />
      </Button>
      <span className="min-w-9 text-center text-caption tabular-nums" data-testid="xlsx-view-zoom-value">
        {t("office.xlsx.view.zoom.value", { percent })}
      </span>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.xlsx.view.zoom.in")}
        aria-disabled={blocked}
        onClick={() => apply(stepZoom(percent, 1))}
      >
        <Plus aria-hidden />
      </Button>
      {XLSX_ZOOM_PRESETS.map((preset) => (
        <Button
          key={preset}
          type="button"
          variant="toolbar"
          size="sm"
          aria-label={t("office.xlsx.view.zoom.preset", { percent: preset })}
          aria-pressed={percent === preset}
          aria-disabled={blocked}
          onClick={() => apply(preset)}
        >
          {t("office.xlsx.view.zoom.presetShort", { percent: preset })}
        </Button>
      ))}
      <Button
        type="button"
        variant="toolbar"
        size="sm"
        aria-disabled={blocked}
        onClick={() => apply(XLSX_ZOOM_DEFAULT, true)}
      >
        {t("office.xlsx.view.zoom.reset")}
      </Button>
    </>
  );
}