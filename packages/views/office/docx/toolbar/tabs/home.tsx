import { HomeListsGroup } from "../../lists/home-lists";
import { HomeBaseFormatGroup } from "../groups/home-base";
import { HomeFindGroup } from "../groups/home-find";
import { HomeFontGroup } from "../groups/home-font";
import { HomeParagraphGroup } from "../groups/home-paragraph";
import { HomeStylesGroup } from "../groups/home-styles";
import type { DocxToolbarTab } from "../types";

export const homeTab: DocxToolbarTab = {
  id: "home",
  labelKey: "office.docx.toolbar.tabHome",
  groups: [
    { id: "home-base", labelKey: "office.docx.toolbar.groups.baseFormat", component: HomeBaseFormatGroup, collapseAt: 0 },
    { id: "home-font", labelKey: "office.docx.toolbar.groups.font", component: HomeFontGroup, collapseAt: 560 },
    { id: "home-paragraph", labelKey: "office.docx.toolbar.groups.paragraph", component: HomeParagraphGroup, collapseAt: 640 },
    { id: "home-lists", labelKey: "office.docx.toolbar.groups.lists", component: HomeListsGroup, collapseAt: 800 },
    { id: "home-styles", labelKey: "office.docx.toolbar.groups.styles", component: HomeStylesGroup, collapseAt: 900 },
    { id: "home-find", labelKey: "office.docx.toolbar.groups.find", component: HomeFindGroup, collapseAt: 1024 },
  ],
};
