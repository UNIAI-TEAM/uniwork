import { ApiError } from "@uniwork/core/api";
import { describe, expect, it } from "vitest";
import {
  chatDocumentLinkError,
  chatDocumentSendError,
  chatErrorMessage,
  isChatClientMsgIdSpent,
  isChatDocumentLinkStale,
} from "./chat-error-message";

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
    // No recipient cap any more (UNI-2012): an old server's 422 batch refusal
    // has no sentence of its own and reads as the caller's fallback.
    expect(
      chatDocumentSendError(new ApiError("too many", "share_batch_too_large", 422), tt, "fallback"),
    ).toBe("fallback");
    expect(
      chatDocumentSendError(
        new ApiError("format", "unsupported_media_type", 415, undefined, { reason: "format" }),
        tt,
        "fallback",
      ),
    ).toBe("t:chat.errors.document_format");
  });

  it("names the share-as-document 422 for a file that cannot become a document", () => {
    // share-as-document answers 422 source_not_saveable (type or size outside
    // the document policy), which is not the upload route's 415.
    expect(
      chatDocumentSendError(new ApiError("nope", "source_not_saveable", 422), tt, "fallback"),
    ).toBe("t:chat.errors.source_not_saveable");
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

describe("chatDocumentLinkError", () => {
  const status: Record<string, number> = {
    not_found: 404,
    forbidden: 403,
    document_archived: 403,
    document_shelved: 409,
    document_owned_by_work_product: 409,
    my_folder_locked: 409,
    folder_not_shareable: 422,
    chat_message_deleted: 410,
    idempotency_conflict: 409,
    invalid_request: 400,
    weird: 500,
  };
  const err = (code: string) => new ApiError("raw server sentence", code, status[code] ?? 500);

  it.each([
    ["not_found", "t:chat.errors.document_link_not_found"],
    ["forbidden", "t:chat.errors.document_link_forbidden"],
    ["document_archived", "t:chat.errors.document_link_archived"],
    ["document_shelved", "t:chat.errors.document_link_unsendable"],
    ["document_owned_by_work_product", "t:chat.errors.document_link_unsendable"],
    ["my_folder_locked", "t:chat.errors.document_link_unsendable"],
    ["folder_not_shareable", "t:chat.errors.document_link_unsendable"],
    ["chat_message_deleted", "fallback"],
    ["idempotency_conflict", "fallback"],
    ["invalid_request", "fallback"],
    ["weird", "fallback"],
  ])("maps %s", (code, expected) => {
    expect(chatDocumentLinkError(err(code), t, "fallback")).toBe(expected);
  });

  it("keeps the document send table and the network sentence for everything else", () => {
    expect(chatDocumentLinkError(err("quota_exceeded"), t, "fallback")).toBe("t:chat.errors.document_quota_exceeded");
    expect(chatDocumentLinkError(new TypeError("Failed to fetch"), t, "fallback")).toBe("t:chat.errors.network");
  });

  it("flags only the refusals that make the picker's rows stale", () => {
    for (const code of [
      "not_found",
      "forbidden",
      "document_archived",
      "document_shelved",
      "document_owned_by_work_product",
      "my_folder_locked",
      "folder_not_shareable",
    ]) {
      expect(isChatDocumentLinkStale(err(code)), code).toBe(true);
    }
    for (const code of ["chat_message_deleted", "idempotency_conflict", "invalid_request", "weird"]) {
      expect(isChatDocumentLinkStale(err(code)), code).toBe(false);
    }
    expect(isChatDocumentLinkStale(new Error("boom"))).toBe(false);
  });

  it("flags the two codes whose client_msg_id can never succeed again", () => {
    expect(isChatClientMsgIdSpent(err("chat_message_deleted"))).toBe(true);
    expect(isChatClientMsgIdSpent(err("idempotency_conflict"))).toBe(true);
    expect(isChatClientMsgIdSpent(err("forbidden"))).toBe(false);
  });
});
