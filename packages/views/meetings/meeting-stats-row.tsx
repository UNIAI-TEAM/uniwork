"use client";
import { useTranslation } from "react-i18next";
import type { MeetingStatistics } from "@uniwork/core/types/meeting";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <div className="text-caption text-muted-foreground">{label}</div>
      <div className="text-title font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

export function MeetingStatsRow({ stats }: { stats: MeetingStatistics | null | undefined }) {
  const { t } = useTranslation();
  if (!stats) return null;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Stat label={t("meetings.statTotal")} value={stats.total} />
      <Stat label={t("meetings.statScheduled")} value={stats.scheduled} />
      <Stat label={t("meetings.statInProgress")} value={stats.in_progress} />
      <Stat label={t("meetings.statEnded")} value={stats.ended} />
    </div>
  );
}
