"use client";
import { useId, useState } from "react";
import { Check, Plus, Vote } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";
import { errorCode } from "@uniwork/core/api";
import { useCastBallot, useCloseMotion } from "@uniwork/core/meetings/motions";
import { BALLOT_CHOICES, type BallotChoice, type MeetingMotion } from "@uniwork/core/types/meeting";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { toastApiError } from "../../../toast-api-error";
import { MeetingMotionFormDialog } from "../../meeting-motion-form-dialog";
import { MeetingMotionOpenDialog } from "../../meeting-motion-open-dialog";
import { useDetail } from "../detail-context";
import { clock } from "../format";
import { CountPill } from "../ui/count-pill";
import { kitButton } from "../ui/kit-buttons";
import { Dialog440 } from "../ui/overlay";
import { Segmented } from "../ui/segmented";
import { TextButton } from "../ui/text-button";

/** Past this many people the bar draws proportional segments instead of one per voter. */
const MAX_SEGMENTS = 20;

const known = <T extends string>(value: string, list: readonly T[], fallback: T): T =>
  (list as readonly string[]).includes(value) ? (value as T) : fallback;

/** "quá bán · trên số có mặt · công khai": the motion's rule in the strip's words. */
function useRuleWords(motion: MeetingMotion) {
  const { t } = useTranslation();
  const threshold = known(motion.threshold, ["MAJORITY", "TWO_THIRDS"], "MAJORITY");
  const base = known(motion.base, ["PRESENT", "ALL_MEMBERS"], "PRESENT");
  const mode = t(`meetings.detail.live.mode_${known(motion.ballot_mode, ["PUBLIC", "SECRET"], "PUBLIC")}`);
  return { threshold, base, mode };
}

/**
 * The open vote (kit `.vote`), the only bordered block in flow: overline with
 * the opening time, title, description, a segmented bar of ballots cast over
 * the roll, and the viewer's part — the ballot when they are on the roll and
 * have not voted (pick, then send: a vote cannot be taken back), otherwise
 * what they chose and, for a clerk, [Đóng biểu quyết].
 */
