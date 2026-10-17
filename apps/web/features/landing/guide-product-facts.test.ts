import { describe, expect, it } from "vitest";
import { officeModuleSpec } from "@uniwork/core/office/office-modules";
import { officeFormatsTable } from "./guide-product-facts";
import { guideContent } from "./guide-content";

describe("public product claims", () => {
  for (const locale of ["en", "vi"] as const) it(`keeps ${locale} format limits aligned with the web host`, () => {
    const table = officeFormatsTable(locale);
    expect(table.rows.map(row => row[1])).toEqual([".docx", ".xlsx", ".pptx", ".pdf", ".html", ".md"]);
    expect(officeModuleSpec("sheets").maxBytes).toBeUndefined();
    expect(table.rows.find(row => row[0] === "Sheets")?.[2]).not.toContain("MiB");
    expect(table.rows.filter(row => row[2].includes(locale === "vi" ? "xuất PDF" : "export PDF")).map(row => row[0])).toEqual(["Docs"]);
    expect(guideContent("office-files-and-ai", locale).sections.find(section => section.table)?.table).toEqual(table);
  });
  it("has matching bilingual article structure and labels sample data", () => {
    for (const key of ["about", "security", "start-with-tasks", "office-files-and-ai", "meetings-to-tasks"]) {
      const vi = guideContent(key, "vi");
      const en = guideContent(key, "en");
      expect(vi.sections.length).toBe(en.sections.length);
      expect(vi.sections.map(section => !!section.table)).toEqual(en.sections.map(section => !!section.table));
    }
    expect(guideContent("office-files-and-ai", "vi").sections.some(section => section.illustration?.caption.includes("dữ liệu mẫu"))).toBe(true);
    expect(guideContent("start-with-tasks", "en").sections.some(section => section.example?.description.includes("not customer data"))).toBe(true);
  });
});
