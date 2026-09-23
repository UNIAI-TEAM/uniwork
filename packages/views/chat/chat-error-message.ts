import { ApiError, errorCode } from "@uniwork/core/api";
import type { useTranslation } from "react-i18next";
import { toast } from "sonner";

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

export function toastChatError(err: unknown, t: TFunction, fallback: string): void {
  toast.error(chatErrorMessage(err, t, fallback));
}
