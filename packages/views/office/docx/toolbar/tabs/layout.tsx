import { LayoutPageSetupGroup } from "../groups/layout-page-setup";
import type { DocxToolbarTab } from "../types";

export const layoutTab: DocxToolbarTab = {
  id: "layout",
  labelKey: "office.docx.toolbar.tabLayout",
  groups: [
    { id: "layout-page-setup", labelKey: "office.docx.toolbar.groups.pageSetup", component: LayoutPageSetupGroup, collapseAt: 0 },
  ],
};
