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

  // Google Play's account deletion URL points at #guide-section-8.
  it("keeps account deletion at section 8 in both languages", () => {
    expect(guideContent("privacy", "vi").sections[7]!.title).toBe("Lưu giữ và xóa dữ liệu");
    expect(guideContent("privacy", "en").sections[7]!.title).toBe("Retention and deletion");
    expect(guideContent("privacy", "en").sections[7]!.paragraphs.join(" ")).toContain("Settings → Security → Delete account");
  });

  it("is the page the footer links to", () => {
    expect(siteInformation.privacyUrl).toBe("/privacy");
  });
});
