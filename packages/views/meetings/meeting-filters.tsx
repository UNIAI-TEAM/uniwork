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
    <div className="flex shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
      <Input
        type="search"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder={t("meetings.searchPlaceholder")}
        className="min-w-0 w-full lg:max-w-sm"
        aria-label={t("meetings.searchPlaceholder")}
      />
      <div
        role="group"
        aria-label={t("meetings.status")}
        className="flex flex-wrap gap-1"
      >
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
                "flex h-11 cursor-pointer items-center gap-1.5 rounded-full px-3 text-label transition-colors duration-100 sm:h-8",
                active
                  ? "bg-foreground text-background"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {label}
              {count ? (
                <span
                  className={cn(
                    "font-mono text-caption tabular-nums",
                    active ? "text-background/70" : "text-faint-foreground",
                  )}
                >
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
