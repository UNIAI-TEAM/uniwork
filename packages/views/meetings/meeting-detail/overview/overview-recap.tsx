"use client";
import { useId, useState, type ReactNode } from "react";
import { CalendarClock, Check, ChevronRight, MessageCircleQuestionMark, X, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeeting } from "@uniwork/core/meetings";
import { paths } from "@uniwork/core/paths";
import type { MeetingMotion, MeetingSummary, MeetingSummaryDecision } from "@uniwork/core/types/meeting";
import { IconTile, type IconTileTone } from "@uniwork/ui/components/common/icon-tile";
import { cn } from "@uniwork/ui/lib/utils";
import { useOptionalWorkspace } from "../../../layout/workspace-context";
import { AppLink } from "../../../navigation";
import { useDetail } from "../detail-context";
import { clock } from "../format";
import { Section } from "../ui/section";
import { TextButton } from "../ui/text-button";
import { TimeChipMore } from "../ui/time-chip";
import { defersToNextMeeting, seriesShortTitle } from "./defers-to-next";
import { EvidenceTimeChip } from "./evidence-chip";

const ROWS = "flex flex-col gap-4";
/** A 24-tall text button whose 44 target is drawn around it, so a coarse pointer does not move the rows (kit `.board .text-btn::before`). */
export const TEXT_BUTTON_HIT = "relative before:absolute before:-inset-x-2 before:-inset-y-2.5 pointer-coarse:min-h-0";

/**
 * One recap item: a round mark that says what kind of thing it is (✓ a
 * decision, ? a question, a number for a topic), the text in body-lg, and a
 * meta line under it — the time chip into the transcript and what follows it.
 */
function MarkedRow({ mark, meta, after, children }: { mark: ReactNode; meta?: ReactNode; after?: ReactNode; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)] items-start gap-x-3">
      {mark}
      <div className="min-w-0 max-w-150 pt-0.5 text-body-lg">
        {children}
        {meta ? <div className="mt-1 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1">{meta}</div> : null}
        {after}
      </div>
    </li>
  );
}

function RowMark({ icon, tone }: { icon: LucideIcon; tone: IconTileTone }) {
  return <IconTile icon={icon} size="sm" shape="circle" tone={tone} />;
}

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

/** A claim the AI picked out: its mark, the text, and under it the time chip, "+n" when it rests on more. */
function ClaimRow({
  meetingId,
  claim,
  mark,
  more = true,
  children,
}: {
  meetingId: string;
  claim: MeetingSummaryDecision;
  mark: ReactNode;
  /** "+n" after the text (decisions); a question carries its count in the chip's name only (board Main). */
  more?: boolean;
  children?: ReactNode;
}) {
  const chip = claim.evidence.length > 0 ? <EvidenceTimeChip meetingId={meetingId} refs={claim.evidence} /> : null;
  return (
    <MarkedRow
      mark={mark}
      meta={
        chip || children ? (
          <>
            {/* The chip bleeds 6px left, so its digits sit on the text's edge. */}
            {chip ? (
              <span className="-ml-1.5 flex items-center">
                {chip}
                {more ? <TimeChipMore count={claim.evidence.length - 1} /> : null}
              </span>
            ) : null}
            {children}
          </>
        ) : undefined
      }
    >
      <p>{claim.text}</p>
    </MarkedRow>
  );
}

