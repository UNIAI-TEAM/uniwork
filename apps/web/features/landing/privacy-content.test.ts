import { describe, expect, it } from "vitest";
import { legalEntity, siteInformation } from "../../platform/site-information";
import { guideContent } from "./guide-content";

describe("privacy policy", () => {
  for (const locale of ["en", "vi"] as const) it(`names the operator and the data contact in ${locale}`, () => {
    const policy = guideContent("privacy", locale);
    const first = policy.sections[0]!.paragraphs.join(" ");
    expect(first).toContain(locale === "vi" ? legalEntity.nameVi : legalEntity.nameEn);
    expect(first).toContain(legalEntity.enterpriseCode);
    expect(first).toContain(legalEntity.email);
  });

  // Google Play's account deletion URL is /privacy#delete-account.
  it("anchors account deletion at #delete-account in both languages", () => {
    for (const locale of ["en", "vi"] as const) {
      const section = guideContent("privacy", locale).sections.find(candidate => candidate.id === "delete-account");
      expect(section?.paragraphs.join(" ")).toContain(locale === "vi" ? "Cài đặt → Bảo mật → Xóa tài khoản" : "Settings → Security → Delete account");
    }
  });

  it("carries a machine-readable effective date", () => {
    expect(guideContent("privacy", "en").effective?.dateTime).toBe("2026-10-20");
    expect(guideContent("privacy", "vi").effective?.dateTime).toBe("2026-10-20");
  });

  // Long provider names and descriptions overflowed the Office table's narrow middle column.
  it("lays out every table with a wide description column", () => {
    for (const locale of ["en", "vi"] as const) {
      const tables = guideContent("privacy", locale).sections.flatMap(section => section.table ? [section.table] : []);
      expect(tables).toHaveLength(2);
      expect(tables.every(table => table.layout === "wide-middle")).toBe(true);
    }
  });

  it("is the page the footer links to", () => {
    expect(siteInformation.privacyUrl).toBe("/privacy");
  });
});
