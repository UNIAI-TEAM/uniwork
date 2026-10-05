"use client";
import { useState } from "react";
import { ChevronDown, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { motionDenominator, tallyPercent, useMotionVoters } from "@uniwork/core/meetings/motions";
import { BALLOT_CHOICES, type BallotChoice, type MeetingMotion } from "@uniwork/core/types/meeting";
import { Button } from "@uniwork/ui/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@uniwork/ui/components/ui/collapsible";
import { cn } from "@uniwork/ui/lib/utils";
import { ToneBadge } from "./meeting-status-badge";

const SEGMENT: Record<BallotChoice, string> = {
  YES: "bg-success",
  NO: "bg-destructive",
  ABSTAIN: "bg-muted-foreground/40",
};
const COUNT_OF = { YES: "yes", NO: "no", ABSTAIN: "abstain" } as const;

/**
 * Who chose what, read only once the result is unfolded: the list every
 * client refetches on each ballot carries no names.
 */
function MotionVotersList({ meetingId, motionId }: { meetingId: string; motionId: string }) {
  const { t } = useTranslation();
  const { data: voters, isPending, isError, refetch } = useMotionVoters(meetingId, motionId, true);
  if (isPending) {
    return <p className="px-1 pt-1 text-caption text-muted-foreground">{t("common.loading")}</p>;
  }
  // A closed public motion always has names: null here is a drifted body, and
  // "nobody" under every choice would contradict the tallies.
  if (isError || !voters) {
    return (
      <div className="flex flex-wrap items-center gap-2 px-1 pt-1 text-caption text-muted-foreground">
        <span>{t("meetings.governance.motionsLoadFailed")}</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => void refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  }
  return (
    <dl className="space-y-1.5 px-1 pt-1">
      {BALLOT_CHOICES.map((c) => {
        const names = voters[COUNT_OF[c]];
        return (
          <div key={c} className="grid grid-cols-[8rem_1fr] gap-2 text-caption">
            <dt className="text-muted-foreground">{t(`meetings.governance.choice_${c}`)}</dt>
            <dd className="text-foreground">
              {names.length > 0 ? names.join(", ") : t("meetings.governance.motionVotersNone")}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * A closed vote's result: outcome, the bar against the denominator it was
 * counted on (with the passing mark), counts and shares per choice, and —
 * for an open ballot only — who chose what, folded away by default and
 * fetched on first unfold. A secret ballot says why there are no names
 * instead.
 */
export function MeetingMotionResult({ meetingId, motion }: { meetingId: string; motion: MeetingMotion }) {
  const { t } = useTranslation();
  const [votersOpen, setVotersOpen] = useState(false);
  const result = motion.result;
  if (!result) return null;
  const denominator = motionDenominator(motion.base, motion.roll_size ?? 0, motion.total_members ?? 0);
  const passed = result.outcome === "PASSED";
  const secret = motion.ballot_mode === "SECRET";
  return (
    <div className="@container space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToneBadge tone={passed ? "success" : "destructive"}>
          {passed ? t("meetings.governance.outcome_PASSED") : t("meetings.governance.outcome_FAILED")}
        </ToneBadge>
        <p className="text-caption text-muted-foreground tabular-nums">
          {denominator > 0
            ? t("meetings.governance.motionRequired", { required: result.required, base: denominator })
            : t("meetings.governance.motionNoVoters")}
        </p>
      </div>
      <div aria-hidden className="relative h-2 rounded-full bg-muted">
        <div className="flex h-full overflow-hidden rounded-full">
          {BALLOT_CHOICES.map((c) => (
            <span
              key={c}
              className={cn("h-full", SEGMENT[c])}
              // The share is data, not a style choice: the one inline value here.
              style={{ width: `${tallyPercent(result[COUNT_OF[c]], denominator)}%` }}
            />
          ))}
        </div>
        {denominator > 0 ? (
          <span
            className="absolute -top-1 h-4 w-0.5 -translate-x-1/2 rounded-full bg-foreground/60"
            style={{ left: `${(result.required * 100) / denominator}%` }}
          />
        ) : null}
      </div>
      <ul className="grid gap-1 text-caption @sm:grid-cols-3">
        {BALLOT_CHOICES.map((c) => (
          <li key={c} className="flex items-center gap-1.5 text-foreground tabular-nums">
            <span aria-hidden className={cn("size-2 shrink-0 rounded-full", SEGMENT[c])} />
            {t("meetings.governance.motionTally", {
              choice: t(`meetings.governance.choice_${c}`),
              count: result[COUNT_OF[c]],
              percent: tallyPercent(result[COUNT_OF[c]], denominator),
            })}
          </li>
        ))}
      </ul>
      {secret ? (
        <p className="flex items-center gap-2 text-caption text-muted-foreground">
          <EyeOff aria-hidden className="size-3.5 shrink-0" />
          {t("meetings.governance.motionSecretNote")}
        </p>
      ) : (
        <Collapsible open={votersOpen} onOpenChange={setVotersOpen}>
          <CollapsibleTrigger className="flex items-center gap-1.5 rounded-md px-1 py-1 text-label text-muted-foreground transition-colors duration-fast hover:bg-surface-hover hover:text-foreground pointer-coarse:min-h-11">
            <ChevronDown
              aria-hidden
              className={cn(
                "size-4 transition-transform duration-fast motion-reduce:transition-none",
                !votersOpen && "-rotate-90",
              )}
            />
            {t("meetings.governance.motionVoters")}
          </CollapsibleTrigger>
          <CollapsibleContent>
            {votersOpen ? <MotionVotersList meetingId={meetingId} motionId={motion.id} /> : null}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
