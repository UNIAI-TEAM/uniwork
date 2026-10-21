import { describe, expect, it } from "vitest";
import { isOpenableWebUrl, legalLinks, legalLocale, SUPPORT_EMAIL } from "./legal-links";

describe("legalLinks", () => {
  it("points at the web's privacy policy in the reader's language, with the deletion anchor Play is given", () => {
    expect(legalLinks("https://app.uniworkos.com/", "en", "UniChat")).toEqual({
      privacy: "https://app.uniworkos.com/privacy",
      deleteAccount: "https://app.uniworkos.com/privacy#delete-account",
      terms: null,
      support: "mailto:contact@unicomhub.com?subject=UniChat",
    });
    const vi = legalLinks("https://app.uniworkos.com", "vi", "Hỗ trợ UniChat 0.3.0");
    expect(vi.privacy).toBe("https://app.uniworkos.com/vi/privacy");
    expect(vi.deleteAccount).toBe("https://app.uniworkos.com/vi/privacy#delete-account");
    expect(vi.support).toBe(`mailto:${SUPPORT_EMAIL}?subject=H%E1%BB%97%20tr%E1%BB%A3%20UniChat%200.3.0`);
  });

  it("reads the English page only for English", () => {
    expect(legalLocale("en")).toBe("en");
    expect(legalLocale("vi")).toBe("vi");
    expect(legalLocale("fr")).toBe("vi");
  });

  it("opens only an absolute web page", () => {
    expect(isOpenableWebUrl("https://app.uniworkos.com/privacy")).toBe(true);
    expect(isOpenableWebUrl("http://192.168.1.2:3000/privacy")).toBe(true);
    expect(isOpenableWebUrl("/privacy")).toBe(false);
    expect(isOpenableWebUrl("javascript:alert(1)")).toBe(false);
  });
});
