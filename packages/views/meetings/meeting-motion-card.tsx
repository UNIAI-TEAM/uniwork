"use client";
import { useEffect, useId, useRef } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CircleCheck,
  CircleQuestionMark,
  Ellipsis,
  Eye,
  EyeOff,
  Lock,
  Pencil,
  Play,
  Trash,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { tallyPercent } from "@uniwork/core/meetings/motions";
import { BALLOT_CHOICES, type MeetingMotion, type MotionStatus } from "@uniwork/core/types/meeting";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingMotionBallot } from "./meeting-motion-ballot";
import { MeetingMotionResult } from "./meeting-motion-result";
import { ToneBadge, type MeetingTone } from "./meeting-status-badge";

const STATUS_TONE: Record<MotionStatus, MeetingTone> = { DRAFT: "muted", OPEN: "info", CLOSED: "muted" };

// An unknown status from a newer server reads as settled: no clerk actions on it.
function statusOf(s: string): MotionStatus {
  return s === "DRAFT" || s === "OPEN" ? s : "CLOSED";
}

/** A motion's rules, read leniently: an unknown value from a newer server reads as the default. */
function rulesOf(motion: MeetingMotion) {
  return {
    secret: motion.ballot_mode === "SECRET",
    threshold: motion.threshold === "TWO_THIRDS" ? "TWO_THIRDS" : "MAJORITY",
    base: motion.base === "ALL_MEMBERS" ? "ALL_MEMBERS" : "PRESENT",
  } as const;
}

/** One 6px pip per voter on a small roll, one continuous bar past a dozen. */
function RollPips({ cast, roll }: { cast: number; roll: number }) {
  if (roll > 0 && roll <= 12) {
    return (
      <div aria-hidden className="grid flex-1 gap-[3px]" style={{ gridTemplateColumns: `repeat(${roll}, minmax(0, 1fr))` }}>
        {Array.from({ length: roll }, (_, i) => (
          <span key={i} className={cn("h-1.5 rounded-[3px]", i < cast ? "bg-foreground" : "bg-border")} />
        ))}
      </div>
    );
  }
  return (
    <div aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-[3px] bg-border">
      <div
        className="h-full w-full origin-left bg-foreground transition-transform duration-fast motion-reduce:transition-none"
        style={{ transform: `scaleX(${tallyPercent(cast, roll) / 100})` }}
      />
    </div>
  );
}

/**
 * The room's open vote: amber status, the rules as chips with a "?" for how
 * they count, progress as pips, this viewer's ballot, and for the clerk who
 * is still missing beside a secondary close.
 */
