/**
 * The inbox's category chip (notifications/inbox-toolbar.tsx) as the meeting
 * screens use it: quiet at rest, raised on the surface when pressed, 44px on a
 * coarse pointer. The meeting list's status filters and the room's
 * "In the room | Attendance" switch are the same control, so they share it.
 */
export const MEETING_TOGGLE_CHIP =
  "h-8 shrink-0 gap-1.5 rounded-md border border-transparent px-2.5 text-label font-medium text-muted-foreground transition-colors duration-micro pointer-coarse:h-11 " +
  "hover:bg-surface-hover hover:text-foreground aria-pressed:border-border aria-pressed:bg-surface aria-pressed:text-foreground aria-pressed:shadow-[var(--surface-shadow)]";
