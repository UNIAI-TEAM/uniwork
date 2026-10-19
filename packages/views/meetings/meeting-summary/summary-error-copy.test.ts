import { describe, expect, it } from "vitest";
import { getI18n } from "react-i18next";
import { ApiError } from "@uniwork/core/api/http";
import { summaryErrorText } from "./summary-error-copy";

const t = () => getI18n().t;
const err = (code: string, status: number, fields?: Record<string, unknown>) =>
  new ApiError("thông điệp gốc của server", code, status, undefined, fields);

describe("summaryErrorText", () => {
  it("words each task-batch refusal itself", () => {
    expect(summaryErrorText(err("summary_superseded", 409), t(), "tasks")).toBe(
      "Tóm tắt vừa được tạo lại. Chọn lại việc trong bản mới.",
    );
    expect(summaryErrorText(err("assignee_not_member", 422), t(), "tasks")).toMatch(/Chọn người khác/);
    expect(summaryErrorText(err("not_meeting_host", 403), t(), "tasks")).toMatch(/chủ trì/);
    expect(summaryErrorText(err("not_found", 404), t(), "tasks")).toMatch(/Dự án đã chọn không còn/);
    expect(summaryErrorText(err("invalid_request", 400), t(), "tasks")).toMatch(/Tải lại trang/);
  });

  it("reads older and gateway names of the same failures", () => {
    expect(summaryErrorText(err("nothing_to_summarize", 409), t(), "generate")).toBe(
      summaryErrorText(err("summary_no_source", 409), t(), "generate"),
    );
    expect(summaryErrorText(err("ai_disabled", 503), t(), "generate")).toBe(
      summaryErrorText(err("ai_not_configured", 503), t(), "generate"),
    );
    expect(summaryErrorText(err("rate_limited", 429), t(), "generate")).toMatch(/một phút/);
    expect(summaryErrorText(err("ai_rate_limited", 429), t(), "generate")).toMatch(/một phút/);
  });

  it("words a task plan limit as the plan's task limit, not the AI quota", () => {
    const text = summaryErrorText(err("quota_exceeded", 403, { meter: "tasks.max" }), t(), "tasks");
    expect(text).toMatch(/giới hạn số việc của gói/);
    expect(text).not.toMatch(/AI/);
    expect(summaryErrorText(err("subscription_inactive", 403), t(), "tasks")).toMatch(/Gói của tổ chức/);
    expect(summaryErrorText(err("entitlement_required", 403), t(), "tasks")).not.toMatch(/tóm tắt AI/);
    // The summary run keeps its AI wording.
    expect(summaryErrorText(err("quota_exceeded", 403), t(), "generate")).toMatch(/hạn mức AI/);
  });

  it("names the items whose title matches an open task", () => {
    const items = [
      { index: 0, title: "Gửi báo cáo" },
      { index: 1, title: "Báo khách" },
      { index: 2, title: "Chốt lịch" },
    ];
    const text = summaryErrorText(err("active_duplicate_task", 409, { indexes: [0, 2] }), t(), "tasks", { items });
    expect(text).toBe(
      "Đã có việc đang mở trùng tên với: “Gửi báo cáo”, “Chốt lịch”. Bỏ chọn các mục này hoặc chọn dự án khác rồi thử lại.",
    );
  });

  it("names the existing task when the refusal does not say which item clashed", () => {
    const text = summaryErrorText(
      err("active_duplicate_task", 409, { task_id: "t9", identifier: "UNI-12", title: "Gửi báo cáo" }),
      t(),
      "tasks",
    );
    expect(text).toBe(
      "Đã có việc đang mở trùng tên: UNI-12 – Gửi báo cáo. Bỏ chọn mục trùng hoặc chọn dự án khác rồi thử lại.",
    );
    expect(summaryErrorText(err("active_duplicate_task", 409), t(), "tasks")).toBe(
      "Có việc trùng tên với một việc đang mở. Bỏ chọn mục trùng hoặc chọn dự án khác rồi thử lại.",
    );
  });

  it("never shows the server's message, even for a code it does not know", () => {
    const text = summaryErrorText(err("something_new", 500), t(), "tasks");
    expect(text).toBe("Chưa tạo được việc. Thử lại.");
    expect(summaryErrorText(new Error("boom"), t(), "generate")).toBe("Chưa tạo được tóm tắt. Thử lại.");
  });
});
