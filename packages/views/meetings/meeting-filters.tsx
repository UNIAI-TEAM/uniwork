"use client";
import { useTranslation } from "react-i18next";
import { Input } from "@uniwork/ui/components/ui/input";
import { cn } from "@uniwork/ui/lib/utils";

const FILTERS = ["", "SCHEDULED", "IN_PROGRESS", "ENDED", "CANCELED"] as const;

export function MeetingFilters({
  status,
  query,
  onStatus,
  onQuery,
}: {
  status: string;
  query: string;
  onStatus: (status: string) => void;
  onQuery: (q: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div role="group" aria-label={t("meetings.status")} className="flex flex-wrap gap-1">
        {FILTERS.map((value) => {
          const active = status === value;
          const label = value ? t(`meetings.status_${value}`) : t("meetings.filterAll");
          return (
            <button
              key={value || "all"}
              type="button"
              aria-pressed={active}
              onClick={() => onStatus(value)}
              className={cn(
                "h-11 rounded-md px-2.5 text-label sm:h-8",
                active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
      <Input
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder={t("meetings.searchPlaceholder")}
        className="min-w-0 w-full sm:max-w-56"
        aria-label={t("meetings.searchPlaceholder")}
      />
    </div>
  );
}
