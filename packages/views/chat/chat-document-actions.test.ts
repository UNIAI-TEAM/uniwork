import { ApiError } from "@uniwork/core/api";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { chatDocumentVersionMessage } from "./chat-document-actions";

initI18n();

describe("chatDocumentVersionMessage", () => {
  const t = ((key: string) => `t:${key}`) as never;

  it("maps document_version_conflict to the chat card's own key (RFC-04)", () => {
    // The card has no history view to reopen — the restore copy would send
    // the reader to a surface this card does not have.
    expect(
      chatDocumentVersionMessage(new ApiError("conflict", "document_version_conflict", 409), t),
    ).toBe("t:chat.errors.document_version_conflict");
  });

  it("keeps the format_changed refusal on its own key", () => {
    expect(
      chatDocumentVersionMessage(
        new ApiError("format", "unsupported_media_type", 415, undefined, { reason: "format_changed" }),
        t,
      ),
    ).toBe("t:chat.errors.document_format_changed");
  });

  it("falls through to the shared chat table for other codes", () => {
    expect(chatDocumentVersionMessage(new ApiError("no", "forbidden", 403), t)).toBe(
      "t:chat.errors.forbidden",
    );
    // No sentence of its own: the caller keeps the documents copy.
    expect(chatDocumentVersionMessage(new Error("boom"), t)).toBeNull();
  });

  it("names who holds the edit lock on a 423, and says so without a name", () => {
    const i18n = initI18n();
    const vi = i18n.getFixedT("vi") as never;
    expect(
      chatDocumentVersionMessage(new ApiError("", "document_locked", 423, undefined, { holder_name: "Bình" }), vi),
    ).toBe("Bình đang sửa tài liệu này. Thử lại khi họ lưu xong.");
    expect(chatDocumentVersionMessage(new ApiError("", "", 423), vi)).toBe(
      "Tài liệu này đang có người sửa. Thử lại khi họ lưu xong.",
    );
  });

  it("gives the reader's own hold in another window its own sentence (contract D6)", () => {
    const err = new ApiError("", "document_locked", 423, undefined, { held_by_me: true, holder_name: "An" });
    expect(chatDocumentVersionMessage(err, t)).toBe("t:chat.errors.document_locked_by_me");
  });

  it("renders the 409 copy in vi and en", () => {
    const i18n = initI18n();
    const err = new ApiError("conflict", "document_version_conflict", 409);
    expect(chatDocumentVersionMessage(err, i18n.getFixedT("vi") as never)).toBe(
      "Tài liệu vừa có phiên bản mới. Tải lại rồi thử lại.",
    );
    expect(chatDocumentVersionMessage(err, i18n.getFixedT("en") as never)).toBe(
      "The document just got a new version. Reload and try again.",
    );
  });
});
