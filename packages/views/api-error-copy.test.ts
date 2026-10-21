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

  it("shows the server's Vietnamese sentence only to a Vietnamese reader", async () => {
    const err = new ApiError("tệp vượt quá dung lượng cho phép", "file_too_large", 413);
    expect(apiErrorCopy(err)).toBe("tệp vượt quá dung lượng cho phép");
    await setLocale("en");
    expect(apiErrorCopy(err)).toBeUndefined();
  });

  it("never shows the text of an unmapped server failure", () => {
    expect(apiErrorCopy(new ApiError("pq: connection reset", "db_down", 503))).toBeUndefined();
  });
});
