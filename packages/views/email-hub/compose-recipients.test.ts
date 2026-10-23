import { describe, expect, it } from "vitest";
import {
  buildForwardBody,
  buildReplyAllRecipients,
  buildReplyRecipients,
  composeSendErrorKey,
  forwardSubject,
  replySubject,
} from "./compose-recipients";

const thread = {
  id: "th1",
  account_id: "acc1",
  folder: "INBOX",
  subject: "Project update",
  snippet: "Hello team",
  from_addr: "sender@example.com",
  from_name: "Sender",
  to_addrs: ["me@gmail.com", "peer@example.com"],
  sent_at: "2026-09-18T03:00:00Z",
  is_read: true,
  is_starred: false,
  has_attachments: false,
  body_text: "Hello team",
  body_cached: true,
  imap_labels: [],
};

describe("compose recipients", () => {
  it("replySubject prefixes Re when missing", () => {
    expect(replySubject("Hello")).toBe("Re: Hello");
    expect(replySubject("Re: Hello")).toBe("Re: Hello");
  });

  it("forwardSubject prefixes Fwd when missing", () => {
    expect(forwardSubject("Hello")).toBe("Fwd: Hello");
    expect(forwardSubject("Fwd: Hello")).toBe("Fwd: Hello");
  });

  it("buildReplyAllRecipients excludes self and deduplicates", () => {
    const { to, cc } = buildReplyAllRecipients(thread, "me@gmail.com");
    expect(to).toBe("sender@example.com");
    expect(cc).toBe("peer@example.com");
  });

  it("replies to the original recipients when the source was sent by the current account", () => {
    expect(
      buildReplyRecipients(
        { from_addr: "  ME@company.vn ", to_addrs: ["customer@example.com"] },
        "me@COMPANY.vn",
      ),
    ).toEqual(["customer@example.com"]);
  });

  it("still replies to the sender for a normal inbox message", () => {
    expect(
      buildReplyRecipients(
        { from_addr: "sender@example.com", to_addrs: ["me@company.vn"] },
        "me@company.vn",
      ),
    ).toEqual(["sender@example.com"]);
  });

  it.each([{ from_addr: "me@company.vn", to_addrs: [] }, { from_addr: "me@company.vn" }])(
    "keeps an own sent message with empty or missing recipients safe: %o",
    (source) => {
      expect(buildReplyRecipients(source, "me@company.vn")).toEqual([]);
    },
  );

  it("buildForwardBody quotes original message in the app language", () => {
    const body = buildForwardBody(thread, {
      header: "Email chuyển tiếp",
      from: "Từ",
      date: "Ngày",
      subject: "Tiêu đề",
      when: "Thứ 6, 18 thg 9, 2026 · 10:00",
    });
    expect(body).toContain("---------- Email chuyển tiếp ----------");
    expect(body).toContain("Ngày: Thứ 6, 18 thg 9, 2026 · 10:00");
    expect(body).toContain("Tiêu đề: Project update");
    expect(body).toContain("Sender <sender@example.com>");
    expect(body).toContain("Project update");
    expect(body).toContain("Hello team");
  });
});

describe("composeSendErrorKey", () => {
  it("says what a retry cannot fix instead of \"check the connection and retry\"", () => {
    expect(composeSendErrorKey("email_hub_not_configured")).toBe("email_hub.connect.error_not_configured");
    expect(composeSendErrorKey("email_hub_reauth_required")).toBe("email_hub.reconnect.error");
    expect(composeSendErrorKey("email_hub_smtp_disabled")).toBe("email_hub.connect.error_smtp_disabled");
    expect(composeSendErrorKey(undefined)).toBe("email_hub.compose.error");
  });
});
