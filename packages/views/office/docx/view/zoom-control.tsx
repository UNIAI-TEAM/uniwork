"use client";

import { Scaling, StretchHorizontal, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Select } from "@uniwork/ui/components/ui/select";
import { cn } from "@uniwork/ui/lib/utils";
import { getDocxZoomController, type DocxZoomController } from "./zoom-controller";
import { docxZoomOptions, type DocxZoomState } from "./zoom-model";

export interface DocxZoomControlProps {
  /** The shared controller; defaults to the DOCX view's singleton, so the
   *  toolbar group (which only receives DocxToolbarGroupContext) can render
   *  the control without a controller threaded through the shell. */
  controller?: DocxZoomController;
  /** No document open / not ready: the controls stay visible but inert. */
  disabled?: boolean;
  className?: string;
}

function useDocxZoomState(controller: DocxZoomController): DocxZoomState {
  const [state, setState] = useState(() => controller.getState());
  useEffect(() => {
    setState(controller.getState());
    return controller.subscribe(setState);
  }, [controller]);
  return state;
}

/** View ▸ Zoom: step buttons, the preset picker and the two fit modes. Every
 *  action goes through the shared controller, which owns the surface. */
export function DocxZoomControl({ controller, disabled = false, className }: DocxZoomControlProps) {
  const { t } = useTranslation();
  const resolved = controller ?? getDocxZoomController();
  const state = useDocxZoomState(resolved);
  const percentLabel = (percent: number) => t("office.docx.view.zoom.percent", { percent: String(percent) });

  return (
    <div className={cn("flex items-center gap-1", className)} data-testid="docx-zoom-control">
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.docx.view.zoom.out")}
        disabled={disabled}
        onClick={() => resolved.zoomOut()}
      >
        <ZoomOut aria-hidden />
      </Button>
      <Select
        aria-label={t("office.docx.view.zoom.label")}
        triggerVariant="subtle"
        value={String(state.percent)}
        disabled={disabled}
        onValueChange={(value) => resolved.setPercent(Number(value))}
        items={docxZoomOptions(state.percent).map((percent) => ({ value: String(percent), label: percentLabel(percent) }))}
      />
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.docx.view.zoom.in")}
        disabled={disabled}
        onClick={() => resolved.zoomIn()}
      >
        <ZoomIn aria-hidden />
      </Button>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.docx.view.zoom.fitWidth")}
        aria-pressed={state.mode === "fit-width"}
        disabled={disabled}
        onClick={() => resolved.fit("width")}
      >
        <StretchHorizontal aria-hidden />
      </Button>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.docx.view.zoom.fitPage")}
        aria-pressed={state.mode === "fit-page"}
        disabled={disabled}
        onClick={() => resolved.fit("page")}
      >
        <Scaling aria-hidden />
      </Button>
    </div>
  );
}
