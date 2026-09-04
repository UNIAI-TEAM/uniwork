"use client";
import { useTranslation } from "react-i18next";
import type { MeetingStatistics } from "@uniwork/core/types/meeting";
import { Input } from "@uniwork/ui/components/ui/input";
import { cn } from "@uniwork/ui/lib/utils";

const FILTERS = ["", "SCHEDULED", "IN_PROGRESS", "ENDED", "CANCELED"] as const;

function countFor(stats: MeetingStatistics | null | undefined, value: string): number | undefined {
  if (!stats) return undefined;
  switch (value) {
    case "SCHEDULED":
      return stats.scheduled;
    case "IN_PROGRESS":
      return stats.in_progress;
    case "ENDED":
      return stats.ended;
    case "CANCELED":
      return stats.canceled;
    default:
      return undefined;
  }
}

export function MeetingFilters({
  status,
  query,
  stats,
  onStatus,
  onQuery,
}: {
  status: string;
  query: string;
  stats?: MeetingStatistics | null;
  onStatus: (status: string) => void;
  onQuery: (q: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <Input
        type="search"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder={t("meetings.searchPlaceholder")}
        className="min-w-0 w-full"
        aria-label={t("meetings.searchPlaceholder")}
      />
      <div role="group" aria-label={t("meetings.status")} className="flex flex-wrap gap-1">
        {FILTERS.map((value) => {
          const active = status === value;
          const label = value ? t(`meetings.status_${value}`) : t("meetings.filterAll");
          const count = countFor(stats, value);
          return (
            <button
              key={value || "all"}
              type="button"
              aria-pressed={active}
              onClick={() => onStatus(value)}
              className={cn(
                "flex h-11 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-label transition-colors duration-100 sm:h-8",
                active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
              )}
            >
              {label}
              {count ? <span className="font-mono text-caption tabular-nums text-faint-foreground">{count}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
