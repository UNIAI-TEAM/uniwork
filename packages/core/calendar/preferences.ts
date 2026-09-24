export type CalendarViewMode = "day" | "work_week" | "week" | "month";

export type CalendarPreferences = {
  viewMode: CalendarViewMode;
  mine: boolean;
  showWeekends: boolean;
};

export const DEFAULT_CALENDAR_PREFERENCES: CalendarPreferences = {
  viewMode: "month",
  mine: false,
  showWeekends: true,
};

type SearchParamsReader = Pick<URLSearchParams, "get">;

const CALENDAR_VIEW_MODES: CalendarViewMode[] = [
  "day",
  "work_week",
  "week",
  "month",
];

function isCalendarViewMode(value: string | null): value is CalendarViewMode {
  return CALENDAR_VIEW_MODES.some((mode) => mode === value);
}

export function parseCalendarPreferences(
  params: SearchParamsReader,
): CalendarPreferences {
  const view = params.get("view");
  const mine = params.get("mine");
  const weekends = params.get("weekends");

  return {
    viewMode: isCalendarViewMode(view)
      ? view
      : DEFAULT_CALENDAR_PREFERENCES.viewMode,
    mine: mine === "1",
    showWeekends: weekends !== "0",
  };
}

export function calendarPreferencesSearch(
  currentSearch: string,
  preferences: CalendarPreferences,
): string {
  const params = new URLSearchParams(currentSearch);

  if (preferences.viewMode === DEFAULT_CALENDAR_PREFERENCES.viewMode) {
    params.delete("view");
  } else {
    params.set("view", preferences.viewMode);
  }

  if (preferences.mine) params.set("mine", "1");
  else params.delete("mine");

  if (preferences.showWeekends) params.delete("weekends");
  else params.set("weekends", "0");

  return params.toString();
}