function RoomOpenCard({
  meetingId,
  motion,
  isClerk,
  canVote,
  onClose,
}: {
  meetingId: string;
  motion: MeetingMotion;
  isClerk: boolean;
  canVote: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const { secret, threshold, base } = rulesOf(motion);
  const roll = motion.roll_size ?? 0;
  const castCount = motion.cast_count ?? 0;
  const missing = Math.max(0, roll - castCount);
  return (
    <article aria-labelledby={titleId} className="rounded-2xl border border-border bg-card p-3.5 text-card-foreground shadow-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <ToneBadge tone="warning" className="gap-1.5 font-semibold">
          <span
            aria-hidden
            className="size-[7px] animate-pulse rounded-full bg-warning ring-3 ring-warning/25 motion-reduce:animate-none"
          />
          {t("meetings.governance.motionStatus_OPEN")}
        </ToneBadge>
        <ToneBadge tone="muted">{t(`meetings.governance.threshold_${threshold}`)}</ToneBadge>
        <ToneBadge tone="muted" className="gap-1">
          {secret ? <Lock aria-hidden className="size-3" /> : <Eye aria-hidden className="size-3" />}
          {secret ? (
            // Short on the chip (Votes board); named in full for a screen reader.
            <>
              <span aria-hidden>{t("meetings.panel.votes.secret")}</span>
              <span className="sr-only">{t("meetings.governance.ballotMode_SECRET")}</span>
            </>
          ) : (
            t("meetings.governance.ballotMode_PUBLIC")
          )}
        </ToneBadge>
        <Popover>
          <PopoverTrigger
            openOnHover
            delay={150}
            aria-label={t("meetings.panel.votes.rulesHelp")}
            // A 44 hit area on touch drawn as an overlay, so the chip row keeps its height.
            className="relative grid size-6 shrink-0 place-items-center rounded-full text-faint-foreground hover:text-foreground data-[popup-open]:text-foreground pointer-coarse:after:absolute pointer-coarse:after:-inset-2.5 pointer-coarse:after:content-['']"
          >
            <CircleQuestionMark aria-hidden className="size-3.5" />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto max-w-[calc(100vw-2rem)] gap-1 p-3 text-caption">
            <p className="font-medium text-foreground">
              {t(`meetings.governance.threshold_${threshold}`)} · {t(`meetings.governance.base_${base}`)}
            </p>
            <p className="text-muted-foreground">{t("meetings.governance.voteFinalHint")}</p>
          </PopoverContent>
        </Popover>
      </div>
      <h3 id={titleId} className="mt-2.5 font-display text-title-sm font-bold text-pretty text-foreground">
        {motion.title}
      </h3>
      {motion.description ? (
        <p className="mt-1 text-body whitespace-pre-line text-pretty text-muted-foreground">{motion.description}</p>
      ) : null}
      <div className="mt-3 mb-3.5 flex items-center gap-2.5">
        <RollPips cast={castCount} roll={roll} />
        <span className="text-caption font-semibold text-muted-foreground tabular-nums">
          {t("meetings.panel.votes.progress", { cast: castCount, roll })}
        </span>
      </div>
      <OwnBallot meetingId={meetingId} motion={motion} canVote={canVote} room />
      {isClerk ? (
        <div className="mt-2.5 flex items-center gap-2 border-t border-border pt-2.5">
          <span className="min-w-0 flex-1 text-caption text-muted-foreground">
            {missing > 0 ? t("meetings.panel.votes.missing", { count: missing }) : null}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 rounded-[10px] bg-surface-hover font-semibold text-foreground hover:bg-surface-hover/70"
            onClick={onClose}
          >
            {t("meetings.governance.motionClose")}
          </Button>
        </div>
      ) : null}
    </article>
  );
}

/** This viewer's part in an open vote: the ballot, what they chose, or why they cannot vote here. */
function OwnBallot({
  meetingId,
  motion,
  canVote,
  room,
}: {
  meetingId: string;
  motion: MeetingMotion;
  canVote: boolean;
  room: boolean;
}) {
  const { t } = useTranslation();
  const mine = motion.my_ballot;
  const myChoice = BALLOT_CHOICES.find((c) => c === mine?.choice);
  const cast = Boolean(mine?.cast);
  // Focus was in the ballot when it last moved; the ballot's removal drops it on <body>.
  const focusInBallot = useRef(false);
  const confirmation = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!cast || !focusInBallot.current) return;
    focusInBallot.current = false;
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (lost) confirmation.current?.focus();
  }, [cast]);
  if (cast) {
    return (
      <p ref={confirmation} tabIndex={-1} className="flex items-center gap-2 text-label text-success-soft-foreground">
        <CircleCheck aria-hidden className="size-4 shrink-0" />
        {myChoice
          ? t("meetings.governance.motionYourVote", { choice: t(`meetings.governance.choice_${myChoice}`) })
          : t("meetings.governance.motionVoted")}
      </p>
    );
  }
  if (canVote && mine?.on_roll) {
    return (
      <div
        onFocus={() => {
          focusInBallot.current = true;
        }}
        onBlur={(e) => {
          // A null relatedTarget is also what removal looks like, so only a move elsewhere counts.
          if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) focusInBallot.current = false;
        }}
      >
        <MeetingMotionBallot
          meetingId={meetingId}
          motion={motion}
          room={room}
          onCast={() => toast.success(t("meetings.governance.voteRecorded"))}
        />
      </div>
    );
  }
  if (canVote) return <p className="text-caption text-muted-foreground">{t("meetings.governance.motionNotOnRoll")}</p>;
  if (mine?.on_roll) return <p className="text-caption text-muted-foreground">{t("meetings.governance.motionVoteInRoom")}</p>;
  return null;
}

