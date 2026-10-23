// The phone's text roles (dynamic type): one size per role, in
// type-scale.json, which tailwind.config.js turns into `text-<role>` classes
// and cn() (lib/utils.ts) teaches tailwind-merge to treat as font sizes. Each
// size is the base the system text-size setting scales (React Native scales
// every Text unless told otherwise); containers that hold text use min-height
// so a larger size grows them instead of clipping. Only badges cap their text,
// at BADGE_MAX_FONT_SCALE: a count in a small pill beside a name must not outgrow its row, and
// the element around it still reads the full count; tab labels (TAB_LABEL_MAX_FONT_SCALE) and the
// sign-in screen's display title (DISPLAY_MAX_FONT_SCALE) stop growing for the reasons beside them.
// type-scale.test.ts fails on Tailwind's default ramp (text-sm, text-lg…) or a
// raw `text-[13px]` in app/ and components/.

/** How far a badge's count grows with the system text size. */
export const BADGE_MAX_FONT_SCALE = 1.4;

/**
 * Where the accessibility text sizes begin: iOS's first "Larger Accessibility Size" (AX1) is about 1.6× the
 * default, and Android's 200 % is 2.0. From here a row that sets a name, icons and a time side by side stacks
 * them instead (Slack, Messages; Material's reflow at 200 %): one line truncated to "Ng…" is no use to anyone.
 */
export const LARGE_TEXT_SCALE = 1.6;

/** A tab label grows this far with the system text size, as a native tab bar's fixed label does not at all. */
export const TAB_LABEL_MAX_FONT_SCALE = 1.3;

/**
 * How far a display title (`text-display`, 28 pt) grows with the system text size: to 56 pt, past the first
 * accessibility size, as Apple's own Title 1 (28 pt) stops near 58 pt at AX5 while body text keeps growing. Uncapped,
 * AX5 (3.57×) sets it at 100 pt, where "Welcome" no longer fits a 390 pt phone's line and iOS breaks it mid-word.
 */
export const DISPLAY_MAX_FONT_SCALE = 2;

/** Whether the system text size is one of the accessibility sizes (LARGE_TEXT_SCALE). */
export function isLargeText(fontScale: number): boolean {
  return fontScale >= LARGE_TEXT_SCALE;
}
