/**
 * Default look of what the insert panel puts on a slide (UNI-927 F-04): the
 * styled closed shape and the text box that carries visible placeholder copy.
 * Split from insert-model.ts to keep that file under the line cap.
 */
import type { PptxEdit } from "@uniwork/office-engine/pptx";
import { addElementEdit, defaultInsertBox, PPTX_INSERT_LINE_PRSTS, PPTX_INSERT_TEXT_BOX_KIND } from "./insert-model";

type AddElementEdit = Extract<PptxEdit, { op: "add_element" }>;

/**
 * The default look of an inserted closed shape: PowerPoint's Office-theme
 * `accent1` fill and its darker outline. Without a fill the vendored
 * `addElement` writes neither `a:solidFill` nor `a:ln`, so the shape renders
 * as an invisible frame. The engine converts `widthPt` to the vendored op's
 * EMU width. Lines keep the vendored black connector stroke and no fill.
 */
const PPTX_INSERT_DEFAULT_FILL = "#4472C4";
const PPTX_INSERT_DEFAULT_OUTLINE = { color: "#2F528F", widthPt: 1 } as const;

/** An inserted gallery shape with a visible default style. */
export function insertShapeEdit(slideIndex: number, prst: string): AddElementEdit {
  const box = defaultInsertBox(prst);
  return PPTX_INSERT_LINE_PRSTS.includes(prst)
    ? addElementEdit(slideIndex, prst, box)
    : addElementEdit(slideIndex, prst, box, { fillColor: PPTX_INSERT_DEFAULT_FILL, stroke: { ...PPTX_INSERT_DEFAULT_OUTLINE } });
}

/**
 * An inserted text box carrying its placeholder copy so the new frame is
 * visible. The placeholder is real paragraph text saved into the deck (the
 * engine has no render-time-only guide): the user selects it and types over it.
 */
export function insertTextBoxEdit(slideIndex: number, placeholder: string): AddElementEdit {
  const text = placeholder.trim();
  const box = defaultInsertBox(PPTX_INSERT_TEXT_BOX_KIND);
  return text
    ? addElementEdit(slideIndex, PPTX_INSERT_TEXT_BOX_KIND, box, { paragraphs: [{ runs: [{ text }] }] })
    : addElementEdit(slideIndex, PPTX_INSERT_TEXT_BOX_KIND, box);
}
