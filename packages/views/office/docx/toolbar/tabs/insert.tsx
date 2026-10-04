import { CaptionGroup } from "../../toc/caption-group";
import { TocGroup } from "../../toc/toc-group";
import { InsertChartGroup } from "../../charts/insert-chart-group";
import { InsertImageGroup } from "../../image/insert-image-group";
import { InsertHeaderFooterGroup } from "../groups/insert-header-footer";
import { InsertLinksGroup } from "../groups/insert-links";
import { InsertNotesGroup } from "../groups/insert-notes";
import { InsertSymbolsGroup } from "../groups/insert-symbols";
import { DocxShapesGroup, docxShapesRibbonItems } from "../../shapes/docx-shapes-group";
import { InsertTableGroup, insertTableRibbonItems } from "../groups/insert-table";
import type { DocxToolbarTab } from "../types";

export const insertTab: DocxToolbarTab = {
  id: "insert",
  labelKey: "office.docx.toolbar.tabInsert",
  groups: [
    { id: "insert-links", labelKey: "office.docx.toolbar.groups.links", component: InsertLinksGroup, collapseAt: 560 },
    {
      id: "insert-table",
      labelKey: "office.docx.toolbar.groups.table",
      component: InsertTableGroup,
      ribbonItems: insertTableRibbonItems,
      collapseAt: 900,
    },
    { id: "insert-image", labelKey: "office.docx.toolbar.groups.image", component: InsertImageGroup, collapseAt: 900 },
    { id: "insert-symbols", labelKey: "office.docx.toolbar.groups.symbols", component: InsertSymbolsGroup, collapseAt: 1000 },
    {
      id: "insert-shapes",
      labelKey: "office.docx.toolbar.groups.shapes",
      component: DocxShapesGroup,
      ribbonItems: docxShapesRibbonItems,
      collapseAt: 1000,
    },
    { id: "insert-notes", labelKey: "office.docx.toolbar.groups.notes", component: InsertNotesGroup, collapseAt: 1000 },
    { id: "insert-chart", labelKey: "office.docx.toolbar.groups.chart", component: InsertChartGroup, collapseAt: 1100 },
    { id: "insert-toc", labelKey: "office.docx.toolbar.groups.toc", component: TocGroup, collapseAt: 1100 },
    { id: "insert-captions", labelKey: "office.docx.toolbar.groups.captions", component: CaptionGroup, collapseAt: 1100 },
    { id: "insert-header-footer", labelKey: "office.docx.toolbar.groups.headerFooter", component: InsertHeaderFooterGroup, collapseAt: 1024 },
  ],
};