/** Progress while the vote runs, then this viewer's part in it. */
function MotionOpenBody({
  meetingId,
  motion,
  isClerk,
  canVote,
  onClose,
}: {
  meetingId: string;
  motion: MeetingMotion;
  isClerk: boolean;
  canVote: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const roll = motion.roll_size ?? 0;
  const castCount = motion.cast_count ?? 0;
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <p className="text-label text-foreground tabular-nums">
          {t("meetings.governance.motionProgress", { cast: castCount, roll })}
        </p>
        <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-muted">
          {/* Scaled, not resized: a transform animates without relayout. */}
          <div
            className="h-full w-full origin-left bg-info transition-transform duration-fast motion-reduce:transition-none"
            style={{ transform: `scaleX(${tallyPercent(castCount, roll) / 100})` }}
          />
        </div>
      </div>
      <OwnBallot meetingId={meetingId} motion={motion} canVote={canVote} room={false} />
      {isClerk ? (
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            <Lock aria-hidden />
            {t("meetings.governance.motionClose")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** The clerk's edit, reorder and delete menu on a draft. */
function DraftMenu({
  title,
  canMoveUp,
  canMoveDown,
  onEdit,
  onDelete,
  onMove,
}: {
  title: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (direction: "up" | "down") => void;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("meetings.governance.motionActions", { title })}
          />
        }
      >
        <Ellipsis aria-hidden className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem onClick={onEdit}>
          <Pencil aria-hidden className="size-4" />
          {t("meetings.governance.motionEdit")}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canMoveUp} onClick={() => onMove("up")}>
          <ArrowUp aria-hidden className="size-4" />
          {t("meetings.governance.motionMoveUp")}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canMoveDown} onClick={() => onMove("down")}>
          <ArrowDown aria-hidden className="size-4" />
          {t("meetings.governance.motionMoveDown")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <Trash aria-hidden className="size-4" />
          {t("meetings.governance.motionDelete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One item on the agenda of votes, in whichever state it is: a draft the
 * clerk can still edit, reorder and open; an open vote with progress and
 * (where ballots are cast) the voter's ballot; a closed vote with its result.
 * Presentational: the list owns the dialogs and mutations behind the callbacks.
 */
export function MeetingMotionCard({
  meetingId,
  motion,
  isClerk,
  canVote,
  inProgress,
  anotherOpen,
  canMoveUp,
  canMoveDown,
  onEdit,
  onDelete,
  onMove,
  onOpen,
  onClose,
  room = false,
}: {
  meetingId: string;
  motion: MeetingMotion;
  isClerk: boolean;
  /** True where ballots are cast (the room tab); the detail page only shows progress. */
  canVote: boolean;
  /** The meeting is IN_PROGRESS: the only state in which voting can open. */
  inProgress: boolean;
  /** Another item of this meeting is open; one vote runs at a time. */
  anotherOpen: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (direction: "up" | "down") => void;
  onOpen: () => void;
  onClose: () => void;
  /** The room tab's look: a featured open card, compact draft rows, result cards with a stacked bar. */
  room?: boolean;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const hintId = useId();
  const status = statusOf(motion.status);
  const { secret, threshold, base } = rulesOf(motion);
  const openBlocked = !inProgress
    ? t("meetings.governance.motionOpenNeedsMeeting")
    : anotherOpen
      ? t("meetings.governance.motionAnotherOpen")
      : null;
  const draftActions = isClerk && status === "DRAFT";
  if (room && status === "OPEN") {
    return <RoomOpenCard meetingId={meetingId} motion={motion} isClerk={isClerk} canVote={canVote} onClose={onClose} />;
  }
  if (room && status === "DRAFT") {
    return (
      <article aria-labelledby={titleId} className="flex items-center gap-2.5 rounded-xl border border-border py-2.5 pr-2.5 pl-3">
        <ToneBadge tone="muted" className="rounded-md">
          {t("meetings.governance.motionStatus_DRAFT")}
        </ToneBadge>
        <span id={titleId} className="min-w-0 flex-1 text-label font-medium text-pretty text-foreground">
          {motion.title}
        </span>
        {draftActions ? (
          <>
            {/* aria-disabled keeps the button reachable; the hidden hint says why it waits, the title shows it on hover. */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t("meetings.detail.live.draftOpenName", { title: motion.title })}
              aria-disabled={openBlocked ? true : undefined}
              aria-describedby={openBlocked ? hintId : undefined}
              title={openBlocked ?? undefined}
              className="bg-surface-hover hover:bg-surface-hover/70 aria-disabled:text-faint-foreground"
              onClick={onOpen}
            >
              {/* The row's one action; the name says it in full. */}
              {t("meetings.panel.votes.open")}
            </Button>
            {openBlocked ? (
              <span id={hintId} className="sr-only">
                {openBlocked}
              </span>
            ) : null}
            <DraftMenu
              title={motion.title}
              canMoveUp={canMoveUp}
              canMoveDown={canMoveDown}
              onEdit={onEdit}
              onDelete={onDelete}
              onMove={onMove}
            />
          </>
        ) : null}
      </article>
    );
  }
  if (room) {
    const passed = motion.result?.outcome === "PASSED";
    return (
      <article aria-labelledby={titleId} className="space-y-2.5 rounded-xl border border-border p-3">
        <div className="flex items-start gap-2.5">
          <span id={titleId} className="min-w-0 flex-1 text-label font-medium text-pretty text-foreground">
            {motion.title}
          </span>
          {motion.result ? (
            <ToneBadge tone={passed ? "success" : "destructive"} className="gap-1 font-semibold">
              {passed ? <Check aria-hidden className="size-3" /> : null}
              {t(`meetings.governance.outcome_${passed ? "PASSED" : "FAILED"}`)}
            </ToneBadge>
          ) : null}
        </div>
        <MeetingMotionResult meetingId={meetingId} motion={motion} room />
      </article>
    );
  }
  return (
    <article aria-labelledby={titleId} className="space-y-3 rounded-xl border border-border bg-card p-4 text-card-foreground">
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1.5">
          <h3 id={titleId} className="text-body font-semibold text-pretty text-foreground">
            {motion.title}
          </h3>
          <div className="flex flex-wrap items-center gap-1.5">
            <ToneBadge tone={STATUS_TONE[status]} className={cn(status === "OPEN" && "gap-1.5")}>
              {status === "OPEN" ? (
                <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" />
              ) : null}
              {t(`meetings.governance.motionStatus_${status}`)}
            </ToneBadge>
            <ToneBadge tone="muted" className="gap-1">
              {secret ? <EyeOff aria-hidden className="size-3" /> : <Eye aria-hidden className="size-3" />}
              {secret ? t("meetings.governance.ballotMode_SECRET") : t("meetings.governance.ballotMode_PUBLIC")}
            </ToneBadge>
            <ToneBadge tone="muted">{t(`meetings.governance.threshold_${threshold}`)}</ToneBadge>
            <ToneBadge tone="muted">{t(`meetings.governance.base_${base}`)}</ToneBadge>
          </div>
        </div>
        {draftActions ? (
          <DraftMenu
            title={motion.title}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            onEdit={onEdit}
            onDelete={onDelete}
            onMove={onMove}
          />
        ) : null}
      </header>
      {motion.description ? (
        <p className="text-body whitespace-pre-line text-pretty text-muted-foreground">{motion.description}</p>
      ) : null}
      {draftActions ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {/* aria-disabled keeps the button reachable, so a keyboard user hears why it waits. */}
          <Button
            type="button"
            variant="brand"
            size="sm"
            aria-disabled={openBlocked ? true : undefined}
            aria-describedby={openBlocked ? hintId : undefined}
            onClick={onOpen}
          >
            <Play aria-hidden />
            {t("meetings.governance.motionOpen")}
          </Button>
          {openBlocked ? (
            <p id={hintId} className="text-caption text-muted-foreground">
              {openBlocked}
            </p>
          ) : null}
        </div>
      ) : null}
      {status === "OPEN" ? (
        <MotionOpenBody meetingId={meetingId} motion={motion} isClerk={isClerk} canVote={canVote} onClose={onClose} />
      ) : null}
      {status === "CLOSED" ? <MeetingMotionResult meetingId={meetingId} motion={motion} /> : null}
    </article>
  );
}
