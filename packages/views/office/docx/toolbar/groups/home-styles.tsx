"use client";

import { StylesGallery } from "../../paragraph/styles-gallery-menu";
import type { DocxToolbarGroupContext } from "../types";

/**
 * The Home tab's styles group (task A3): the Normal / Heading 1-6 / Title /
 * Quote gallery. The active entry follows the caret's block — a docHeading by
 * level, a paragraph/list item by its direct style id.
 */
export function HomeStylesGroup({ format, commands, readOnly, saving }: DocxToolbarGroupContext) {
  const blocked = readOnly || saving || !commands || !format;
  return (
    <StylesGallery
      value={format?.paragraphStyle ?? null}
      disabled={blocked}
      onPick={(style) => commands?.applyParagraphStyle(style)}
    />
  );
}
