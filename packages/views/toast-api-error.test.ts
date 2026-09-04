import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
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

  it("falls back when the error has no readable message", () => {
    toastApiError({}, "Something went wrong");
    expect(toastError).toHaveBeenCalledWith("Something went wrong");
  });
});
