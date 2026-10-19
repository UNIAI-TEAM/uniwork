import { ApiError } from "@uniwork/core/api";
import { describe, expect, it } from "vitest";
import { chatDocumentSendError, chatErrorMessage } from "./chat-error-message";

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

describe("chatDocumentSendError", () => {
  const tt = ((key: string, opts?: { max?: string }) => `t:${key}${opts?.max ? `:${opts.max}` : ""}`) as never;

  it("maps the document send codes to their own copy", () => {
    expect(
      chatDocumentSendError(new ApiError("quota", "quota_exceeded", 403), tt, "fallback"),
    ).toBe("t:chat.errors.document_quota_exceeded");
    expect(
      chatDocumentSendError(new ApiError("too many", "share_batch_too_large", 422), tt, "fallback"),
    ).toBe("t:chat.errors.share_batch_too_large");
    expect(
      chatDocumentSendError(
        new ApiError("format", "unsupported_media_type", 415, undefined, { reason: "format" }),
        tt,
        "fallback",
      ),
    ).toBe("t:chat.errors.document_format");
  });

  it("reports a 413 against the document ceiling, not the chat one", () => {
    expect(
      chatDocumentSendError(new ApiError("too large", "too_large", 413), tt, "fallback"),
    ).toBe("t:chat.file_too_large:200 MB");
  });

  it("falls back through the shared mapper for known and unknown errors", () => {
    expect(
      chatDocumentSendError(new ApiError("nope", "forbidden", 403), tt, "fallback"),
    ).toBe("t:chat.errors.forbidden");
    expect(chatDocumentSendError(new Error("boom"), tt, "fallback")).toBe("fallback");
  });
});
