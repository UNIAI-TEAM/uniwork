import { ApiError, apiErrorMessage, errorCode } from "@uniwork/core/api";
import { getI18n } from "react-i18next";

/**
 * Server error codes the UI words itself, so the toast follows the reader's
 * language instead of the server's Vietnamese sentence. The codes are the ones
 * `server/internal/service` emits (errors.go, meeting_attendance.go,
 * meeting_duties.go, meeting_participant_media.go, meeting_minutes.go, email_hub*.go). provider_unavailable is
 * also meeting_admission.go's, so its copy stays generic.
 */
const API_ERROR_KEYS: Readonly<Record<string, string>> = {
  attendance_finalized: "meetings.governance.errors.attendance_finalized",
  not_meeting_clerk: "meetings.governance.errors.not_meeting_clerk",
  invalid_meeting_state: "meetings.governance.errors.invalid_meeting_state",
  guest_cannot_be_secretary: "meetings.governance.errors.guest_cannot_be_secretary",
  secretary_not_workspace_member: "meetings.governance.errors.secretary_not_workspace_member",
  cannot_lock_host_share: "meetings.moderationErrors.cannot_lock_host_share",
  cannot_mute_host: "meetings.moderationErrors.cannot_mute_host",
  participant_not_active: "meetings.moderationErrors.participant_not_active",
  provider_unavailable: "meetings.moderationErrors.provider_unavailable",
  minutes_exist: "meetings.minutes.errors.minutes_exist",
  minutes_missing: "meetings.minutes.errors.minutes_missing",
  minutes_edit_required: "meetings.minutes.errors.minutes_edit_required",
  minutes_unavailable: "meetings.minutes.errors.minutes_unavailable",
  email_hub_reauth_required: "email_hub.reconnect.error",
  email_hub_smtp_disabled: "email_hub.connect.error_smtp_disabled",
  // The generic codes errors.go answers with an English placeholder
  // ("forbidden", "internal error") whatever language the person reads.
  forbidden: "errors.api.forbidden",
  not_found: "errors.api.not_found",
  conflict: "errors.api.conflict",
  rate_limited: "errors.api.rate_limited",
  idempotency_in_flight: "errors.api.idempotency_in_flight",
  internal: "errors.api.internal",
};

/**
 * The localized sentence for a known code; for a request that never reached
 * the server, a network sentence; else the server's own sentence, but only to
 * a Vietnamese reader (the language the server writes) and never for a 5xx.
 * Undefined means the caller's localized fallback says it best.
 */
export function apiErrorCopy(err: unknown): string | undefined {
  const i18n = getI18n();
  const code = errorCode(err) ?? "";
  // "internal" is also what an answer without a JSON body carries (a proxy's 403
  // or 413 page, a file route's 404): only a 5xx is UniWork's own trouble; the
  // rest is the caller's to word, never with the HTTP status text.
  if (code === "internal" && err instanceof ApiError && err.status < 500) return undefined;
  const key = API_ERROR_KEYS[code];
  if (key && i18n?.exists(key)) return i18n.t(key);
  // fetch() rejects with a TypeError ("Failed to fetch", "Load failed") when the request never left.
  if (err instanceof TypeError) return i18n?.t("errors.api.network");
  if (!(err instanceof ApiError) || err.status >= 500) return undefined;
  if (i18n && !(i18n.resolvedLanguage ?? i18n.language).startsWith("vi")) return undefined;
  return apiErrorMessage(err);
}
