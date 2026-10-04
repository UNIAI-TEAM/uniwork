"use client";

import { getI18n } from "react-i18next";
import type { RibbonItem } from "../../../ribbon";
import { DOCX_STYLES_GALLERY, type DocxGalleryStyleId } from "../../paragraph/styles-gallery";
import { StylesGallery } from "../../paragraph/styles-gallery-menu";
import type { DocxToolbarGroupContext } from "../types";

/**
 * Card width in px: wide enough for "Heading 1" .. "Heading 6" (and their
 * translations) on one line, so the six cards are distinguishable instead of
 * all reading "Head...". The ribbon measures the real row and corrects its own
 * width estimate, and the collapsed group's panel wraps the same cards.
 */
const STYLE_CARD_WIDTH = 96;

/**
 * The gallery card is a single truncated line, so the dropdown's display-size
 * preview class would clip the name to "Head...". The card renders the name at
 * the caption token size (keeping the entry's weight/italic voice) instead, so
 * every card stays identifiable.
 */
const CARD_TEXT_STYLE = {
  fontSize: "var(--text-caption)",
  lineHeight: "var(--text-caption--line-height)",
} as const;

/**
 * The Home tab's styles group (task A3): the Normal / Heading 1-6 / Title /
 * Quote gallery. The active entry follows the caret's block - a docHeading by
 * level, a paragraph/list item by its direct style id.
 */
function HomeStylesGroupView({ format, commands, readOnly, saving }: DocxToolbarGroupContext) {
  const blocked = readOnly || saving || !commands || !format;
  return (
    <StylesGallery
      value={format?.paragraphStyle ?? null}
      disabled={blocked}
      onPick={(style) => commands?.applyParagraphStyle(style)}
    />
  );
}

/**
 * Typed ribbon items for the styles group (R7): the fixed Word gallery as a
 * `gallery` item - one card per style, the caret's style marked selected, and
 * any card beyond the visible count reachable through the ribbon's own "More"
 * menu. The card labels are translated here (rather than through the item's
 * `labelKey`) because the heading entries carry a `{{level}}` variable the
 * ribbon's option label does not interpolate.
 */
export function homeStylesRibbonItems({ format, commands, readOnly, saving }: DocxToolbarGroupContext): readonly RibbonItem[] {
  const { t } = getI18n();
  const blocked = readOnly || saving || !commands || !format;
  return [
    {
      kind: "gallery",
      id: "docx-styles-gallery",
      labelKey: "office.docx.styles.gallery",
      size: "large",
      disabled: blocked,
      selectedId: format?.paragraphStyle ?? null,
      cardWidth: STYLE_CARD_WIDTH,
      maxVisible: 4,
      minVisible: 1,
      options: DOCX_STYLES_GALLERY.map((entry) => {
        const label = t(entry.labelKey, entry.level ? { level: String(entry.level) } : undefined);
        return {
          id: entry.id,
          label,
          // The full name as a tooltip too, so a long translation can still be read.
          preview: (
            <span className={entry.previewClass} style={CARD_TEXT_STYLE} title={label}>
              {label}
            </span>
          ),
        };
      }),
      onSelect: (id) => commands?.applyParagraphStyle(id as DocxGalleryStyleId),
    },
  ];
}

/** Home > Styles: the typed items live on the registry entry; this component
 * stays exported for hosts that want the inline control. */
export const HomeStylesGroup = Object.assign(HomeStylesGroupView, {
  ribbonItems: homeStylesRibbonItems,
});
