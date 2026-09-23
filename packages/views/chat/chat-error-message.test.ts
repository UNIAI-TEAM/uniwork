import { ApiError } from "@uniwork/core/api";
import { describe, expect, it } from "vitest";
import { chatErrorMessage } from "./chat-error-message";

const t = ((key: string) => `t:${key}`) as unknown as Parameters<typeof chatErrorMessage>[1];

describe("chatErrorMessage", () => {
  it("never shows the server sentence for a known code", () => {
    expect(chatErrorMessage(new ApiError("forbidden", "forbidden", 403), t, "fallback")).toBe("t:chat.errors.forbidden");
  });

  it("uses the caller's fallback for validation and unknown codes", () => {
    expect(chatErrorMessage(new ApiError("topic tối đa 280 ký tự", "invalid_request", 400), t, "fallback")).toBe("fallback");
    expect(chatErrorMessage(new Error("boom"), t, "fallback")).toBe("fallback");
  });

  it("names a network failure", () => {
    expect(chatErrorMessage(new TypeError("Failed to fetch"), t, "fallback")).toBe("t:chat.errors.network");
  });
});
