import type { useTranslation } from "react-i18next";
import { errorCode, errorFields } from "@uniwork/core/api/http";

type TFunction = ReturnType<typeof useTranslation>["t"];

/** Which call failed: the summary run or the summary-to-tasks batch. */
export type SummaryOperation = "generate" | "tasks";

/** Codes the summary run and the task batch answer with, each with its own sentence. */
const CODES = new Set([
  "ai_not_configured",
  "ai_failed",
  "ai_timeout",
  "summary_no_source",
  "summary_in_progress",
  "entitlement_required",
  "ai_quota_exceeded",
  "rate_limited",
  "summary_superseded",
  "summary_item_already_converted",
  "not_meeting_host",
  "forbidden",
  "assignee_not_member",
  "invalid_request",
]);

/** Older servers and the AI gateway name some of the same failures differently. */
const ALIASES: Readonly<Record<string, string>> = {
  ai_disabled: "ai_not_configured",
  ai_provider_timeout: "ai_timeout",
  ai_provider_error: "ai_failed",
  ai_output_invalid: "ai_failed",
  nothing_to_summarize: "summary_no_source",
  quota_exceeded: "ai_quota_exceeded",
};

/**
 * The sentence both meeting screens (detail panel, in-room Copilot) show for
 * a failed summary run or task batch: in the reader's language, saying what
 * to do next (docs/conventions.md › Error messages). The server's own message
 * is never shown: it is fixed Vietnamese at best.
 */
export function summaryErrorText(err: unknown, t: TFunction, op: SummaryOperation): string {
  const raw = errorCode(err) ?? "";
  const code = ALIASES[raw] ?? raw;
  if (code === "ai_rate_limited") {
    const wait = Number(errorFields(err)?.retry_after);
    return Number.isFinite(wait) && wait > 0
      ? t("meetings.summaryErrors.ai_rate_limited", { seconds: Math.ceil(wait) })
      : t("meetings.summaryErrors.ai_rate_limited_later");
  }
  if (code === "not_found") {
    return t(op === "tasks" ? "meetings.summaryErrors.not_found_tasks" : "meetings.summaryErrors.not_found_generate");
  }
  if (CODES.has(code)) return t(`meetings.summaryErrors.${code}`);
  return t(op === "tasks" ? "meetings.summaryErrors.tasksFailed" : "meetings.summaryErrors.generateFailed");
}
