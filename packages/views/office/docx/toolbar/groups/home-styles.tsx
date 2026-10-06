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
 * The display-size preview class of the dropdown would overflow a 96px card,
 * so the specimen renders at the body token size and keeps only the entry's
 * weight/italic voice; the card shows the full name underneath (UNI-933).
 */
const CARD_TEXT_STYLE = {
  fontSize: "var(--text-body)",
  lineHeight: "var(--text-body--line-height)",
} as const;

/** Word's specimen text on every style card (not UI copy); the card's name
 * renders under it, so the specimen carries only the style's voice. */
const STYLE_SPECIMEN = "AaBbCcDd";

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
          // The specimen in the style's voice; the name is the card's caption.
          preview: (
            <span className={entry.previewClass} style={CARD_TEXT_STYLE} title={label}>
              {STYLE_SPECIMEN}
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
