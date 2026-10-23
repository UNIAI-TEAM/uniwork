"use client";
import { useId, useState } from "react";
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
  onCast,
}: {
  meetingId: string;
  motion: MeetingMotion;
  /** The floating prompt on the stage: tighter rows, full-width submit. */
  compact?: boolean;
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
