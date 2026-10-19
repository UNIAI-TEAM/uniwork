import { ApiError } from "@uniwork/core/api";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { chatDocumentVersionError } from "./chat-document-actions";

initI18n();

describe("chatDocumentVersionError", () => {
  const t = ((key: string) => `t:${key}`) as never;

  it("maps document_version_conflict to the chat card's own key (RFC-04)", () => {
    // The card has no history view to reopen — the restore copy would send
    // the reader to a surface this card does not have.
    expect(
      chatDocumentVersionError(new ApiError("conflict", "document_version_conflict", 409), t, "fallback"),
    ).toBe("t:chat.errors.document_version_conflict");
  });

  it("keeps the format_changed refusal on its own key", () => {
    expect(
      chatDocumentVersionError(
        new ApiError("format", "unsupported_media_type", 415, undefined, { reason: "format_changed" }),
        t,
        "fallback",
      ),
    ).toBe("t:chat.errors.document_format_changed");
  });

  it("falls through to the shared chat table for other codes", () => {
    expect(chatDocumentVersionError(new ApiError("no", "forbidden", 403), t, "fallback")).toBe(
      "t:chat.errors.forbidden",
    );
    expect(chatDocumentVersionError(new Error("boom"), t, "fallback")).toBe("fallback");
  });

  it("renders the 409 copy in vi and en", () => {
    const i18n = initI18n();
    const err = new ApiError("conflict", "document_version_conflict", 409);
    expect(chatDocumentVersionError(err, i18n.getFixedT("vi") as never, "fallback")).toBe(
      "Tài liệu vừa có phiên bản mới. Tải lại rồi thử lại.",
    );
    expect(chatDocumentVersionError(err, i18n.getFixedT("en") as never, "fallback")).toBe(
      "The document just got a new version. Reload and try again.",
    );
  });
});
