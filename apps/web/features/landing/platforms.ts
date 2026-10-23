/**
 * The four platforms a buyer most often already owns, in the order the page
 * compares them: the office suite, then document/database and work platforms.
 *
 * Original vendor icons identify comparison options alongside their names;
 * the page describes documented capabilities without scores or endorsement.
 */
export const PLATFORMS = {
  ms365: { ns: "landing.why.ms365" },
  notion: { ns: "landing.why.notion" },
  clickup: { ns: "landing.why.clickup" },
  coda: { ns: "landing.why.coda" },
} as const;

export type PlatformKey = keyof typeof PLATFORMS;

/** Stable order for every list that renders all of them. */
export const PLATFORM_KEYS = ["ms365", "notion", "clickup", "coda"] as const satisfies readonly PlatformKey[];
