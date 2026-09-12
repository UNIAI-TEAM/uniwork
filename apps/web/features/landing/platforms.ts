/**
 * The four platforms a buyer most often already owns, in the order the page
 * argues them: the office suite first because it is the one nearly everyone
 * has, then the three that each solved one side of the same problem.
 *
 * The ink colours are semantic tokens, not brand colours. Using each vendor's
 * own brand colour would read as an endorsement badge, and none of them is in
 * this repo's palette anyway.
 */
export const PLATFORMS = {
  ms365: { ns: "landing.why.ms365", ink: "text-info" },
  notion: { ns: "landing.why.notion", ink: "text-foreground" },
  clickup: { ns: "landing.why.clickup", ink: "text-warning" },
  coda: { ns: "landing.why.coda", ink: "text-brand-accent" },
} as const;

export type PlatformKey = keyof typeof PLATFORMS;

/** Stable order for every list that renders all of them. */
export const PLATFORM_KEYS = ["ms365", "notion", "clickup", "coda"] as const satisfies readonly PlatformKey[];

/** Each platform carries the same five problems; see the i18n file. */
export const PLATFORM_ISSUES = ["i1", "i2", "i3", "i4", "i5"] as const;
