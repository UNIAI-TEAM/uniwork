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

  it("never shows the server's message, even for a code it does not know", () => {
    const text = summaryErrorText(err("something_new", 500), t(), "tasks");
    expect(text).toBe("Chưa tạo được việc. Thử lại.");
    expect(summaryErrorText(new Error("boom"), t(), "generate")).toBe("Chưa tạo được tóm tắt. Thử lại.");
  });
});
