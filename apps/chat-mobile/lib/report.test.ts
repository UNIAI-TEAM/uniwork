import { describe, expect, it } from "vitest";
import { REPORT_DETAILS_MAX, REPORT_REASONS, reportBody } from "./report";

describe("reportBody", () => {
  it("names the message or the person, the reason and the trimmed words", () => {
    expect(reportBody({ kind: "message", messageId: "m1", name: "An" }, "spam", "  ")).toEqual({ message_id: "m1", reason: "spam" });
    expect(reportBody({ kind: "user", userId: "u1", name: "An" }, "harassment", " nhắn quấy rối ")).toEqual({ user_id: "u1", reason: "harassment", details: "nhắn quấy rối" });
  });

  it("caps the words at the server's limit", () => {
    expect(reportBody({ kind: "user", userId: "u1", name: "An" }, "other", "x".repeat(REPORT_DETAILS_MAX + 5)).details).toHaveLength(REPORT_DETAILS_MAX);
  });

  it("keeps the server's closed reason set (chat_reports_reason_check)", () => {
    expect(REPORT_REASONS).toEqual(["spam", "harassment", "hate", "sexual", "violence", "self_harm", "other"]);
  });
});
