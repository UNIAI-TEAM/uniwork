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
};

/**
 * Plan refusals mean a different limit per operation: on the summary run the
 * AI quota or feature, on the task batch the plan's task count
 * (`Consume(tasks.max)` in the task command), where waiting for next month's
 * AI quota would not help.
 */
const PLAN_CODES: Readonly<Record<SummaryOperation, Readonly<Record<string, string>>>> = {
  generate: { quota_exceeded: "ai_quota_exceeded" },
  tasks: {
    quota_exceeded: "tasks_quota_exceeded",
    entitlement_required: "tasks_plan_inactive",
    subscription_inactive: "tasks_plan_inactive",
  },
};

/** The action items the batch was made of, so a refusal can name them. */
export interface SummaryErrorContext {
  items?: readonly { index: number; title: string }[];
}

/** Item indexes a refusal names in `fields.indexes`, in the order the server sent them. */
export function errorIndexes(err: unknown): number[] {
  const raw = errorFields(err)?.indexes;
  return Array.isArray(raw) ? raw.filter((v): v is number => Number.isInteger(v)) : [];
}

/**
 * An item whose title matches an open task refuses the whole batch. Name the
 * items when the server says which (`fields.indexes`), else the open task it
 * clashed with, so the host knows what to untick.
 */
function duplicateText(err: unknown, t: TFunction, context?: SummaryErrorContext): string {
  const indexes = errorIndexes(err);
  const titles = indexes
    .map((i) => context?.items?.find((item) => item.index === i)?.title?.trim())
    .filter((title): title is string => Boolean(title));
  if (titles.length > 0) {
    return t("meetings.summaryErrors.active_duplicate_items", { items: titles.map((x) => `“${x}”`).join(", ") });
  }
  const fields = errorFields(err) ?? {};
  const task = [fields.identifier, fields.title]
    .filter((v): v is string => typeof v === "string" && v.trim() !== "")
    .join(" – ");
  return task
    ? t("meetings.summaryErrors.active_duplicate_task", { task })
    : t("meetings.summaryErrors.active_duplicate");
}

/**
 * The sentence both meeting screens (detail panel, in-room Copilot) show for
 * a failed summary run or task batch: in the reader's language, saying what
 * to do next (docs/conventions.md › Error messages). The server's own message
 * is never shown: it is fixed Vietnamese at best.
 */
export function summaryErrorText(
  err: unknown,
  t: TFunction,
  op: SummaryOperation,
  context?: SummaryErrorContext,
): string {
  const raw = errorCode(err) ?? "";
  const plan = PLAN_CODES[op][raw];
  if (plan) return t(`meetings.summaryErrors.${plan}`);
  const code = ALIASES[raw] ?? raw;
  if (op === "tasks" && code === "active_duplicate_task") return duplicateText(err, t, context);
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
