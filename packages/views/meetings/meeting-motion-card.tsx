"use client";
import { useId, type ReactNode } from "react";
import { ArrowDown, ArrowUp, CircleCheck, Eye, EyeOff, Lock, Ellipsis, Pencil, Play, Trash2 } from "lucide-react";
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
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingMotionBallot } from "./meeting-motion-ballot";
import { MeetingMotionResult } from "./meeting-motion-result";
import { ToneBadge, type MeetingTone } from "./meeting-status-badge";

const STATUS_TONE: Record<MotionStatus, MeetingTone> = { DRAFT: "muted", OPEN: "info", CLOSED: "muted" };

// An unknown status from a newer server reads as settled: no clerk actions on it.
function statusOf(s: string): MotionStatus {
  return s === "DRAFT" || s === "OPEN" ? s : "CLOSED";
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
  const mine = motion.my_ballot;
  const myChoice = BALLOT_CHOICES.find((c) => c === mine?.choice);
  let own: ReactNode = null;
  if (mine?.cast) {
    own = (
      <p className="flex items-center gap-2 text-label text-success-soft-foreground">
        <CircleCheck aria-hidden className="size-4 shrink-0" />
        {myChoice
          ? t("meetings.governance.motionYourVote", { choice: t(`meetings.governance.choice_${myChoice}`) })
          : t("meetings.governance.motionVoted")}
      </p>
    );
  } else if (canVote && mine?.on_roll) {
    own = (
      <MeetingMotionBallot
        meetingId={meetingId}
        motion={motion}
        onCast={() => toast.success(t("meetings.governance.voteRecorded"))}
      />
    );
  } else if (canVote) {
    own = <p className="text-caption text-muted-foreground">{t("meetings.governance.motionNotOnRoll")}</p>;
  } else if (mine?.on_roll) {
    own = <p className="text-caption text-muted-foreground">{t("meetings.governance.motionVoteInRoom")}</p>;
  }
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
      {own}
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
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const hintId = useId();
  const status = statusOf(motion.status);
  const secret = motion.ballot_mode === "SECRET";
  const threshold = motion.threshold === "TWO_THIRDS" ? "TWO_THIRDS" : "MAJORITY";
  const base = motion.base === "ALL_MEMBERS" ? "ALL_MEMBERS" : "PRESENT";
  const openBlocked = !inProgress
    ? t("meetings.governance.motionOpenNeedsMeeting")
    : anotherOpen
      ? t("meetings.governance.motionAnotherOpen")
      : null;
  const draftActions = isClerk && status === "DRAFT";
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
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("meetings.governance.motionActions", { title: motion.title })}
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
                <Trash2 aria-hidden className="size-4" />
                {t("meetings.governance.motionDelete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
