/**
 * Slide master panel edit -> engine master edit (B6 wire, UNI-927).
 *
 * The panel emits view-level `MasterPanelEdit` values (text, a px box, hex
 * colours, a pt outline width); the engine's `MasterEdit` kinds
 * (`master_edit_text` ... `master_delete_element`) carry paragraphs, flat px
 * geometry and the vendored fill / stroke patches. Pure and total: every panel
 * edit maps to exactly one engine edit, and the engine validates the result
 * (a refusal surfaces through the host's error channel like any other edit).
 */
import type { MasterEdit, MasterPartEdit } from "@uniwork/office-engine/pptx";
import { paragraphsFromText } from "../text/text-model";
import type { MasterPanelEdit } from "./masters-model";

/** EMU per point: the stroke patch's `widthEmu` unit (12700 EMU = 1pt). */
const EMU_PER_PT = 12700;

/** Outline width when the panel leaves it blank ("keep"): the engine's stroke
 *  patch needs a width, so a new outline starts at the PowerPoint default 1pt. */
const DEFAULT_STROKE_PT = 1;

export function toMasterEdit(edit: MasterPanelEdit): MasterEdit | MasterPartEdit {
  switch (edit.op) {
    case "master_edit_text":
      return { op: edit.op, part: edit.part, elementId: edit.elementId, paragraphs: paragraphsFromText(edit.text) };
    case "master_set_transform":
      return {
        op: edit.op,
        part: edit.part,
        elementId: edit.elementId,
        xPx: edit.box.x,
        yPx: edit.box.y,
        wPx: edit.box.w,
        hPx: edit.box.h,
      };
    case "master_set_fill":
      // No colour = "no fill" (the vendored setFill's "none").
      return { op: edit.op, part: edit.part, elementId: edit.elementId, fill: edit.color ?? "none" };
    case "master_set_stroke": {
      // No colour, or a zero width, removes the outline (stroke null).
      const widthPt = edit.widthPt ?? DEFAULT_STROKE_PT;
      const stroke = edit.color === null || widthPt <= 0 ? null : { color: edit.color, widthEmu: Math.max(1, Math.round(widthPt * EMU_PER_PT)) };
      return { op: edit.op, part: edit.part, elementId: edit.elementId, stroke };
    }
    case "master_delete_element":
      return { op: edit.op, part: edit.part, elementId: edit.elementId };
    case "master_rename":
      return { op: edit.op, part: edit.part, name: edit.name };
    case "master_add_placeholder":
      return { op: edit.op, part: edit.part, placeholder: edit.placeholder, xPx: edit.box.x, yPx: edit.box.y, wPx: edit.box.w, hPx: edit.box.h };
    case "master_set_text_style":
      return edit;
  }
}