export function StripVoteBlock({ motion }: { motion: MeetingMotion }) {
  const { t } = useTranslation();
  const { meeting, isClerk, displayStatus } = useDetail();
  const titleId = useId();
  const hintId = useId();
  const cast = useCastBallot(meeting.id);
  const close = useCloseMotion(meeting.id);
  const [choice, setChoice] = useState<BallotChoice | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { threshold, base, mode } = useRuleWords(motion);
  const roll = motion.roll_size ?? 0;
  const done = motion.cast_count ?? 0;
  const segments = Math.min(roll, MAX_SEGMENTS);
  const filled = roll > 0 ? Math.round((done / roll) * segments) : 0;
  const mine = motion.my_ballot;
  const ballot = mine?.on_roll === true && mine.cast !== true;
  const myChoice = mine?.choice ? known(mine.choice, BALLOT_CHOICES, "YES") : null;
  const missing = Math.max(0, roll - done);
  const choiceLabel = (c: BallotChoice) => t(`meetings.detail.live.choice_${c}`);

  const send = () => {
    if (!choice || cast.isPending) return;
    cast.mutateAsync({ motionId: motion.id, choice }).then(
      () => setChoice(null),
      (err: unknown) => {
        // A second tab already voted: the first ballot stands.
        if (errorCode(err) === "already_voted") setChoice(null);
        else toastApiError(err, t("common.error"));
      },
    );
  };
  const closeNow = () =>
    close.mutate(motion.id, {
      onSuccess: () => {
        setConfirmOpen(false);
        toast.success(t("meetings.governance.motionClosedToast"), { position: "bottom-center" });
      },
      onError: (err) => toastApiError(err, t("common.error")),
    });

  const meta = (
    <p className="text-caption text-muted-foreground">
      {t("meetings.detail.live.voteMeta", {
        cast: done,
        roll,
        threshold: t(`meetings.detail.live.threshold_${threshold}`),
        base: t(`meetings.detail.live.base_${base}`),
        mode,
      })}
    </p>
  );
  const bar =
    segments > 0 ? (
      <div
        role="img"
        aria-label={t("meetings.detail.live.voteProgress", { cast: done, roll })}
        className={cn(
          "grid flex-none auto-cols-fr grid-flow-col gap-1 @max-[37.5rem]/meeting:mt-0.5 @max-[37.5rem]/meeting:w-full",
          // Overtime draws the bar shorter (Overtime board: 120 against 176).
          displayStatus === "OVERTIME" ? "w-30" : "w-44",
        )}
      >
        {Array.from({ length: segments }, (_, i) => (
          <span key={i} className={cn("h-1.5 rounded-full", i < filled ? "bg-primary" : "bg-muted")} />
        ))}
      </div>
    ) : null;
  const buttonCls = cn(kitButton.base, kitButton.outline, "@max-[37.5rem]/meeting:h-11");

  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        "mt-2 grid items-center @max-[37.5rem]/meeting:mt-1 [[data-panel=roll]_&]:first:mt-0 gap-x-6 gap-y-4 rounded-lg border border-border p-4",
        ballot ? "grid-cols-1" : "grid-cols-[minmax(0,1fr)_auto] @max-[37.5rem]/meeting:grid-cols-1",
      )}
    >
      <div className="min-w-0">
        <p className="text-caption font-medium text-muted-foreground">
          {t("meetings.detail.live.voteOver")}
          {motion.opened_at ? (
            <>
              {" · "}
              <time dateTime={motion.opened_at} className="font-mono">
                {clock(motion.opened_at)}
              </time>
            </>
          ) : null}
        </p>
        <h3 id={titleId} className="mt-1.5 text-title-sm font-semibold [[data-panel=roll]_&]:mt-1">
          {motion.title}
        </h3>
        {motion.description ? (
          <p className="mt-0.5 max-w-150 text-body @max-[37.5rem]/meeting:mt-1 text-muted-foreground">{motion.description}</p>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 @max-[37.5rem]/meeting:gap-y-2 [[data-panel=roll]_&]:mt-2">
          {bar}
          {meta}
        </div>
        {ballot ? (
          <div className="mt-3 flex flex-wrap items-center gap-3 [[data-panel=roll]_&]:mt-2">
            <Segmented
              legend={t("meetings.detail.live.ballotLegend")}
              options={BALLOT_CHOICES.map((c) => ({ value: c, label: choiceLabel(c) }))}
              value={choice}
              onChange={setChoice}
              disabled={cast.isPending}
              className="@max-[37.5rem]/meeting:w-full @max-[37.5rem]/meeting:*:flex-1"
            />
            {choice ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className={buttonCls}
                  aria-describedby={hintId}
                  aria-busy={cast.isPending || undefined}
                  disabled={cast.isPending}
                  onClick={send}
                >
                  {cast.isPending ? t("meetings.governance.voteSubmitting") : t("meetings.governance.voteSubmit")}
                </Button>
                <span id={hintId} className="text-caption text-muted-foreground">
                  {t("meetings.governance.voteFinalHint")}
                </span>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      {!ballot && (mine?.cast || isClerk) ? (
        <div className="flex items-center gap-4 @max-[37.5rem]/meeting:flex-col @max-[37.5rem]/meeting:items-stretch @max-[37.5rem]/meeting:gap-3">
          {mine?.cast ? (
            <p className="inline-flex min-h-5 items-center gap-1.5 text-body font-medium text-success">
              <Check aria-hidden className="size-4" />
              {myChoice
                ? t("meetings.detail.live.voted", { choice: choiceLabel(myChoice) })
                : t("meetings.detail.live.votedSecret")}
            </p>
          ) : null}
          {isClerk ? (
            <Button
              type="button"
              variant="outline"
              size="lg"
              aria-haspopup="dialog"
              className={buttonCls}
              onClick={() => setConfirmOpen(true)}
            >
              {t("meetings.governance.motionClose")}
            </Button>
          ) : null}
        </div>
      ) : null}
      <Dialog440
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        role="alertdialog"
        title={t("meetings.governance.motionCloseConfirmTitle")}
        description={
          missing > 0
            ? `${t("meetings.detail.live.closeMissing", { count: missing })} ${t("meetings.governance.motionCloseConfirm")}`
            : t("meetings.governance.motionCloseConfirm")
        }
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className={cn(kitButton.base, kitButton.ghost)}
              onClick={() => setConfirmOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="brand"
              size="lg"
              className={kitButton.base}
              disabled={close.isPending}
              aria-busy={close.isPending || undefined}
              onClick={closeNow}
            >
              {t("meetings.governance.motionClose")}
            </Button>
          </>
        }
      />
    </section>
  );
}

/**
 * A drafted motion waiting to be opened (kit `.draft`): one caption row with
 * its rule and a [Mở biểu quyết] text button, inactive (with the reason in the
 * caption) while another vote is open or before the meeting starts.
 */
export function StripDraftLine({
  motion,
  blockedBy,
}: {
  motion: MeetingMotion;
  /** Why it cannot open yet; null when it can. */
  blockedBy: "openVote" | "notStarted" | null;
}) {
  const { t } = useTranslation();
  const { meeting, viewer } = useDetail();
  const ruleId = useId();
  const [open, setOpen] = useState(false);
  const { threshold, base, mode } = useRuleWords(motion);
  const rule = [
    t("meetings.detail.live.draftRule", {
      need: t(`meetings.detail.live.draftNeed_${threshold}`),
      base: t(`meetings.detail.live.draftBase_${base}`),
      mode,
    }),
    blockedBy === "openVote" ? t("meetings.detail.live.draftAfterOpen") : null,
    blockedBy === "notStarted" ? t("meetings.detail.live.draftBeforeStart") : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const dialog = <MeetingMotionOpenDialog meeting={meeting} meetingId={meeting.id} motion={motion} open={open} onOpenChange={setOpen} />;
  // Live, opening the drafted vote is the secretary's job (LiveSecretary): a strip job row
  // with the title in bold and an outline [Mở biểu quyết]; the host keeps the quiet line.
  if (viewer === "secretary" && blockedBy !== "notStarted") {
    return (
      <>
        <div className="flex min-h-14 items-center justify-between [section+&]:mt-3 gap-x-6 gap-y-3 py-3 [[data-panel=roll]_&]:py-2 @max-[37.5rem]/meeting:flex-col @max-[37.5rem]/meeting:items-stretch">
          <div className="min-w-0">
            <p className="truncate text-body @max-[37.5rem]/meeting:whitespace-normal" title={motion.title}>
              <Trans t={t} i18nKey="meetings.detail.live.draftJob" values={{ title: motion.title }} components={{ b: <strong className="font-semibold" /> }} />
            </p>
            <p id={ruleId} className="mt-0.5 text-caption text-muted-foreground">
              {rule}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="lg"
            aria-disabled={blockedBy ? true : undefined}
            aria-describedby={ruleId}
            aria-label={t("meetings.detail.live.draftOpenName", { title: motion.title })}
            aria-haspopup="dialog"
            className={cn(kitButton.base, kitButton.outline, kitButton.inactive, "flex-none @max-[37.5rem]/meeting:h-11")}
            onClick={() => setOpen(true)}
          >
            {t("meetings.governance.motionOpen")}
          </Button>
        </div>
        {dialog}
      </>
    );
  }
  const draft = t("meetings.detail.live.draft");
  const action = (className: string) => (
    <TextButton
      aria-disabled={blockedBy ? true : undefined}
      aria-describedby={ruleId}
      aria-label={t("meetings.detail.live.draftOpenName", { title: motion.title })}
      aria-haspopup="dialog"
      className={cn("ml-auto flex-none", className)}
      onClick={() => setOpen(true)}
    >
      {t("meetings.governance.motionOpen")}
    </TextButton>
  );
  // Phone (PhoneLive): the pill runs into the title and the action sits beside
  // the rule; each twin is display:none on the other width, so only one is read.
  return (
    <>
      <div className="flex min-h-13 items-center gap-2.5 py-2 [[data-panel=roll]_&]:min-h-14 [[data-panel=roll]_section+&]:mt-3 @max-[37.5rem]/meeting:items-start @max-[37.5rem]/meeting:gap-3 @max-[37.5rem]/meeting:pt-3.5 @max-[37.5rem]/meeting:pb-0.5">
        <Vote aria-hidden className="size-4 flex-none text-muted-foreground @max-[37.5rem]/meeting:mt-0.5" />
        <CountPill className="@max-[37.5rem]/meeting:hidden">{draft}</CountPill>
        <div className="min-w-0 flex-auto">
          <p className="truncate text-body @max-[37.5rem]/meeting:whitespace-normal">
            <CountPill className="mr-1.5 hidden h-4.5 align-[1px] @max-[37.5rem]/meeting:inline-flex">{draft}</CountPill>
            {motion.title}
          </p>
          <div className="mt-0.5 flex items-center gap-3">
            <p id={ruleId} className="text-caption text-muted-foreground">
              {rule}
            </p>
            {action("hidden min-h-11 py-0 @max-[37.5rem]/meeting:inline-flex")}
          </div>
        </div>
        {action("@max-[37.5rem]/meeting:hidden")}
      </div>
      {dialog}
    </>
  );
}

/** "+ Thêm biểu quyết" under the notes of a scheduled meeting, for whoever clerks (kit `.add-vote`). */
export function AddMotionLine() {
  const { t } = useTranslation();
  const { meeting } = useDetail();
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-6">
      <TextButton aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        {t("meetings.detail.live.addMotion")}
      </TextButton>
      <MeetingMotionFormDialog meetingId={meeting.id} open={open} onOpenChange={setOpen} />
    </div>
  );
}
