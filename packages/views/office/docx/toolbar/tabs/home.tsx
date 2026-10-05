import { HomeClipboardGroup, homeClipboardRibbonItems } from "../groups/home-clipboard";
import { HomeFontGroup, homeFontRibbonItems } from "../groups/home-font";
import { HomeParagraphGroup } from "../groups/home-paragraph";
import { HomeStylesGroup } from "../groups/home-styles";
import type { RibbonItem } from "../../../ribbon";
import type { DocxToolbarGroup, DocxToolbarTab, DocxToolbarGroupContext } from "../types";

/**
 * The Home tab in Word's order (C8): Clipboard (paste, cut, copy) | Font
 * (family, size, B I U S x2 x2, colour, highlight, case, clear, painter) |
 * Paragraph (lists, indent, align, spacing) | Styles. Each control appears once per tab (C7): the old
 * "Formatting" group that duplicated B/I/U and the heading/bullet/numbered
 * toggles is gone - the trio lives in the Font group and the list controls in
 * the Paragraph group.
 *
 * The Clipboard and Font groups declare typed `ribbonItems`, so the shared
 * ribbon renders real large/small/icon items for them (R7); a group that does
 * not declare them keeps the single custom-item mount. The registry also reads
 * a `ribbonItems` static off a group component, so a group task can migrate
 * without editing this file.
 *
 * Find is not a group here: it renders at the far right of the ribbon tab row
 * (C6), so the shell's tab row owns it.
 */
type TypedGroupComponent = DocxToolbarGroup["component"] & {
  ribbonItems?: (context: DocxToolbarGroupContext) => readonly RibbonItem[];
};

/** Prefer the registry's own `ribbonItems`; fall back to the component static. */
function typed(group: DocxToolbarGroup): DocxToolbarGroup {
  return group.ribbonItems ? group : { ...group, ribbonItems: (group.component as TypedGroupComponent).ribbonItems };
}

export const homeTab: DocxToolbarTab = {
  id: "home",
  labelKey: "office.docx.toolbar.tabHome",
  groups: [
    typed({
      id: "home-clipboard",
      labelKey: "office.docx.toolbar.groups.clipboard",
      component: HomeClipboardGroup,
      ribbonItems: homeClipboardRibbonItems,
      // Lower than Font's 560 so the leftmost group is the last to collapse
      // (Word keeps the leftmost controls visible longest) - F10.
      collapseAt: 500,
    }),
    typed({
      id: "home-font",
      labelKey: "office.docx.toolbar.groups.font",
      component: HomeFontGroup,
      ribbonItems: homeFontRibbonItems,
      collapseAt: 560,
    }),
    typed({ id: "home-paragraph", labelKey: "office.docx.toolbar.groups.paragraph", component: HomeParagraphGroup, collapseAt: 900 }),
    typed({ id: "home-styles", labelKey: "office.docx.toolbar.groups.styles", component: HomeStylesGroup, collapseAt: 1000 }),
  ],
};
