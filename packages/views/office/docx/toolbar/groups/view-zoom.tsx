"use client";

// A6-wire (UNI-924): the View tab's zoom group. W-H adds typed ribbon items:
// a zoom combo (preset stops from the zoom model), zoom in/out buttons and the
// fit-width / fit-page toggles - every one drives the same shared zoom
// controller the old DocxZoomControl used. The control is attached to the live
// surface by the chrome mount (view/docx-view-chrome.tsx), so no surface access
// is needed here.
import { Scaling, StretchHorizontal, ZoomIn, ZoomOut } from "lucide-react";
import { DocxZoomControl } from "../../view";
import { getDocxZoomController } from "../../view/zoom-controller";
import { docxZoomOptions } from "../../view/zoom-model";
import type { RibbonItem } from "../../../ribbon";
import type { DocxToolbarGroupContext } from "../types";

/** The typed ribbon items for the View > zoom group. */
export function viewZoomRibbonItems({ format }: DocxToolbarGroupContext): readonly RibbonItem[] {
  const controller = getDocxZoomController();
  const state = controller.getState();
  const disabled = !format;
  return [
    {
      kind: "combo",
      id: "view-zoom",
      labelKey: "office.docx.view.zoom.label",
      size: "large",
      collapseAs: "small",
      disabled,
      width: 92,
      value: String(state.percent),
      options: docxZoomOptions(state.percent).map((percent) => ({
        value: String(percent),
        label: `${percent}%`,
      })),
      onChange: (value) => controller.setPercent(Number(value)),
    },
    {
      kind: "button",
      id: "view-zoom-out",
      labelKey: "office.docx.view.zoom.out",
      icon: ZoomOut,
      disabled,
      onExecute: () => controller.zoomOut(),
    },
    {
      kind: "button",
      id: "view-zoom-in",
      labelKey: "office.docx.view.zoom.in",
      icon: ZoomIn,
      disabled,
      onExecute: () => controller.zoomIn(),
    },
    {
      kind: "toggle",
      id: "view-zoom-fit-width",
      labelKey: "office.docx.view.zoom.fitWidth",
      icon: StretchHorizontal,
      disabled,
      pressed: state.mode === "fit-width",
      onExecute: () => controller.fit("width"),
    },
    {
      kind: "toggle",
      id: "view-zoom-fit-page",
      labelKey: "office.docx.view.zoom.fitPage",
      icon: Scaling,
      disabled,
      pressed: state.mode === "fit-page",
      onExecute: () => controller.fit("page"),
    },
  ];
}

/** View > zoom: the typed items live on the registry entry; this component
 * stays exported for hosts that want the inline control. */
export function ViewZoomGroup({ format }: DocxToolbarGroupContext) {
  return <DocxZoomControl disabled={!format} />;
}

ViewZoomGroup.ribbonItems = viewZoomRibbonItems;
