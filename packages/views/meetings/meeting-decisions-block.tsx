"use client";
import { CircleCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MeetingMotion } from "@uniwork/core/types/meeting";
import { ToneBadge } from "./meeting-status-badge";

/**
 * "Decisions": what the meeting voted on comes first, from the recorded
 * results (never from the AI), then the decisions the AI summary picked out.
 * Null when there is neither.
 */
export function MeetingDecisionsBlock({
  voted,
  aiDecisions,
}: {
  voted: readonly MeetingMotion[];
  aiDecisions: readonly string[];
}) {
  const { t } = useTranslation();
  if (voted.length === 0 && aiDecisions.length === 0) return null;
  return (
    <div className="space-y-3">
      <h3 className="text-overline text-muted-foreground">{t("meetings.decisions")}</h3>
      {voted.length > 0 ? (
        <div className="space-y-1.5">
          <h4 className="text-label font-medium text-foreground">{t("meetings.governance.votedDecisions")}</h4>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {voted.map((m) => {
              const passed = m.result?.outcome === "PASSED";
              return (
                <li key={m.id} className="space-y-1 px-3 py-2.5">
                  <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <span className="min-w-0 break-words text-body text-foreground">{m.title}</span>
                    {m.result ? (
                      <ToneBadge tone={passed ? "success" : "destructive"}>
                        {passed ? t("meetings.governance.outcome_PASSED") : t("meetings.governance.outcome_FAILED")}
                      </ToneBadge>
                    ) : null}
                  </div>
                  <p className="text-caption tabular-nums text-muted-foreground">
                    {t("meetings.governance.votedTally", {
                      yes: m.result?.yes ?? 0,
                      no: m.result?.no ?? 0,
                      abstain: m.result?.abstain ?? 0,
                    })}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {aiDecisions.length > 0 ? (
        <ul className="space-y-1.5">
          {aiDecisions.map((d, i) => (
            <li key={i} className="flex items-start gap-2 text-body text-foreground">
              <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
              <span className="min-w-0">{d}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