/** "Xem thêm n" under the rows, in line with their text (kit `.row-more`). */
function MoreRows({ hidden, open, onToggle }: { hidden: number; open: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const { isPhone } = useDetail();
  if (hidden <= 0 && !open) return null;
  return (
    <div className={cn("pl-10", !isPhone && "mt-2")}>
      <TextButton className={TEXT_BUTTON_HIT} aria-expanded={open} onClick={onToggle}>
        {open ? t("meetings.detail.overview.showLess") : t("meetings.detail.overview.showMore", { count: hidden })}
      </TextButton>
    </div>
  );
}

const GROUP = "mb-1 text-caption font-medium text-muted-foreground";

const TALLY = [
  { key: "yes", label: "meetings.governance.tallyYes", fill: "bg-success" },
  { key: "no", label: "meetings.governance.tallyNo", fill: "bg-destructive" },
  { key: "abstain", label: "meetings.governance.tallyAbstain", fill: "bg-muted-foreground/50" },
] as const;

/**
 * A closed vote as a card (never the AI's reading): what was put and the
 * recorded outcome as a badge; a bar over everyone who could vote, filled by
 * the ballots and ticked where a pass begins; then the counts, what passing
 * needed and when it closed.
 */
function VotedRow({ motion }: { motion: MeetingMotion }) {
  const { t } = useTranslation();
  const result = motion.result;
  const passed = result?.outcome === "PASSED";
  const counts = { yes: result?.yes ?? 0, no: result?.no ?? 0, abstain: result?.abstain ?? 0 };
  const cast = counts.yes + counts.no + counts.abstain;
  // The bar's whole is the roll or every member, as the motion decided; a count it never kept falls back to the ballots.
  const base = (motion.base === "ALL_MEMBERS" ? motion.total_members : motion.roll_size) || cast;
  const share = (n: number) => (base > 0 ? `${(Math.min(n, base) / base) * 100}%` : "0%");
  const time = clock(motion.closed_at);
  return (
    <li className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <p className="min-w-0 text-body-lg font-medium">{motion.title}</p>
        {result ? (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-caption font-medium",
              passed ? "bg-success-soft text-success-soft-foreground" : "bg-destructive-soft text-destructive-soft-foreground",
            )}
          >
            {passed ? <Check aria-hidden className="size-3" /> : <X aria-hidden className="size-3" />}
            {t(passed ? "meetings.governance.outcome_PASSED" : "meetings.governance.outcome_FAILED")}
          </span>
        ) : null}
      </div>
      <div aria-hidden className="relative mt-3 flex h-1.5 overflow-hidden rounded-full bg-muted">
        {TALLY.map(({ key, fill }) => (counts[key] > 0 ? <span key={key} className={fill} style={{ width: share(counts[key]) }} /> : null))}
        {result && base > 0 && result.required > 0 && result.required < base ? (
          <span className="absolute inset-y-0 w-0.5 bg-foreground/60" style={{ left: share(result.required) }} />
        ) : null}
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
        {TALLY.map(({ key, label, fill }) => (
          <span key={key} className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span aria-hidden className={cn("size-2 rounded-full", fill)} />
            {t(label, { n: counts[key] })}
          </span>
        ))}
        {result && base > 0 ? <span className="whitespace-nowrap">{t("meetings.governance.motionRequired", { required: result.required, base })}</span> : null}
        {time ? <time className="ml-auto font-mono font-medium tabular-nums">{time}</time> : null}
      </p>
    </li>
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
          <ol className="flex flex-col gap-3">
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
            <ClaimRow key={i} meetingId={meetingId} claim={d} mark={<RowMark icon={Check} tone="success" />} />
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
          <ClaimRow key={i} meetingId={meetingId} claim={q} more={false} mark={<RowMark icon={MessageCircleQuestionMark} tone="warning" />}>
            {nextHref && next && defersToNextMeeting(q.text) ? (
              <AppLink
                href={nextHref}
                className="inline-flex h-6 items-center gap-1 rounded-full bg-brand-subtle px-2.5 text-caption font-medium text-brand-subtle-foreground hover:underline"
              >
                <CalendarClock aria-hidden className="size-3.5" />
                {t("meetings.detail.overview.discussAt", { title: seriesShortTitle(next.title, meeting.title) })}
                <ChevronRight aria-hidden className="size-3" />
              </AppLink>
            ) : null}
          </ClaimRow>
        ))}
      </ol>
    </RecapSection>
  );
}

/** One topic, numbered like a chapter: its title opens its points (muted: AI prose), its start chip under it. */
function TopicRow({ meetingId, topic, n }: { meetingId: string; topic: NonNullable<MeetingSummary["topics"]>[number]; n: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const time = topic.start_at ? clock(topic.start_at) : undefined;
  const chip = topic.start ? <EvidenceTimeChip meetingId={meetingId} refs={[topic.start]} time={time} /> : time;
  const mark = (
    <span aria-hidden className="grid size-7 place-items-center rounded-full bg-muted text-caption font-semibold text-muted-foreground tabular-nums">
      {n}
    </span>
  );
  const meta = chip ? (
    typeof chip === "string" ? (
      <time className="font-mono text-caption font-medium text-muted-foreground tabular-nums">{chip}</time>
    ) : (
      <span className="-ml-1.5 flex">{chip}</span>
    )
  ) : undefined;
  if (topic.points.length === 0) {
    return (
      <MarkedRow mark={mark} meta={meta}>
        <p className="font-medium">{topic.title}</p>
      </MarkedRow>
    );
  }
  return (
    <MarkedRow
      mark={mark}
      meta={meta}
      // The points open under the title's own line, so the start chip stays with the title.
      after={
        open ? (
          <ul id={bodyId} className="mt-2 flex flex-col gap-1.5 border-l-2 border-border pl-3 text-muted-foreground">
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
        ) : null
      }
    >
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
    </MarkedRow>
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
              <TopicRow key={i} meetingId={meeting.id} topic={topic} n={i + 1} />
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
