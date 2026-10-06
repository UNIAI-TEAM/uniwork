import { apiErrorMessage, errorCode } from "@uniwork/core/api";
import { getI18n } from "react-i18next";

/**
 * Server error codes the UI words itself, so the toast follows the reader's
 * language instead of the server's Vietnamese sentence. The codes are the ones
 * `server/internal/service` emits (errors.go, meeting_attendance.go,
 * meeting_duties.go, meeting_participant_media.go). provider_unavailable is
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
};

/** The localized sentence for a known code, else the server's own message. */
export function apiErrorCopy(err: unknown): string | undefined {
  const key = API_ERROR_KEYS[errorCode(err) ?? ""];
  const i18n = getI18n();
  if (key && i18n?.exists(key)) return i18n.t(key);
  return apiErrorMessage(err);
}
