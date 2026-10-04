import { DocxExportGroup, docxExportRibbonItems } from "../../export/docx-export-menu";
import { ViewNavigationGroup, viewNavigationRibbonItems } from "../groups/view-navigation";
import { ViewZoomGroup, viewZoomRibbonItems } from "../groups/view-zoom";
import type { DocxToolbarTab } from "../types";

export const viewTab: DocxToolbarTab = {
  id: "view",
  labelKey: "office.docx.toolbar.tabView",
  groups: [
    {
      id: "view-zoom",
      labelKey: "office.docx.toolbar.groups.zoom",
      component: ViewZoomGroup,
      ribbonItems: viewZoomRibbonItems,
      collapseAt: 560,
    },
    {
      id: "view-navigation",
      labelKey: "office.docx.toolbar.groups.navigation",
      component: ViewNavigationGroup,
      ribbonItems: viewNavigationRibbonItems,
      collapseAt: 900,
    },
    {
      id: "export",
      labelKey: "office.docx.toolbar.groups.export",
      component: DocxExportGroup,
      ribbonItems: docxExportRibbonItems,
      collapseAt: 1024,
    },
  ],
};
