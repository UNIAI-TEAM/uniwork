"use client";
import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { BallotMode, MotionBase, MotionThreshold } from "@uniwork/core/types/meeting";
import { cn } from "@uniwork/ui/lib/utils";
import { SegmentedSm } from "./meeting-detail/ui/segmented";

export type MotionRules = { ballot_mode: BallotMode; threshold: MotionThreshold; base: MotionBase };

/** One rule of the vote: its name on the left, the two choices on the right (stacked on a phone). */
function RuleRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5 max-sm:flex-col max-sm:items-start max-sm:gap-2">
      <span aria-hidden className="text-body text-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * The three rules of a motion as rows, for the add-motion dialog and the
 * sheet's inline editor alike. The caller draws the dividers around them.
 */
export function MotionRuleRows({ value, onChange }: { value: MotionRules; onChange: (patch: Partial<MotionRules>) => void }) {
  const { t } = useTranslation();
  return (
    <>
      <RuleRow label={t("meetings.governance.ballotModeLabel")}>
        <SegmentedSm<BallotMode>
          legend={t("meetings.governance.ballotModeLabel")}
          value={value.ballot_mode}
          onChange={(ballot_mode) => onChange({ ballot_mode })}
          options={(["PUBLIC", "SECRET"] as const).map((v) => ({ value: v, label: t(`meetings.governance.ballotMode_${v}`) }))}
        />
      </RuleRow>
      <RuleRow label={t("meetings.governance.thresholdLabel")}>
        <SegmentedSm<MotionThreshold>
          legend={t("meetings.governance.thresholdLabel")}
          value={value.threshold}
          onChange={(threshold) => onChange({ threshold })}
          options={(["MAJORITY", "TWO_THIRDS"] as const).map((v) => ({ value: v, label: t(`meetings.governance.threshold_${v}`) }))}
        />
      </RuleRow>
      <RuleRow label={t("meetings.governance.baseLabel")}>
        <SegmentedSm<MotionBase>
          legend={t("meetings.governance.baseLabel")}
          value={value.base}
          onChange={(base) => onChange({ base })}
          options={(["PRESENT", "ALL_MEMBERS"] as const).map((v) => ({ value: v, label: t(`meetings.governance.base_${v}`) }))}
        />
      </RuleRow>
    </>
  );
}

/**
 * What the rules add up to, in words, read the way the server decides it:
 * "more than half" / "at least two thirds" of the roll or of every member,
 * and silence never counts in favour (meeting_motion_outcome.go).
 */
export function MotionRuleSummary({ value, className }: { value: MotionRules; className?: string }) {
  const { t } = useTranslation();
  return (
    <div aria-live="polite" className={cn("flex min-w-0 gap-2 text-caption text-pretty text-muted-foreground", className)}>
      <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <div className="space-y-0.5">
        <p>
          {t("meetings.governance.rulePass", {
            share: t(`meetings.governance.ruleShare_${value.threshold}`),
            base: t(`meetings.governance.ruleBase_${value.base}`),
          })}{" "}
          {t("meetings.governance.ruleSilence")}
        </p>
        {value.ballot_mode === "SECRET" ? <p>{t("meetings.governance.secretHint")}</p> : null}
      </div>
    </div>
  );
}
