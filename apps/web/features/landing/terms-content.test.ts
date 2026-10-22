import { describe, expect, it } from "vitest";
import { legalEntity, siteInformation } from "../../platform/site-information";
import { guideContent } from "./guide-content";

describe("terms of use", () => {
  const text = (locale: "en" | "vi") => JSON.stringify(guideContent("terms", locale));

  for (const locale of ["en", "vi"] as const) it(`names the operator and the contact in ${locale}`, () => {
    const first = guideContent("terms", locale).sections[0]!.paragraphs.join(" ");
    expect(first).toContain(locale === "vi" ? legalEntity.nameVi : legalEntity.nameEn);
    expect(first).toContain(legalEntity.enterpriseCode);
    expect(first).toContain(legalEntity.email);
  });

  // Apple 1.2 and Play's UGC policy: the terms forbid objectionable content and abusive users with
  // no tolerance, and say the operator acts on a report within 24 hours. The store listing's reviewer
  // note points at #acceptable-use. It promises what exists: the operator's queue sees in-app reports,
  // an organization deactivates a member, the operator suspends an organization (no one can delete
  // another member's message today).
  it("forbids objectionable content and abuse at #acceptable-use and commits to act on reports within 24 hours", () => {
    for (const locale of ["en", "vi"] as const) {
      const sections = guideContent("terms", locale).sections;
      const zeroTolerance = sections.find(section => section.id === "acceptable-use");
      expect(zeroTolerance?.paragraphs.join(" ")).toContain(locale === "vi" ? "không chấp nhận bất kỳ nội dung phản cảm nào" : "do not tolerate objectionable content");
      expect(zeroTolerance?.steps?.length).toBeGreaterThanOrEqual(7);
      expect(text(locale)).toContain(locale === "vi" ? "trong vòng 24 giờ" : "within 24 hours");
      expect(text(locale)).toContain(locale === "vi" ? "vô hiệu hoá tài khoản đã đăng nó" : "deactivate the account that posted it");
      expect(text(locale)).toContain(locale === "vi" ? "tạm ngưng tổ chức" : "suspend the organization");
      expect(text(locale)).toContain(locale === "vi" ? "nhận mọi báo cáo gửi trong ứng dụng" : "receive every report made in the apps");
    }
  });

  // The deletion paths the app and the web actually offer, as the privacy policy names them.
  it("names the in-app account deletion paths", () => {
    expect(text("vi")).toContain("ứng dụng UniChat ở Cài đặt → Xóa tài khoản");
    expect(text("en")).toContain("UniChat app under Settings → Delete account");
  });

  // Apple's minimum terms for a custom EULA (Licensed Application End User License Agreement, instructions).
  it("carries the App Store's minimum terms", () => {
    for (const locale of ["en", "vi"] as const) {
      const store = guideContent("terms", locale).sections.find(section => section.title.includes("App Store"))!;
      const body = store.paragraphs.join(" ");
      for (const phrase of locale === "vi"
        ? ["không phải với Apple", "Apple không có nghĩa vụ bảo trì", "hoàn tiền", "cấm vận", "bên thụ hưởng thứ ba"]
        : ["not Apple", "Apple has no obligation to maintain", "refund", "embargo", "third-party beneficiaries"]) expect(body).toContain(phrase);
    }
  });

  it("has the same sections in both languages and an effective date", () => {
    const vi = guideContent("terms", "vi");
    const en = guideContent("terms", "en");
    expect(vi.sections.map(section => section.id ?? null)).toEqual(en.sections.map(section => section.id ?? null));
    expect(vi.sections.map(section => section.steps?.length ?? 0)).toEqual(en.sections.map(section => section.steps?.length ?? 0));
    expect(vi.effective?.dateTime).toBe(en.effective?.dateTime);
  });

  it("is the page the footer links to", () => {
    expect(siteInformation.termsUrl).toBe("/terms");
  });
});
