/** Next local morning at 09:00 (common snooze default). */
export function emailHubSnoozeTomorrowMorning(from = new Date()): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

/** Same weekday next week at 09:00 local. */
export function emailHubSnoozeNextWeekMorning(from = new Date()): Date {
  const d = emailHubSnoozeTomorrowMorning(from);
  d.setDate(d.getDate() + 6);
  return d;
}

export function emailHubSnoozeToRFC3339(when: Date): string {
  return when.toISOString();
}
