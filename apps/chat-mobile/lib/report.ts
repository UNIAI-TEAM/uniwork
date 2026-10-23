// Reporting a message or a person (Apple 1.2, Google Play's user-generated
// content policy): the closed reason set the server's chat_reports CHECK
// holds (server/internal/service/chat_reports.go › ChatReportReasons) and the
// request body. Pure; the sheet is components/chat/report-sheet.tsx.
export const REPORT_REASONS = ["spam", "harassment", "hate", "sexual", "violence", "self_harm", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** The server's cap on the reporter's own words (chatReportDetailsMax). */
export const REPORT_DETAILS_MAX = 1000;

/** A message names its sender as the person reported; a person is reported on their own. */
export type ReportTarget = { kind: "message"; messageId: string; name: string } | { kind: "user"; userId: string; name: string };

export interface ReportBody {
  message_id?: string;
  user_id?: string;
  reason: ReportReason;
  details?: string;
}

export function reportBody(target: ReportTarget, reason: ReportReason, details: string): ReportBody {
  const words = details.trim().slice(0, REPORT_DETAILS_MAX);
  return {
    ...(target.kind === "message" ? { message_id: target.messageId } : { user_id: target.userId }),
    reason,
    ...(words ? { details: words } : {}),
  };
}
