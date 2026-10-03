"use client";

import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { clampZoom, stepZoom, XLSX_ZOOM_COMMAND, XLSX_ZOOM_DEFAULT, XLSX_ZOOM_PRESETS, zoomRatioDelta } from "../view/zoom";
import type { XlsxToolbarGroupProps } from "./types";

/** View > zoom: the stepper, the presets and the reset. Zoom is session view
 *  state — the port exposes no zoom read, so the control keeps a local echo of
 *  its own changes from the renderer's 100% start; every action still goes
 *  through the allowlisted view command and nothing is persisted. */
export function XlsxViewZoomGroup({ commands }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const [percent, setPercent] = useState<number>(XLSX_ZOOM_DEFAULT);

  const apply = (next: number, reset = false) => {
    if (!commands) return;
    const clamped = clampZoom(next);
    commands.execute(XLSX_ZOOM_COMMAND, reset ? { reset: true } : { delta: zoomRatioDelta(percent, clamped) });
    setPercent(clamped);
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
