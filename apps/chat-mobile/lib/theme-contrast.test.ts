// Every text colour the app draws on each surface, in both modes, at WCAG AA
// (4.5:1; the meta line under a bubble is 11 pt, so no large-text allowance).
// The web measures its rendered pages (e2e/onboarding-contrast.spec.ts); the
// phone's colours are tokens (lib/theme.ts, mirrored by global.css), so the
// pairs are checked here. A new surface or text slot that matters goes in PAIRS.
import { describe, expect, it } from "vitest";
import { contrastRatio } from "./contrast";
import { THEME } from "./theme";

type Slot = keyof typeof THEME.light;

/** [surface, text, where it is drawn]. */
const PAIRS: [Slot, Slot, string][] = [
  ["background", "foreground", "page text"],
  ["background", "mutedForeground", "secondary text"],
  ["background", "primary", "links and text buttons"],
  ["background", "destructive", "destructive actions"],
  ["card", "foreground", "sheets"],
  ["card", "mutedForeground", "sheet hints"],
  ["muted", "mutedForeground", "pills, the composer field's placeholder"],
  ["primary", "primaryForeground", "primary buttons"],
  ["chatBubbleOwn", "chatBubbleOwnForeground", "my bubble's text and the seen tick"],
  ["chatBubbleOwn", "chatBubbleOwnMeta", "my bubble's time, sent and delivered ticks"],
  ["chatBubbleOther", "foreground", "their bubble's text"],
  ["chatBubbleOther", "mutedForeground", "their bubble's time"],
  ["chatBubbleOther", "primary", "a link or my mention in their bubble"],
  ["chatChip", "chatChipForeground", "day chips, call logs, the load error on the wall"],
  ["chatChip", "primary", "the unread line's chip"],
  ["chatWall", "chatChipForeground", "the wall itself"],
  ["tintBlue", "tintBlueForeground", "tinted tiles"],
  ["tintRed", "tintRedForeground", "a missed call"],
  ["tintYellow", "tintYellowForeground", "a due reminder"],
  ["tintTeal", "tintTealForeground", "reminder cards"],
  ["tintGreen", "tintGreenForeground", "success tiles"],
  ["tintOrange", "tintOrangeForeground", "post cards"],
  ["destructiveSolid", "onSolid", "error toasts"],
  ["successSolid", "onSolid", "success toasts"],
  ["tintGraySolid", "onSolid", "a face's initials"],
  ["tintBlueSolid", "onSolid", "a face's initials"],
  ["tintVioletSolid", "onSolid", "a face's initials"],
  ["tintPinkSolid", "onSolid", "a face's initials"],
  ["tintOrangeSolid", "onSolid", "a face's initials"],
  ["tintYellowSolid", "onSolid", "a face's initials"],
  ["tintTealSolid", "onSolid", "a face's initials"],
  ["tintGreenSolid", "onSolid", "a face's initials"],
  ...([1, 2, 3, 4, 5, 6, 7, 8] as const).map((n): [Slot, Slot, string] => ["chatBubbleOther", `chatSender${n}`, "a sender's name in a group"]),
];

const AA = 4.5;

describe("theme contrast", () => {
  it.each(["light", "dark"] as const)("every text slot on its surface reaches AA in %s mode", (mode) => {
    const below = PAIRS.flatMap(([surface, text, where]) => {
      const ratio = contrastRatio(THEME[mode][surface], THEME[mode][text]);
      return ratio < AA ? [`${text} on ${surface} (${where}): ${ratio.toFixed(2)}:1`] : [];
    });
    expect(below).toEqual([]);
  });
});
