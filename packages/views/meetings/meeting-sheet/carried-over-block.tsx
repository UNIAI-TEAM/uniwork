"use client";
import { CircleDashed } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMembers } from "@uniwork/core/workspaces";
import { useMeetingActionItems } from "@uniwork/core/meetings/action-items";
import { useMeetingSummary } from "@uniwork/core/meetings/summary";
import type { Meeting, MeetingEvidenceRef } from "@uniwork/core/types/meeting";
import { meetingAvatarTint } from "../meeting-detail/avatar-tint";
import { clock, shortDay } from "../meeting-detail/format";
import { useEvidenceAt } from "../meeting-detail/overview/evidence-times";
import { TextButton } from "../meeting-detail/ui/text-button";
import { MeetingPersonAvatar } from "../meeting-person";
import { SECTION_TITLE } from "./sheet-styles";
import { WordClip } from "./word-clip";

/** "Giao ban tuần 43 — Ra mắt SaoMai POS 3.0" → "Giao ban tuần 43": a series title's own part. */
export function seriesShortTitle(title: string): string {
  const full = title.trim();
  return full.split(/\s+[—–]\s+/)[0] || full;
}

/** The open questions of the previous meeting, when the viewer may read its AI content. */
export function usePreviousQuestions(previous: Meeting): { text: string; evidence: MeetingEvidenceRef[] }[] {
  const readable = previous.ai_content_readable !== false;
  const { data } = useMeetingSummary(readable ? previous.id : "");
  return readable ? (data?.open_questions ?? []) : [];
}

function QuestionRow({ meetingId, text, refs }: { meetingId: string; text: string; refs: MeetingEvidenceRef[] }) {
  const { at } = useEvidenceAt(meetingId, refs);
  return (
    <li className="grid min-h-8 grid-cols-[44px_minmax(0,1fr)] items-center">
      <span className="-ml-1.5 inline-flex h-5 w-fit items-center px-1.5 font-mono text-caption font-medium text-muted-foreground tabular-nums">{at ? clock(at) : ""}</span>
      <WordClip className="text-body" text={text} />
    </li>
  );
}

/**
 * "Mang sang từ Giao ban tuần 43" (create brief §3.5): the previous
 * meeting's converted tasks still open, its open questions with their times,
 * and what will not carry over — the items nobody assigned yet.
 */
export function CarriedOverBlock({
  workspaceId,
  previous,
  nowMs,
  previousLabel,
  onReviewFirst,
}: {
  workspaceId: string;
  previous: Meeting;
  nowMs: number;
  /** "tuần 43" when the title names its week, else the short title. */
  previousLabel: string;
  onReviewFirst?: () => void;
}) {
  const { t } = useTranslation();
  const { data } = useMeetingActionItems(previous.id);
  const { data: members = [] } = useMembers(workspaceId);
  const questions = usePreviousQuestions(previous);
  const tasks = (data?.items ?? [])
    .filter((i) => i.status === "CONVERTED" && i.task && !i.task.done)
    // Soonest due first; undated last.
    .sort((a, b) => (a.task!.due_date || "9999").localeCompare(b.task!.due_date || "9999"));
  const pending = data?.counts.pending ?? 0;
  const short = seriesShortTitle(previous.title);
  if (!tasks.length && !questions.length && !pending) return null;
  const nameOf = (id: string | null | undefined) => members.find((m) => m.user_id === id)?.display_name ?? "";
  return (
    <section className="mt-6" aria-labelledby="sheet-carried-title">
      <h3 id="sheet-carried-title" className={SECTION_TITLE}>
        {t("meetings.sheet.carriedTitle", { title: short })}
      </h3>
      <p className="mt-0.5 text-caption text-muted-foreground">{t("meetings.sheet.carriedHint")}</p>
      {tasks.length ? (
        <>
          <p className="mt-4 mb-1 text-label font-medium">
            {t("meetings.sheet.carriedTasks")} <span className="ml-1 text-caption font-normal text-muted-foreground">{tasks.length}</span>
          </p>
          <ul>
            {tasks.map((item) => {
              const task = item.task!;
              const owner = nameOf(task.assignee_id);
              const day = task.due_date && /^\d{4}-\d{2}-\d{2}$/.test(task.due_date) ? shortDay(`${task.due_date}T12:00:00Z`, nowMs, t) : "";
              const status = t(`tasks.status_${task.status ?? ""}`, { defaultValue: t("tasks.status_todo") });
              return (
                // Phone: the title wraps and the status chip drops under it (CreateFollowUp at 390).
                <li
                  key={item.id}
                  className="grid min-h-9 grid-cols-[44px_minmax(0,1fr)_124px] items-center max-sm:grid-cols-[44px_minmax(0,1fr)] max-sm:py-1.5 max-sm:[&>:first-child]:mt-0.5 max-sm:[&>:first-child]:self-start"
                >
                  {owner ? (
                    <MeetingPersonAvatar name={owner} size={20} tint={meetingAvatarTint(task.assignee_id, members)} />
                  ) : (
                    <span />
                  )}
                  <span className="truncate pr-4 text-body max-sm:pr-0 max-sm:whitespace-normal">
                    {owner ? <span className="sr-only">{owner}: </span> : null}
                    {task.title ?? item.title}
                  </span>
                  <span className="inline-flex h-5.5 w-fit items-center rounded-sm bg-muted px-2 text-caption font-medium whitespace-nowrap tabular-nums max-sm:col-start-2 max-sm:mt-1">
                    {day ? `${status} · ${day}` : status}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      {questions.length ? (
        <>
          <p className="mt-4 mb-1 text-label font-medium">
            {t("meetings.sheet.carriedQuestions")} <span className="ml-1 text-caption font-normal text-muted-foreground">{questions.length}</span>
          </p>
          <ul>
            {questions.map((q, i) => (
              <QuestionRow key={i} meetingId={previous.id} text={q.text} refs={q.evidence} />
            ))}
          </ul>
        </>
      ) : null}
      {pending > 0 ? (
        <div className="mt-3.5 flex items-center gap-2 text-caption text-muted-foreground">
          <CircleDashed aria-hidden className="size-3.5 shrink-0" />
          <p>
            {t("meetings.sheet.carriedPending", { count: pending, title: previousLabel })}{" "}
            {onReviewFirst ? (
              // The board draws the arrow as a "›" glyph in the link's text (CreateFollowUp).
              <TextButton className="py-0 whitespace-nowrap" aria-label={t("meetings.sheet.carriedReview")} onClick={onReviewFirst}>
                {t("meetings.sheet.carriedReview")} ›
              </TextButton>
            ) : null}
          </p>
        </div>
      ) : null}
    </section>
  );
}
