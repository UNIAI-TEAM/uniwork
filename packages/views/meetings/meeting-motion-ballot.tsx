"use client";
import { useId, useState } from "react";
import { Check, CircleMinus, Lock, ThumbsDown, ThumbsUp, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { errorCode } from "@uniwork/core/api";
import { useCastBallot } from "@uniwork/core/meetings/motions";
import { BALLOT_CHOICES, type BallotChoice, type MeetingMotion } from "@uniwork/core/types/meeting";
import { Button } from "@uniwork/ui/components/ui/button";
import { Label } from "@uniwork/ui/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@uniwork/ui/components/ui/radio-group";
import { cn } from "@uniwork/ui/lib/utils";
import { toastApiError } from "../toast-api-error";

function asChoice(value: unknown): BallotChoice | null {
  return BALLOT_CHOICES.find((c) => c === value) ?? null;
}

/** The room's 48px rows: an icon per choice and a frame in the choice's own colour once picked. */
const ROOM_CHOICE: Record<BallotChoice, { icon: LucideIcon; radio: string; text: string; tick: string }> = {
  YES: {
    icon: ThumbsUp,
    radio: "data-checked:border-success-solid data-checked:bg-success-soft/50 dark:data-checked:bg-success-soft/50",
    text: "text-success",
    tick: "bg-success-solid text-on-solid",
  },
  NO: {
    icon: ThumbsDown,
    radio: "data-checked:border-destructive data-checked:bg-destructive/5 dark:data-checked:bg-destructive/5",
    text: "text-destructive",
    tick: "bg-destructive-solid text-on-solid",
  },
  ABSTAIN: {
    icon: CircleMinus,
    radio: "data-checked:border-foreground data-checked:bg-surface dark:data-checked:bg-surface",
    text: "text-foreground",
    tick: "bg-foreground text-background",
  },
};
// The radio is the whole row (its dot hidden), so the row is the hit area and the focus ring.
const ROOM_RADIO =
  "absolute inset-0 aspect-auto size-full rounded-xl border-border bg-surface after:inset-0 hover:bg-surface-hover data-checked:border-[1.5px] dark:bg-surface [&>[data-slot=radio-group-indicator]]:hidden";

/**
 * One member's ballot: pick, then submit — two steps because a vote cannot be
 * taken back. Nothing is optimistic; the server decides whether this person is
 * on the roll. A repeat submit (double click, a second tab) answers 409
 * already_voted: the first vote stands, so it reads as recorded, not as an error.
 */
export function MeetingMotionBallot({
  meetingId,
  motion,
  compact = false,
  room = false,
  onCast,
}: {
  meetingId: string;
  motion: MeetingMotion;
  /** The floating prompt on the stage: tighter rows, full-width submit. */
  compact?: boolean;
  /** The room tab's ballot: tall rows with icons and a full-width dark submit. */
  room?: boolean;
  /** Called once the vote is recorded; the caller confirms it where the voter is looking. */
  onCast?: () => void;
}) {
  const { t } = useTranslation();
  // The room tab and the prompt can show the same motion at once: ids must not collide.
  const id = useId();
  const hintId = `${id}-hint`;
  const cast = useCastBallot(meetingId);
  const [choice, setChoice] = useState<BallotChoice | null>(null);

  const submit = () => {
    if (choice === null || cast.isPending) return;
    cast.mutateAsync({ motionId: motion.id, choice }).then(
      () => onCast?.(),
      (err: unknown) => {
        if (errorCode(err) === "already_voted") onCast?.();
        else toastApiError(err, t("common.error"));
      },
    );
  };

  if (room) {
    return (
      <div className="space-y-3">
        <RadioGroup
          aria-label={t("meetings.governance.motionBallotLabel", { title: motion.title })}
          aria-describedby={hintId}
          value={choice ?? ""}
          onValueChange={(value) => setChoice(asChoice(value))}
          disabled={cast.isPending}
          className="gap-2"
        >
          {BALLOT_CHOICES.map((c) => {
            const look = ROOM_CHOICE[c];
            const Icon = look.icon;
            const picked = choice === c;
            const label = t(`meetings.governance.choice_${c}`);
            return (
              <div key={c} className="relative flex h-12 items-center">
                <RadioGroupItem value={c} aria-label={label} className={cn(ROOM_RADIO, look.radio)} />
                <span
                  aria-hidden
                  className={cn(
                    "pointer-events-none relative flex w-full items-center gap-2.5 px-3 text-body",
                    picked ? cn("font-semibold", look.text) : "font-medium text-foreground",
                  )}
                >
                  <Icon className="size-5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  {picked ? (
                    <span className={cn("grid size-[22px] shrink-0 place-items-center rounded-full", look.tick)}>
                      <Check className="size-3" />
                    </span>
                  ) : null}
                </span>
              </div>
            );
          })}
        </RadioGroup>
        {/* The rules popover shows this line; screen readers hear it with the choices. */}
        <p id={hintId} className="sr-only">
          {t("meetings.governance.voteFinalHint")}
        </p>
        <Button
          type="button"
          aria-disabled={choice === null ? true : undefined}
          disabled={cast.isPending}
          aria-busy={cast.isPending || undefined}
          onClick={submit}
          className="h-11 w-full rounded-xl bg-foreground text-body font-semibold text-background hover:bg-foreground/90"
        >
          <Lock aria-hidden className="size-3.5" />
          {cast.isPending ? t("meetings.governance.voteSubmitting") : t("meetings.governance.voteSubmit")}
        </Button>
      </div>
    );
  }

  return (
    <div className={compact ? "space-y-2.5" : "space-y-3"}>
      <RadioGroup
        aria-label={t("meetings.governance.motionBallotLabel", { title: motion.title })}
        aria-describedby={hintId}
        value={choice ?? ""}
        onValueChange={(value) => setChoice(asChoice(value))}
        disabled={cast.isPending}
        className={compact ? "gap-1" : "gap-1.5"}
      >
        {BALLOT_CHOICES.map((c) => (
          <Label
            key={c}
            htmlFor={`${id}-${c}`}
            className={cn(
              "flex cursor-pointer items-center gap-2.5 rounded-lg border border-border font-normal transition-colors duration-fast hover:bg-surface-hover has-[[data-checked]]:border-primary has-[[data-checked]]:bg-brand-subtle pointer-coarse:min-h-11",
              compact ? "px-2.5 py-1.5" : "px-3 py-2.5",
            )}
          >
            <RadioGroupItem value={c} id={`${id}-${c}`} />
            <span className="text-body text-foreground">{t(`meetings.governance.choice_${c}`)}</span>
          </Label>
        ))}
      </RadioGroup>
      <div className={cn("flex gap-2", compact ? "flex-col" : "flex-wrap items-center justify-between")}>
        <p id={hintId} className="text-caption text-muted-foreground">
          {t("meetings.governance.voteFinalHint")}
        </p>
        {/* aria-disabled until a choice is picked: the button stays reachable and says nothing is sent yet. */}
        <Button
          type="button"
          variant="brand"
          size={compact ? "sm" : "default"}
          aria-disabled={choice === null ? true : undefined}
          disabled={cast.isPending}
          aria-busy={cast.isPending || undefined}
          onClick={submit}
        >
          {cast.isPending ? t("meetings.governance.voteSubmitting") : t("meetings.governance.voteSubmit")}
        </Button>
      </div>
    </div>
  );
}
