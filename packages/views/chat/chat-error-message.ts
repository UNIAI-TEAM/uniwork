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
 * shared table: a 422 batch cap, the 403 storage quota, a 415 on the verified
 * format, and a 413 against the document ceiling (200 MB, not the chat 25).
 * Anything else falls through to chatErrorMessage's codes or the fallback.
 */
export function chatDocumentSendError(err: unknown, t: TFunction, fallback: string): string {
  const code = errorCode(err);
  switch (code) {
    case "share_batch_too_large":
      return t("chat.errors.share_batch_too_large");
    case "quota_exceeded":
      return t("chat.errors.document_quota_exceeded");
    case "unsupported_media_type":
      return t("chat.errors.document_format");
    case "too_large":
    case "file_too_large":
      return t("chat.file_too_large", { max: CHAT_DOCUMENT_MAX_LABEL });
  }
  if (err instanceof ApiError && err.status === 413) {
    return t("chat.file_too_large", { max: CHAT_DOCUMENT_MAX_LABEL });
  }
  return chatErrorMessage(err, t, fallback);
}

export function toastChatError(err: unknown, t: TFunction, fallback: string): void {
  toast.error(chatErrorMessage(err, t, fallback));
}
