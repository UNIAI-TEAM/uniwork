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
      // UniChat erases the account in the app too (store account deletion policy).
      expect(section?.paragraphs.join(" ")).toContain(locale === "vi" ? "ứng dụng UniChat vào Cài đặt → Xóa tài khoản" : "UniChat app open Settings → Delete account");
    }
  });

  const paragraphs = (locale: "en" | "vi") => guideContent("privacy", locale).sections.flatMap(section => section.paragraphs);

  // The audit row of chat.report.created names the reporter as its actor and
  // every owner and admin reads the activity log, so the policy may not promise
  // that the person reported never learns who reported them (they can, when
  // they are an owner or admin). The reporter's words never reach the log.
  it("says who sees a report, the reporter included, and how to reach the operator", () => {
    for (const locale of ["en", "vi"] as const) {
      const reports = paragraphs(locale).find(paragraph => paragraph.startsWith(locale === "vi" ? "Báo cáo và chặn" : "Reports and blocking"));
      expect(reports).toBeDefined();
      expect(reports).toContain(locale === "vi" ? "và ai đã báo cáo" : "and who reported it");
      expect(reports).toContain(locale === "vi" ? "nếu họ là chủ sở hữu hoặc quản trị viên thì họ cũng xem được" : "if they are an owner or admin they can see the report too");
      expect(reports).toContain(locale === "vi" ? "bản xuất dữ liệu của tổ chức" : "organization's data export");
      expect(reports).toContain(legalEntity.email);
      expect(reports).not.toMatch(locale === "vi" ? /không biết ai đã báo cáo/ : /does not learn who reported/);
    }
  });

  // No AI route reads the consent the phone records (PUT /me/ai-consent), and
  // web and desktop never ask: the notice covers the phone's own requests, and
  // a member's messages in a shared conversation reach the provider whenever
  // any member uses AI on it.
  it("scopes the AI consent notice to the phone apps and says shared content goes out on any member's request", () => {
    for (const locale of ["en", "vi"] as const) {
      const ai = paragraphs(locale).find(paragraph => paragraph.includes("Anthropic"))!;
      expect(ai).toContain(locale === "vi" ? "ứng dụng UniChat cho Android và iPhone" : "UniChat apps for Android and iPhone");
      expect(ai).toContain(locale === "vi" ? "khi bất kỳ thành viên nào dùng AI" : "whenever any member uses AI");
      expect(ai).toContain(locale === "vi" ? "chỉ áp dụng cho yêu cầu AI của chính bạn" : "covers only your own AI requests");
      expect(ai).not.toMatch(locale === "vi" ? /Trong ứng dụng UniChat, trước lần đầu/ : /In the UniChat app you are asked/);
    }
  });

  it("carries a machine-readable effective date", () => {
    expect(guideContent("privacy", "en").effective?.dateTime).toBe("2026-10-21");
    expect(guideContent("privacy", "vi").effective?.dateTime).toBe("2026-10-21");
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
