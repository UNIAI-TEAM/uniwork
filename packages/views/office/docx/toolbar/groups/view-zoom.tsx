"use client";

import { DocxZoomControl } from "../../view";
import type { DocxToolbarGroupContext } from "../types";

/** A6-wire: the View tab's zoom group is the control for the shared zoom
 *  controller; the controller is attached to the live surface by the chrome
 *  mount (view/docx-view-chrome.tsx), so no surface access is needed here. */
export function ViewZoomGroup({ format }: DocxToolbarGroupContext) {
  return <DocxZoomControl disabled={!format} />;
}
