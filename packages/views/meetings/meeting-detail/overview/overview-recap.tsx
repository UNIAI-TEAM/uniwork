"use client";
import { useId, useState, type ReactNode } from "react";
import { Check, ChevronRight, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeeting } from "@uniwork/core/meetings";
import { paths } from "@uniwork/core/paths";
import type { MeetingMotion, MeetingSummary, MeetingSummaryDecision } from "@uniwork/core/types/meeting";
import { cn } from "@uniwork/ui/lib/utils";
import { useOptionalWorkspace } from "../../../layout/workspace-context";
import { AppLink } from "../../../navigation";
import { useDetail } from "../detail-context";
import { clock } from "../format";
import { Section } from "../ui/section";
import { TextButton } from "../ui/text-button";
import { TimeChipMore } from "../ui/time-chip";
import { TimeGutterRow } from "../ui/time-row";
import { defersToNextMeeting, seriesShortTitle } from "./defers-to-next";
import { EvidenceTimeChip } from "./evidence-chip";

const ROWS = "flex flex-col gap-2";
/** A 24-tall text button whose 44 target is drawn around it, so a coarse pointer does not move the rows (kit `.board .text-btn::before`). */
export const TEXT_BUTTON_HIT = "relative before:absolute before:-inset-x-2 before:-inset-y-2.5 pointer-coarse:min-h-0";
// The chip cell as a flex box: its line box would otherwise add the inline chip's descent (row 23 → 22).
const CHIP_ROW = "[&>span]:flex";

/**
 * A recap section: the kit's section on a wide page; on a phone one row of
 * the accordion (kit `.acc` / `.disc`), the heading a disclosure button.
 */
export function RecapSection({
  id,
  title,
  count,
  phoneOpen = false,
  children,
}: {
  id: string;
  title: string;
  count: number;
  phoneOpen?: boolean;
  children: ReactNode;
}) {
  const { isPhone } = useDetail();
  const [open, setOpen] = useState(phoneOpen);
  if (!isPhone) {
    return (
      <Section id={id} title={title} count={count}>
        {children}
      </Section>
    );
  }
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-6">
      <h2 id={`${id}-heading`}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          onClick={() => setOpen((v) => !v)}
          className="flex min-h-13 w-full items-center gap-2 rounded-sm text-left"
        >
          <span className="text-title-sm font-semibold">{title}</span>
          <span className="text-caption text-muted-foreground">{count}</span>
          <ChevronRight aria-hidden className={cn("ml-auto size-4 text-muted-foreground transition-transform", open && "rotate-90")} />
        </button>
      </h2>
      {open ? (
        <div id={`${id}-body`} className="pb-4">
          {children}
        </div>
      ) : null}
    </section>
  );
}

/** A claim the AI picked out: its time chip in the gutter, "+n" after the text when it rests on more. */
function ClaimRow({
  meetingId,
  claim,
  more = true,
  children,
}: {
  meetingId: string;
  claim: MeetingSummaryDecision;
  /** "+n" after the text (decisions); a question carries its count in the chip's name only (board Main). */
  more?: boolean;
  children?: ReactNode;
}) {
  return (
    <TimeGutterRow
      className={CHIP_ROW}
      time={claim.evidence.length > 0 ? <EvidenceTimeChip meetingId={meetingId} refs={claim.evidence} /> : undefined}
    >
      <p>
        {claim.text}
        {more ? <TimeChipMore count={claim.evidence.length - 1} /> : null}
      </p>
      {children}
    </TimeGutterRow>
  );
}

