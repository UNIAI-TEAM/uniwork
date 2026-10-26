"use client";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeeting } from "@uniwork/core/meetings";
import { useMeetingSummary } from "@uniwork/core/meetings/summary";
import { useMeetingActionItems, useMeetingCarriedOverItems } from "@uniwork/core/meetings/action-items";
import { paths } from "@uniwork/core/paths";
import { useWorkspace } from "../../../layout/workspace-context";
import { AppLink } from "../../../navigation";
import { splitIsoLocal } from "../../meeting-datetime";
import { MeetingPersonAvatar } from "../../meeting-person";
import { meetingAvatarTint } from "../avatar-tint";
import { useDetail } from "../detail-context";
import { clock, clockRange, shortDay } from "../format";
import { EvidenceTimeChip } from "../overview/evidence-chip";
import { Byline, Section } from "../ui/section";
import { TimeGutterRow } from "../ui/time-row";
import { shortMeetingTitle, TaskChip } from "./carried-over-brief";
import { ScribeSign } from "../../scribe-sign";

const SUB = "flex items-baseline gap-2 [&>h3]:text-body [&>h3]:font-medium";

/** "22/10": the day and month of an instant in the viewer's zone. */
function dayMonth(iso: string): string {
  if (!Number.isFinite(Date.parse(iso))) return "";
  const [, month, day] = splitIsoLocal(iso).date.split("-");
  return `${day}/${month}`;
}

/**
 * A follow-up's brief (SeriesBrief): what the previous meeting of the series
 * left — its unfinished tasks with the moment each was agreed, its open
 * questions from the AI summary, and one line to its decisions. Only for a
 * meeting with `previous_meeting_id` (a project sibling such as M3 is not a
 * follow-up and shows plain "Việc còn tồn"). The questions and decisions hide
 * when the viewer may not read that meeting's AI content (403).
 */
