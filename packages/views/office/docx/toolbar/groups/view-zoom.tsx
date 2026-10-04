"use client";

// A6-wire (UNI-924): the View tab's zoom group. W-H typed the items but they
// snapshotted `controller.getState()` at build time, so the combo showed the
// previous percent (F6). The zoom control is therefore mounted as a `custom`
// item whose component subscribes to the shared controller, so the shown value
// and the fit toggles always track the live zoom.
import { DocxZoomControl } from "../../view";
import type { RibbonItem } from "../../../ribbon";
import type { DocxToolbarGroupContext } from "../types";

/** View > zoom: a single live custom item; `DocxZoomControl` subscribes to the
 * shared zoom controller, so the combo reflects the CURRENT zoom after a pick. */
export function viewZoomRibbonItems({ format }: DocxToolbarGroupContext): readonly RibbonItem[] {
  return [
    {
      kind: "custom",
      id: "view-zoom",
      labelKey: "office.docx.view.zoom.label",
      width: 210,
      render: () => <DocxZoomControl disabled={!format} />,
    },
  ];
}

/** View > zoom: the live control (kept exported for direct use). */
export function ViewZoomGroup({ format }: DocxToolbarGroupContext) {
  return <DocxZoomControl disabled={!format} />;
}
