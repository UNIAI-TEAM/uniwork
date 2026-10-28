import { readFileSync } from "node:fs";
import path from "node:path";
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
      // ...from every signed-in state: with no workspace, Settings is on the picker (app/(app)/account.tsx).
      expect(section?.paragraphs.join(" ")).toContain(locale === "vi" ? "Cài đặt nằm ở màn chọn workspace" : "Settings is on the workspace picker");
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
      // The operator's queue (/admin/chat-reports) holds ids and the reason, never content.
      expect(reports).toContain(locale === "vi" ? "đơn vị vận hành, cũng thấy từng báo cáo" : "We, the operator, also see each report");
      expect(reports).not.toMatch(locale === "vi" ? /không biết ai đã báo cáo/ : /does not learn who reported/);
    }
  });

  // Web and desktop never ask: the notice's agreement covers the phone's own
  // requests, and a member's messages in a shared conversation reach the
  // provider whenever any member uses AI on it, unless that member said no
  // (DELETE /me/ai-consent sets users.ai_opt_out_at, and every AI path that reads
  // chat leaves their messages out: server/internal/service/ai_opt_out.go).
  it("scopes the AI consent notice to the phone apps and says shared content goes out on any member's request", () => {
    for (const locale of ["en", "vi"] as const) {
      const ai = paragraphs(locale).find(paragraph => paragraph.includes("Anthropic"))!;
      expect(ai).toContain(locale === "vi" ? "ứng dụng UniChat cho Android và iPhone" : "UniChat apps for Android and iPhone");
      expect(ai).toContain(locale === "vi" ? "khi bất kỳ thành viên nào dùng AI" : "whenever any member uses AI");
      expect(ai).toContain(locale === "vi" ? "chỉ áp dụng cho yêu cầu AI của chính bạn" : "covers only your own AI requests");
      // Only what ai_opt_out.go filters: conversation messages in catch-up, Ask UNI and the call summary.
      expect(ai).toContain(
        locale === "vi"
          ? "tin nhắn bạn viết trong các cuộc trò chuyện được loại khỏi Bắt kịp, Hỏi UNI và tóm tắt cuộc gọi"
          : "the messages you write in conversations are left out of catch-up, Ask UNI and call summaries",
      );
      expect(ai).toContain(locale === "vi" ? "không áp dụng cho lời nói và tin nhắn trong cuộc họp" : "does not cover what you say or write in a meeting");
      expect(ai).not.toMatch(locale === "vi" ? /không được gửi tới AI nữa/ : /every AI request/);
      expect(ai).not.toMatch(locale === "vi" ? /Trong ứng dụng UniChat, trước lần đầu/ : /In the UniChat app you are asked/);
    }
  });

  it("carries a machine-readable effective date", () => {
    expect(guideContent("privacy", "en").effective?.dateTime).toBe("2026-10-28");
    expect(guideContent("privacy", "vi").effective?.dateTime).toBe("2026-10-28");
  });

  // Long provider names and descriptions overflowed the Office table's narrow middle column.
  it("lays out every table with a wide description column", () => {
    for (const locale of ["en", "vi"] as const) {
      const tables = guideContent("privacy", locale).sections.flatMap(section => section.table ? [section.table] : []);
      expect(tables).toHaveLength(2);
      expect(tables.every(table => table.layout === "wide-middle")).toBe(true);
    }
  });

  // Store reviewers hold the policy against the data-safety and App Privacy forms, which
  // apps/chat-mobile/store/listing.md › Quyền riêng tư declares row by row. Every row there
  // names here what the policy must say for it, in both languages; a new row fails until it does.
  const listingRows = () => {
    const listing = readFileSync(path.resolve(__dirname, "../../../chat-mobile/store/listing.md"), "utf8");
    const section = listing.slice(listing.indexOf("## Quyền riêng tư"));
    const table = section.slice(section.indexOf("| Dữ liệu |"), section.indexOf("\n\n", section.indexOf("| Dữ liệu |")));
    return table.split("\n").slice(2).map(line => line.split("|")[1]!.trim());
  };
  const policyFor: Record<string, { vi: string[]; en: string[] }> = {
    "Tên, email": { vi: ["Email, tên hiển thị"], en: ["Email, display name"] },
    "Nội dung tin, ảnh, tệp, tin thoại": { vi: ["Tin nhắn, ảnh, tệp, tin thoại"], en: ["Messages, photos, files, voice messages"] },
    "Nội dung xem trước trong push": { vi: ["tối đa 120 ký tự đầu"], en: ["first 120 characters"] },
    "Push token Expo, tên máy, nền tảng": { vi: ["Mã nhận thông báo đẩy (push token), nền tảng, tên thiết bị", "Expo (650 Industries)"], en: ["Push notification token, platform, device name", "Expo (650 Industries)"] },
    "Chẩn đoán: báo cáo crash và hiệu năng (Sentry, bên thứ ba)": { vi: ["Báo cáo lỗi ứng dụng điện thoại", "Sentry (Functional Software)"], en: ["Phone app error reports", "Sentry (Functional Software)"] },
    "Thống kê sử dụng ẩn danh (server UniWork)": {
      vi: ["Thống kê sử dụng ứng dụng điện thoại", "không gắn với bạn", "Cài đặt → Quyền riêng tư và bảo mật → Gửi thống kê sử dụng ẩn danh"],
      en: ["Phone app usage statistics", "not linked to you", "Settings → Privacy & security → Share anonymous usage statistics"],
    },
    "Mã định danh trong báo cáo crash": { vi: ["mã người dùng UniWork"], en: ["your UniWork user id"] },
    "Xử lý AI (Anthropic, bên thứ ba)": { vi: ["Anthropic"], en: ["Anthropic"] },
    "Báo cáo vi phạm": { vi: ["Báo cáo và chặn"], en: ["Reports and blocking"] },
    "Đăng nhập bằng Apple": {
      vi: ["Đăng nhập bằng Apple (khi bạn chọn) trên web, máy tính, Android và iPhone", "mã tài khoản Apple", "email ẩn của Apple"],
      en: ["Sign in with Apple (when you choose it) on the web, desktop, Android and iPhone", "Apple account id", "Apple's hidden email"],
    },
    "Đăng nhập bằng Google": {
      vi: ["trong ứng dụng UniChat qua thư viện đăng nhập của Google", "mã tài khoản Google"],
      en: ["in the UniChat app through Google's sign-in library", "Google account id"],
    },
  };

  it("says what the store listing declares, row for row, in both languages", () => {
    const rows = listingRows();
    expect(rows).toHaveLength(Object.keys(policyFor).length);
    for (const row of rows) {
      expect(policyFor, `listing row "${row}" has no policy wording here`).toHaveProperty([row]);
      for (const locale of ["en", "vi"] as const) {
        const text = JSON.stringify(guideContent("privacy", locale));
        for (const phrase of policyFor[row]![locale]) expect(text, `${locale}: ${row}`).toContain(phrase);
      }
    }
  });

  // ADR 0047: every platform signs in with Google and Apple. The policy says what each provider hands over, that
  // their passwords never reach us, and where their tokens go: Google's nowhere, Apple's (sealed) only back to Apple
  // when the account is deleted (the revocation the deletion section promises). The phone's own sign-in screen
  // keeps the typed password in memory only.
  it("says what Google and Apple tell us, and that their sign-in tokens are never shared", () => {
    for (const locale of ["en", "vi"] as const) {
      const signIn = paragraphs(locale).find(paragraph => paragraph.startsWith(locale === "vi" ? "Đăng nhập bằng Google hoặc Apple" : "Signing in with Google or Apple"));
      expect(signIn).toBeDefined();
      expect(signIn).toContain(locale === "vi" ? "không bao giờ thấy mật khẩu của tài khoản đó" : "we never see that account's password");
      expect(signIn).toContain(locale === "vi" ? "không được chia sẻ với ai" : "is never shared with anyone");
      expect(signIn).toContain(locale === "vi" ? "báo Apple thu hồi khi bạn xóa tài khoản" : "ask Apple to revoke it when you delete your account");
      expect(signIn).toContain(locale === "vi" ? "không được lưu trên máy" : "never stored on the device");
    }
  });

  it("is the page the footer links to", () => {
    expect(siteInformation.privacyUrl).toBe("/privacy");
  });
});
