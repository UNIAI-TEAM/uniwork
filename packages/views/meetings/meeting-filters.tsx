"use client";
import { useTranslation } from "react-i18next";
import type { MeetingStatistics } from "@uniwork/core/types/meeting";
import { Input } from "@uniwork/ui/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@uniwork/ui/components/ui/toggle-group";

/** Server statuses a chip filters on, in reading order; "" is every meeting. */
export const MEETING_FILTERS = ["", "SCHEDULED", "IN_PROGRESS", "ENDED", "CANCELED"] as const;
/** A toggle item needs a non-empty value; "all" stands in for "". */
const ALL = "all";

/**
 * The server filters on the stored status; the row badge shows the status as
 * the viewer's clock reads it (`displayMeetingStatus`). A stored SCHEDULED row
 * whose window passed is badged MISSED; a stored IN_PROGRESS row past its end
 * is badged OVERTIME. Each chip's label must cover every badge its rows can
 * wear — so the SCHEDULED chip reads "not started", not "scheduled".
 */
export const MEETING_FILTER_SHOWS: Record<string, readonly string[]> = {
  SCHEDULED: ["SCHEDULED", "MISSED"],
  IN_PROGRESS: ["IN_PROGRESS", "OVERTIME"],
  ENDED: ["ENDED"],
  CANCELED: ["CANCELED"],
};

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

// The inbox's category chip (notifications/inbox-toolbar.tsx): quiet at rest,
// raised on the surface when pressed, 44px on a coarse pointer.
const CHIP =
  "h-8 shrink-0 gap-1.5 rounded-md border border-transparent px-2.5 text-label font-medium text-muted-foreground transition-colors duration-micro pointer-coarse:h-11 " +
  "hover:bg-surface-hover hover:text-foreground aria-pressed:border-border aria-pressed:bg-surface aria-pressed:text-foreground aria-pressed:shadow-[var(--surface-shadow)]";

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
  // The statistics count the whole workspace; beside a search they would
  // promise rows the search does not return.
  const showCounts = !query.trim();
  const label = (value: string) => {
    if (!value) return t("meetings.filterAll");
    if (value === "SCHEDULED") return t("meetings.filter_SCHEDULED");
    return t(`meetings.status_${value}`);
  };
  return (
    <div className="flex shrink-0 flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
      <Input
        type="search"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder={t("meetings.searchPlaceholder")}
        className="w-full min-w-0 lg:max-w-xs"
        aria-label={t("meetings.searchPlaceholder")}
      />
      <ToggleGroup
        value={[status || ALL]}
        onValueChange={(v) => {
          // Pressing the chip that is already on would clear the group; a filter is always on.
          const next = v[0];
          if (next !== undefined) onStatus(next === ALL ? "" : next);
        }}
        aria-label={t("meetings.status")}
        spacing={1}
        // Wraps rather than scrolls: a clipped chip row gives no cue that more chips exist.
        className="-mx-1 w-full min-w-0 flex-wrap px-1 py-1 lg:w-auto"
      >
        {MEETING_FILTERS.map((value) => {
          const count = showCounts ? countFor(stats, value) : undefined;
          return (
            <ToggleGroupItem key={value || ALL} value={value || ALL} className={CHIP}>
              {label(value)}
              {count ? <span className="text-caption font-normal tabular-nums">{count}</span> : null}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
    </div>
  );
}