export function SeriesBrief({ previousId }: { previousId: string }) {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const { meeting, memberIndex, now } = useDetail();
  const previous = useMeeting(previousId).data;
  const carried = useMeetingCarriedOverItems(meeting.id).data?.items ?? [];
  const evidenceOf = new Map((useMeetingActionItems(previousId).data?.items ?? []).map((item) => [item.id, item.evidence]));
  const summary = useMeetingSummary(previousId);
  if (!previous) return null;

  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  const title = shortMeetingTitle(previous.title);
  const start = previous.actual_start_at ?? previous.starts_at;
  const end = previous.actual_end_at ?? previous.ends_at;
  const tasks = carried.filter((item) => item.meeting.id === previousId);
  const read = summary.isError ? null : summary.data;
  const questions = read?.open_questions ?? [];
  const decisions = read?.decisions?.length ?? 0;
  const chip = (refs: Parameters<typeof EvidenceTimeChip>[0]["refs"] | undefined) =>
    refs && refs.length > 0 ? <EvidenceTimeChip meetingId={previousId} refs={refs} /> : undefined;
  // Phone: a task row's chip sits 12 below its top, level with the title's first line (kit `.trow > .chip-time` @599).
  const taskChip = (refs: Parameters<typeof chip>[0]) => {
    const node = chip(refs);
    return node ? <span className="flex @max-[37.5rem]/meeting:mt-2.75">{node}</span> : undefined;
  };

  return (
    <Section
      id="tu-cuoc-hop-truoc"
      // The heading never wraps; on a phone "Mở cuộc họp" drops to its own line (kit `.series .sh`).
      className="[&_h2]:whitespace-nowrap @max-[37.5rem]/meeting:[&>div:first-child]:flex-wrap @max-[37.5rem]/meeting:[&>div:first-child]:gap-y-0.5 @max-[37.5rem]/meeting:[&>div:first-child>div]:basis-full"
      title={t("meetings.detail.carriedOver.seriesFrom", { title })}
      count={[shortDay(start, now, t), clockRange(start, end)].filter(Boolean).join(" · ")}
      end={
        <AppLink
          href={ws.meeting(previousId)}
          className="inline-flex items-center gap-1 rounded-xs py-1 text-caption font-medium whitespace-nowrap text-primary underline-offset-2 hover:underline pointer-coarse:min-h-11 [&_svg]:size-3"
        >
          {t("meetings.detail.carriedOver.openMeeting")}
          <ChevronRight aria-hidden />
        </AppLink>
      }
    >
      {tasks.length > 0 ? (
        <>
          <div className={`${SUB} mt-6`}>
            <h3 id="series-tasks">{t("meetings.detail.carriedOver.unfinished")}</h3>
            <span className="text-caption text-muted-foreground">{tasks.length}</span>
          </div>
          <ul aria-labelledby="series-tasks" className="mt-2 flex flex-col">
            {tasks.map(({ action_item_id, task }) => {
              const owner = memberIndex.memberOf(task.assignee_id)?.display_name ?? t("meetings.detail.carriedOver.unassigned");
              return (
                <TimeGutterRow
                  key={action_item_id}
                  time={taskChip(evidenceOf.get(action_item_id))}
                  className="items-center @max-[37.5rem]/meeting:items-start [&>div]:max-w-none"
                >
                  <AppLink
                    href={ws.task(task.id)}
                    className="group -mx-2 grid min-h-11 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 rounded-md px-2 text-body text-foreground hover:bg-surface-hover @max-[37.5rem]/meeting:grid-cols-1 @max-[37.5rem]/meeting:gap-y-1 @max-[37.5rem]/meeting:py-2.5"
                  >
                    <span className="min-w-0 truncate font-medium @max-[37.5rem]/meeting:whitespace-normal">
                      {task.title}
                    </span>
                    <span className="sr-only">, {owner}</span>
                    {/* Desktop: two grid cells; phone: one line under the title (kit `.task-end`). */}
                    <span className="contents @max-[37.5rem]/meeting:flex @max-[37.5rem]/meeting:items-center @max-[37.5rem]/meeting:gap-2">
                      <MeetingPersonAvatar name={owner} size={20} tint={meetingAvatarTint(task.assignee_id, memberIndex.members)} />
                      <TaskChip task={task} pill />
                    </span>
                  </AppLink>
                </TimeGutterRow>
              );
            })}
          </ul>
        </>
      ) : null}

      {questions.length > 0 ? (
        <>
          <div className={`${SUB} mt-6`}>
            <h3 id="series-questions">{t("meetings.detail.carriedOver.openQuestions")}</h3>
            <span className="text-caption text-muted-foreground">{questions.length}</span>
          </div>
          {read?.created_at ? (
            <Byline className="mt-2">
              <ScribeSign />
              <span>
                {t("meetings.detail.carriedOver.questionsByline", {
                  title,
                  time: clock(read.created_at),
                  date: dayMonth(read.created_at),
                })}
              </span>
            </Byline>
          ) : null}
          <ol aria-labelledby="series-questions" className="mt-3 flex flex-col gap-2">
            {questions.map((question, index) => (
              <TimeGutterRow key={index} time={chip(question.evidence)}>
                {question.text}
              </TimeGutterRow>
            ))}
          </ol>
        </>
      ) : null}

      {decisions > 0 ? (
        <AppLink
          href={`${ws.meeting(previousId)}?section=summary`}
          className="-mx-2 mt-3 flex min-h-11 items-center gap-2 rounded-md px-2 text-foreground hover:bg-surface-hover"
        >
          <span className="text-body font-medium">{t("meetings.detail.carriedOver.decisions")}</span>
          <span className="text-caption text-muted-foreground">{decisions}</span>
          <span className="ml-auto inline-flex items-center gap-0.5 text-caption font-medium text-primary [&_svg]:size-3">
            {t("meetings.detail.carriedOver.view")}
            <ChevronRight aria-hidden />
          </span>
        </AppLink>
      ) : null}
    </Section>
  );
}
