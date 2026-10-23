import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { setLocale } from "@uniwork/core/i18n";
import { toastApiError } from "./toast-api-error";

const toastError = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
  },
}));

describe("toastApiError", () => {
  beforeEach(() => {
    toastError.mockClear();
  });

  it("shows the backend message when the transport wrapped it", () => {
    toastApiError(new ApiError("Server said no", "FORBIDDEN", 403), "fallback");
    expect(toastError).toHaveBeenCalledWith("Server said no");
  });

  it("words a known meeting code in the reader's language, not the server's", async () => {
    await setLocale("en");
    toastApiError(
      new ApiError("điểm danh đã chốt; hãy mở lại trước", "attendance_finalized", 409),
      "fallback",
    );
    expect(toastError).toHaveBeenCalledWith("Attendance is finalized. Reopen it and try again.");
    await setLocale("vi");
    toastApiError(new ApiError("khách không thể làm thư ký", "guest_cannot_be_secretary", 422), "fallback");
    expect(toastError).toHaveBeenLastCalledWith("Khách không thể làm thư ký.");
  });

  it("words the Email Hub codes a retry cannot fix", () => {
    toastApiError(new ApiError("Email Hub account needs to be reconnected", "email_hub_reauth_required", 409), "fallback");
    expect(toastError).toHaveBeenLastCalledWith("Hộp thư này cần kết nối lại. Kết nối lại hộp thư rồi thử lại.");
    toastApiError(new ApiError("smtp auth disabled", "email_hub_smtp_disabled", 400), "fallback");
    expect(toastError).toHaveBeenLastCalledWith(
      "Đăng nhập được nhưng máy chủ đã tắt gửi thư qua SMTP cho hộp thư này. Nhờ quản trị viên bật SMTP AUTH rồi thử lại.",
    );
  });

  it("falls back when the error has no readable message", () => {
    toastApiError({}, "Something went wrong");
    expect(toastError).toHaveBeenCalledWith("Something went wrong");
  });
});
