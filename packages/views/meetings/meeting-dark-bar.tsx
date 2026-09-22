/** Dark shell for the in-room control bar on the video stage. */
export const MEETING_DARK_BAR =
  "pointer-events-auto flex items-center gap-2 rounded-2xl border border-meeting-bar-border bg-meeting-bar-bg p-2 shadow-floating sm:p-2.5";

// Chips on the bar use `<Button variant="meetingChip">` (packages/ui button.tsx),
// which replaced the `!important` class stack that used to live here.
