import { ViewNavigationGroup } from "../groups/view-navigation";
import { ViewZoomGroup } from "../groups/view-zoom";
import type { DocxToolbarTab } from "../types";

export const viewTab: DocxToolbarTab = {
  id: "view",
  labelKey: "office.docx.toolbar.tabView",
  groups: [
    { id: "view-zoom", labelKey: "office.docx.toolbar.groups.zoom", component: ViewZoomGroup, collapseAt: 560 },
    { id: "view-navigation", labelKey: "office.docx.toolbar.groups.navigation", component: ViewNavigationGroup, collapseAt: 900 },
  ],
};
