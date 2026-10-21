// The phone's text roles (audit P2 UX, dynamic type): one size per role, in
// type-scale.json, which tailwind.config.js turns into `text-<role>` classes
// and cn() (lib/utils.ts) teaches tailwind-merge to treat as font sizes. Each
// size is the base the system text-size setting scales (React Native scales
// every Text unless told otherwise); containers that hold text use min-height
// so a larger size grows them instead of clipping. Only badges cap their text,
// at BADGE_MAX_FONT_SCALE: a count in a small pill beside a name must not outgrow its row, and
// the element around it still reads the full count.
// type-scale.test.ts fails on Tailwind's default ramp (text-sm, text-lg…) or a
// raw `text-[13px]` in app/ and components/.

/** How far a badge's count grows with the system text size. */
export const BADGE_MAX_FONT_SCALE = 1.4;
