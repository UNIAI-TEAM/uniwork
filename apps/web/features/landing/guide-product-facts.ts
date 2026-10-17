import type { SupportedLocale } from "@uniwork/core/i18n/types";
import { officeModuleSpec } from "@uniwork/core/office/office-modules";

export type GuideTable = { caption: string; columns: [string, string, string]; rows: [string, string, string][] };

/** Use the same capability contract as the real Office web host. */
export function officeFormatsTable(locale: SupportedLocale): GuideTable {
  const vi = locale === "vi";
  return {
    caption: vi ? "Định dạng và thao tác trong Office trên web" : "Formats and actions in Office on the web",
    columns: vi ? ["Trình soạn thảo", "Định dạng", "Thao tác khi có quyền"] : ["Editor", "Format", "Actions when permitted"],
    rows: (["docs", "sheets", "slides", "pdf", "html", "markdown"] as const).map(module => {
      const spec = officeModuleSpec(module);
      const actions = [vi ? "Lưu, lưu thành bản mới và in" : "Save, save as and print"];
      if (spec.grant.exportPdf) actions.push(vi ? "xuất PDF" : "export PDF");
      if (spec.grant.exportHtml) actions.push(vi ? "xuất HTML" : "export HTML");
      const label = { docs: "Docs", sheets: "Sheets", slides: "Slides", pdf: "PDF", html: "HTML", markdown: "Markdown" }[module];
      return [label, `.${spec.extension}`, actions.join("; ")];
    }),
  };
}
