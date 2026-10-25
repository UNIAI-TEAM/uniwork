import type { useTranslation } from "react-i18next";
import type { Meeting } from "@uniwork/core/types/meeting";
import { scheduleWindowIso } from "../meeting-datetime";
import { clockRange, shortDay } from "../meeting-detail/format";
import type { MeetingDraft } from "./draft-model";
import type { DraftIssue } from "./draft-validation";
import { isHttpFailure, linksPending, type SubmitRun } from "./run-submit-plan";
import { apiErrorCopy } from "../../api-error-copy";
import type { FooterLine } from "./sheet-footer";

type T = ReturnType<typeof useTranslation>["t"];

/** Moves focus to the control an issue is about (the first one, in visual order). */
export function focusIssue(idPrefix: string, issue: DraftIssue) {
  const byField: Record<string, string> = { title: `${idPrefix}-title`, quorum: "sheet-quorum" };
  if (issue.field === "start" || issue.field === "end") {
    document.getElementById(`${idPrefix}-${issue.field}`)?.querySelector<HTMLInputElement>("input")?.focus();
    return;
  }
  document.getElementById(byField[issue.field] ?? issue.field)?.focus();
}

/** "Tiếp nối Giao ban tuần 43 · T5 22/10" under the follow-up title. */
export function headCaption(previous: Meeting, label: string, nowMs: number, t: T): string {
  return t("meetings.sheet.followUpCaption", { title: label, day: shortDay(previous.starts_at, nowMs, t, previous.timezone || undefined) });
}

/** "Duyệt kịch bản …", "T7 24/10", "14:00–15:00" under the result panel's heading. */
export function resultCaption(run: SubmitRun, draft: MeetingDraft, nowMs: number, t: T): { title: string; day: string; range: string } {
  const slot = scheduleWindowIso(draft.date, draft.start, draft.end, draft.timezone);
  const startsAt = run.meeting?.starts_at ?? slot.starts_at;
  const endsAt = run.meeting?.ends_at ?? slot.ends_at;
  const title = run.meeting?.title ?? draft.title;
  return { title, day: shortDay(startsAt, nowMs, t, draft.timezone), range: clockRange(startsAt, endsAt, draft.timezone) };
}

export function outcomeToast(run: SubmitRun, failed: boolean, t: T): string {
  if (run.plan.mode === "edit") return t(failed ? "meetings.sheet.savedWithIssues" : "meetings.changesSaved");
  return t(failed ? "meetings.sheet.createdWithIssues" : "meetings.created");
}

/**
 * The foot's one line, by priority: a submit error, the error summary (3+),
 * the running submit's status, then the edit count or the invitation note.
 */
export function footerLine(o: {
  run: SubmitRun | null;
  issues: DraftIssue[];
  submitted: boolean;
  setup: "create" | "followUp" | "edit";
  changes: number;
  caption: string;
  progress: { done: number; total: number } | null;
  t: T;
}): FooterLine {
  const { run, t } = o;
  if (run?.phase1Error) {
    if (!isHttpFailure(run.phase1Error)) return { tone: "destructive", text: t("meetings.sheet.unknownOutcome") };
    const reason = apiErrorCopy(run.phase1Error) ?? t("common.error");
    return { tone: "destructive", text: t(o.setup === "edit" ? "meetings.sheet.saveFailed" : "meetings.sheet.createFailed", { reason }) };
  }
  if (o.submitted && o.issues.length >= 3) {
    return { tone: "destructive", text: t("meetings.sheet.issuesLeft", { count: o.issues.length }) };
  }
  if (run && run.phase === "phase1") {
    return { tone: "status", text: t(run.slow ? "meetings.sheet.slow" : o.setup === "edit" ? "meetings.saving" : "meetings.sheet.creatingStatus") };
  }
  if (run && run.phase === "phase2" && o.progress) {
    const text = t("meetings.sheet.applyingStatus", o.progress);
    return { tone: "status", text: linksPending(run) ? `${text}\n${t("meetings.sheet.waitForLinks")}` : text };
  }
  if (o.setup === "edit") return { tone: "muted", text: o.changes ? t("meetings.sheet.changes", { count: o.changes }) : t("meetings.sheet.noChanges") };
  return { tone: "muted", text: o.caption };
}