/** "Xem thêm n" under the rows, in line with their text (kit `.row-more`). */
function MoreRows({ hidden, open, onToggle }: { hidden: number; open: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const { isPhone } = useDetail();
  if (hidden <= 0 && !open) return null;
  return (
    <div className={cn("pl-14 @max-[37.5rem]/meeting:pl-13", !isPhone && "mt-1")}>
      <TextButton className={TEXT_BUTTON_HIT} aria-expanded={open} onClick={onToggle}>
        {open ? t("meetings.detail.overview.showLess") : t("meetings.detail.overview.showMore", { count: hidden })}
      </TextButton>
    </div>
  );
}

const GROUP = "mb-1 text-caption font-medium text-muted-foreground";

/** A closed vote: when it closed, what was put, and the recorded result (never the AI's reading). */
function VotedRow({ motion }: { motion: MeetingMotion }) {
  const { t } = useTranslation();
  const passed = motion.result?.outcome === "PASSED";
  return (
    <TimeGutterRow time={clock(motion.closed_at) || undefined}>
      <p>{motion.title}</p>
      <p className="mt-0.5 text-caption text-muted-foreground">
        {motion.result ? (
          <span className={cn("mr-1 inline-flex items-center gap-1 font-medium", passed ? "text-success" : "text-destructive")}>
            {passed ? <Check aria-hidden className="size-3" /> : <X aria-hidden className="size-3" />}
            {t(passed ? "meetings.governance.outcome_PASSED" : "meetings.governance.outcome_FAILED")}
          </span>
        ) : null}
        {t("meetings.governance.votedTally", {
          yes: motion.result?.yes ?? 0,
          no: motion.result?.no ?? 0,
          abstain: motion.result?.abstain ?? 0,
        })}
      </p>
    </TimeGutterRow>
  );
}

/** Quyết định: the closed votes first, then the AI's decisions; 8 rows (3 on a phone) and "Xem thêm n". */
function Decisions({ meetingId, voted, decisions }: { meetingId: string; voted: readonly MeetingMotion[]; decisions: readonly MeetingSummaryDecision[] }) {
  const { t } = useTranslation();
  const { isPhone } = useDetail();
  const [all, setAll] = useState(false);
  const total = voted.length + decisions.length;
  if (total === 0) return null;
  const cap = all ? total : isPhone ? 3 : 8;
  const shownVotes = voted.slice(0, cap);
  const shownAi = decisions.slice(0, Math.max(0, cap - shownVotes.length));
  return (
    <RecapSection id="decisions" title={t("meetings.decisions")} count={total} phoneOpen>
      {shownVotes.length > 0 ? (
        <>
          <p className={GROUP}>{t("meetings.governance.votedDecisions")}</p>
          <ol className={ROWS}>
            {shownVotes.map((m) => (
              <VotedRow key={m.id} motion={m} />
            ))}
          </ol>
          {shownAi.length > 0 ? <p className={cn(GROUP, "mt-4")}>{t("meetings.aiDecisions")}</p> : null}
        </>
      ) : null}
      {shownAi.length > 0 ? (
        <ol className={ROWS}>
          {shownAi.map((d, i) => (
            <ClaimRow key={i} meetingId={meetingId} claim={d} />
          ))}
        </ol>
      ) : null}
      <MoreRows hidden={total - cap} open={all} onToggle={() => setAll((v) => !v)} />
    </RecapSection>
  );
}

/** Câu hỏi còn mở; a question that waits for the next meeting links to it (PLAN D3). */
function OpenQuestions({ meetingId, questions }: { meetingId: string; questions: readonly MeetingSummaryDecision[] }) {
  const { t } = useTranslation();
  const { meeting } = useDetail();
  const workspace = useOptionalWorkspace()?.workspace;
  const nextId = meeting.next_meeting_id ?? "";
  const next = useMeeting(nextId, { enabled: nextId !== "" && questions.length > 0 }).data;
  if (questions.length === 0) return null;
  const nextHref = next && workspace ? paths.workspace(workspace.organization_slug, workspace.slug).meeting(next.id) : null;
  return (
    <RecapSection id="open-questions" title={t("meetings.detail.overview.openQuestions")} count={questions.length}>
      <ol className={ROWS}>
        {questions.map((q, i) => (
          <ClaimRow key={i} meetingId={meetingId} claim={q} more={false}>
            {nextHref && next && defersToNextMeeting(q.text) ? (
              <p className="mt-0.5 flex min-h-5 items-center">
                <AppLink href={nextHref} className="inline-flex items-center gap-0.5 rounded-xs text-caption text-primary hover:underline">
                  {t("meetings.detail.overview.discussAt", { title: seriesShortTitle(next.title, meeting.title) })}
                  <ChevronRight aria-hidden className="size-3" />
                </AppLink>
              </p>
            ) : null}
          </ClaimRow>
        ))}
      </ol>
    </RecapSection>
  );
}

/** One topic: its start chip, then a disclosure "Title · n ý" that opens its points (muted: AI prose). */
function TopicRow({ meetingId, topic }: { meetingId: string; topic: NonNullable<MeetingSummary["topics"]>[number] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const time = topic.start_at ? clock(topic.start_at) : undefined;
  const chip = topic.start ? <EvidenceTimeChip meetingId={meetingId} refs={[topic.start]} time={time} /> : time;
  if (topic.points.length === 0) {
    return (
      <TimeGutterRow className={CHIP_ROW} time={chip}>
        <p className="font-medium">{topic.title}</p>
      </TimeGutterRow>
    );
  }
  return (
    <TimeGutterRow className={CHIP_ROW} time={chip}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
        className="group/topic block w-full rounded-sm text-left font-medium"
      >
        <span className="decoration-border underline-offset-3 group-hover/topic:underline">{topic.title}</span>
        <span className="ml-2 text-caption font-normal whitespace-nowrap text-muted-foreground">
          {t("meetings.detail.overview.points", { count: topic.points.length })}
          <ChevronRight aria-hidden className={cn("ml-1 inline-block size-3.5 -translate-y-px transition-transform", open && "rotate-90")} />
        </span>
      </button>
      {open ? (
        <ul id={bodyId} className="mt-1 flex flex-col gap-1 text-muted-foreground">
          {topic.points.map((p, i) => (
            <li key={i} className="text-body-lg">
              {p.text}
              {p.evidence.length > 0 ? (
                <span className="ml-1.5 inline-block align-baseline">
                  <EvidenceTimeChip meetingId={meetingId} refs={p.evidence} />
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </TimeGutterRow>
  );
}

/** Whether the recap draws any section (on a phone: whether there is an accordion for the notes to join). */
export function recapDrawn(summary: MeetingSummary | null, voted: readonly MeetingMotion[]): boolean {
  return voted.length + (summary?.decisions?.length ?? 0) + (summary?.open_questions?.length ?? 0) + (summary?.topics?.length ?? 0) > 0;
}

/**
 * Quyết định → Câu hỏi còn mở → Chủ đề, from the summary and the closed votes; an empty one is not drawn.
 * `children` follow it — on a phone inside its accordion (the closed notes, the history row).
 */
export function OverviewRecap({
  summary,
  voted,
  children,
}: {
  summary: MeetingSummary | null;
  voted: readonly MeetingMotion[];
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const { meeting, isPhone } = useDetail();
  const topics = summary?.topics ?? [];
  const body = (
    <>
      <Decisions meetingId={meeting.id} voted={voted} decisions={summary?.decisions ?? []} />
      <OpenQuestions meetingId={meeting.id} questions={summary?.open_questions ?? []} />
      {topics.length > 0 ? (
        <RecapSection id="topics" title={t("meetings.summaryTopics")} count={topics.length}>
          <ol className={ROWS}>
            {topics.map((topic, i) => (
              <TopicRow key={i} meetingId={meeting.id} topic={topic} />
            ))}
          </ol>
        </RecapSection>
      ) : null}
    </>
  );
  // On a phone the recap is one accordion, 24 under the section above it (kit `.acc`).
  return isPhone && recapDrawn(summary, voted) ? (
    <div className="mt-6">
      {body}
      {children}
    </div>
  ) : (
    <>
      {body}
      {children}
    </>
  );
}
