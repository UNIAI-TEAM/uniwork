"use client";

import { getI18n } from "react-i18next";
import type { RibbonItem } from "../../../ribbon";
import { DOCX_STYLES_GALLERY, type DocxGalleryStyleId } from "../../paragraph/styles-gallery";
import { StylesGallery } from "../../paragraph/styles-gallery-menu";
import type { DocxToolbarGroupContext } from "../types";

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
      options: DOCX_STYLES_GALLERY.map((entry) => ({
        id: entry.id,
        label: t(entry.labelKey, entry.level ? { level: String(entry.level) } : undefined),
        preview: (
          <span className={entry.previewClass}>{t(entry.labelKey, entry.level ? { level: String(entry.level) } : undefined)}</span>
        ),
      })),
      onSelect: (id) => commands?.applyParagraphStyle(id as DocxGalleryStyleId),
    },
  ];
}

/** Home > Styles: the typed items live on the registry entry; this component
 * stays exported for hosts that want the inline control. */
export const HomeStylesGroup = Object.assign(HomeStylesGroupView, {
  ribbonItems: homeStylesRibbonItems,
});
