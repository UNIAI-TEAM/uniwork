import { describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { setLocale } from "@uniwork/core/i18n";
import { apiErrorCopy } from "./api-error-copy";

describe("apiErrorCopy", () => {
  it("words a failed fetch as a network problem instead of the browser's English", () => {
    expect(apiErrorCopy(new TypeError("Failed to fetch"))).toBe(
      "Không kết nối được UniWork. Kiểm tra mạng rồi thử lại.",
    );
  });

  it("leaves any other client-side error to the caller's fallback", () => {
    expect(apiErrorCopy(new Error("upload aborted"))).toBeUndefined();
    expect(apiErrorCopy("nope")).toBeUndefined();
  });

  it("prefers the code's own sentence over the server's placeholder text", async () => {
    expect(apiErrorCopy(new ApiError("forbidden", "forbidden", 403))).toBe("Bạn không có quyền làm việc này.");
    expect(apiErrorCopy(new ApiError("internal error", "internal", 500))).toBe("UniWork đang gặp sự cố. Thử lại sau vài phút.");
    await setLocale("en");
    expect(apiErrorCopy(new ApiError("too many requests", "rate_limited", 429))).toBe(
      "Too many requests. Wait a moment and try again.",
    );
  });

  it("words the two trash restore refusals itself", async () => {
    expect(apiErrorCopy(new ApiError("x", "trash_too_large", 422))).toBe(
      "Lô này có quá nhiều task nên chưa khôi phục được một lần.",
    );
    await setLocale("en");
    expect(apiErrorCopy(new ApiError("x", "duplicate_project_title", 409))).toMatch(/same title already exists/);
  });

  it("shows the server's Vietnamese sentence only to a Vietnamese reader", async () => {
    const err = new ApiError("tệp vượt quá dung lượng cho phép", "file_too_large", 413);
    expect(apiErrorCopy(err)).toBe("tệp vượt quá dung lượng cho phép");
    await setLocale("en");
    expect(apiErrorCopy(err)).toBeUndefined();
  });

  it("leaves an answer without a JSON body below 500 to the caller, not an outage sentence", () => {
    // A proxy's HTML 403/413 or a file route's 404 carries the transport's default code.
    expect(apiErrorCopy(new ApiError("Forbidden", "internal", 403))).toBeUndefined();
    expect(apiErrorCopy(new ApiError("", "internal", 404))).toBeUndefined();
    expect(apiErrorCopy(new ApiError("Bad Gateway", "internal", 502))).toBe("UniWork đang gặp sự cố. Thử lại sau vài phút.");
  });

  it("never shows the text of an unmapped server failure", () => {
    expect(apiErrorCopy(new ApiError("pq: connection reset", "db_down", 503))).toBeUndefined();
  });
});
