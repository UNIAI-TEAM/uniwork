import { ApiError, errorCode } from "@uniwork/core/api";
import type { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CHAT_DOCUMENT_MAX_LABEL } from "./chat-file-accept";

type TFunction = ReturnType<typeof useTranslation>["t"];

/*
 * The server's error sentence is a log line, not UI copy: the generic codes
 * come back in English ("forbidden", "not found") and a few validation
 * messages in Vietnamese, whatever language the person reads. Chat shows a
 * sentence it owns for every code it knows, and the caller's own fallback —
 * written for the action that failed — for everything else.
 */
const KNOWN_CODES = new Set([
  "forbidden",
  "not_found",
  "conflict",
  "rate_limited",
  "idempotency_in_flight",
  "internal",
]);

export function chatErrorMessage(err: unknown, t: TFunction, fallback: string): string {
  const code = errorCode(err);
  if (code && KNOWN_CODES.has(code)) return t(`chat.errors.${code}`);
  // fetch() rejects with a TypeError when the request never reached the server.
  if (!(err instanceof ApiError) && err instanceof TypeError) return t("chat.errors.network");
  return fallback;
}

/**
 * The document send's own refusals (UNI-1966, contract §2.3) before the
 * shared table: the 403 storage quota, a 415 on the verified
 * format, a 422 source_not_saveable from share-as-document, and a 413
 * against the document ceiling (200 MB, not the chat 25).
 * Anything else falls through to chatErrorMessage's codes or the fallback.
 */
export function chatDocumentSendError(err: unknown, t: TFunction, fallback: string): string {
  const code = errorCode(err);
  switch (code) {
    case "quota_exceeded":
      return t("chat.errors.document_quota_exceeded");
    case "unsupported_media_type":
      return t("chat.errors.document_format");
    case "source_not_saveable":
      return t("chat.errors.source_not_saveable");
    case "too_large":
    case "file_too_large":
      return t("chat.file_too_large", { max: CHAT_DOCUMENT_MAX_LABEL });
  }
  if (err instanceof ApiError && err.status === 413) {
    return t("chat.file_too_large", { max: CHAT_DOCUMENT_MAX_LABEL });
  }
  return chatErrorMessage(err, t, fallback);
}

/**
 * The codes of `POST …/messages/document-link` that say the document itself
 * can no longer be sent (gone, no longer shareable, in the trash, shelved,
 * owned, a folder): the picker drops its stale rows after one of them.
 */
const DOCUMENT_LINK_UNSENDABLE = new Set([
  "document_shelved",
  "document_owned_by_work_product",
  "my_folder_locked",
  "folder_not_shareable",
]);

export function isChatDocumentLinkStale(err: unknown): boolean {
  const code = errorCode(err);
  return (
    code === "not_found" || code === "forbidden" || code === "document_archived" || (code !== undefined && DOCUMENT_LINK_UNSENDABLE.has(code))
  );
}

/**
 * The attach-from-Documents send's refusals (UNI-2012): a document that was
 * trashed, shelved, unshared or lost to the sender between the list and the
 * click. 403 `forbidden` covers both "cannot share it" and "cannot send in
 * this room" (the server answers one code). Anything else goes through the
 * document send table, then the shared one.
 */
export function chatDocumentLinkError(err: unknown, t: TFunction, fallback: string): string {
  const code = errorCode(err);
  if (code === "not_found") return t("chat.errors.document_link_not_found");
  if (code === "forbidden") return t("chat.errors.document_link_forbidden");
  if (code === "document_archived") return t("chat.errors.document_link_archived");
  if (code && DOCUMENT_LINK_UNSENDABLE.has(code)) return t("chat.errors.document_link_unsendable");
  // A used or deleted client_msg_id is not the person's mistake: the generic
  // retry sentence, and the picker mints a fresh key for the next send.
  if (code === "chat_message_deleted" || code === "idempotency_conflict") return fallback;
  return chatDocumentSendError(err, t, fallback);
}

/** The two refusals that mean the intent's client_msg_id can never succeed again. */
export function isChatClientMsgIdSpent(err: unknown): boolean {
  const code = errorCode(err);
  return code === "chat_message_deleted" || code === "idempotency_conflict";
}

export function toastChatError(err: unknown, t: TFunction, fallback: string): void {
  toast.error(chatErrorMessage(err, t, fallback));
}
