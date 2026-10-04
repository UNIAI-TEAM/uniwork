import { HomeFontGroup } from "../groups/home-font";
import { HomeListsGroup } from "../../lists/home-lists";
import { HomeParagraphGroup } from "../groups/home-paragraph";
import { HomeStylesGroup } from "../groups/home-styles";
import type { DocxToolbarTab } from "../types";

/**
 * The Home tab in Word's order (C8): Font (family, size, B I U S x2 x2,
 * colour, highlight, case, clear, painter) | Lists (bullets, numbering,
 * multilevel) | Paragraph (outdent, indent, align, spacing) | Styles. Each
 * control appears once per tab (C7): the old "Formatting" group that duplicated
 * B/I/U and the heading/bullet/numbered toggles is gone - the trio lives in the
 * Font group and the list controls in the Lists gallery.
 *
 * Find is not a group here: it renders at the far right of the ribbon tab row
 * (C6), so the shell's tab row owns it.
 */
export const homeTab: DocxToolbarTab = {
  id: "home",
  labelKey: "office.docx.toolbar.tabHome",
  groups: [
    { id: "home-font", labelKey: "office.docx.toolbar.groups.font", component: HomeFontGroup, collapseAt: 560 },
    { id: "home-lists", labelKey: "office.docx.toolbar.groups.lists", component: HomeListsGroup, collapseAt: 800 },
    { id: "home-paragraph", labelKey: "office.docx.toolbar.groups.paragraph", component: HomeParagraphGroup, collapseAt: 900 },
    { id: "home-styles", labelKey: "office.docx.toolbar.groups.styles", component: HomeStylesGroup, collapseAt: 1000 },
  ],
};
