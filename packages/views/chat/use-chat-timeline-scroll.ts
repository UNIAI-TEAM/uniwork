import type { RefObject } from "react";

/** Hysteresis: avoid toggling “away from latest” every frame at the bottom edge. */
export const CHAT_AWAY_ENTER_PX = 150;
export const CHAT_AWAY_LEAVE_PX = 64;

export type ChatScrollAwayTransition = "entered-away" | "returned-bottom" | "none";

export function applyChatScrollAwayHysteresis(
  scrollEl: HTMLDivElement,
  stickToBottomRef: RefObject<boolean>,
  awayFromLatestRef: RefObject<boolean>,
): ChatScrollAwayTransition {
  const distanceFromBottom =
    scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;

  if (distanceFromBottom <= CHAT_AWAY_LEAVE_PX) {
    stickToBottomRef.current = true;
    if (awayFromLatestRef.current) {
      awayFromLatestRef.current = false;
      return "returned-bottom";
    }
    return "none";
  }

  if (distanceFromBottom > CHAT_AWAY_ENTER_PX) {
    stickToBottomRef.current = false;
    if (!awayFromLatestRef.current) {
      awayFromLatestRef.current = true;
      return "entered-away";
    }
    return "none";
  }

  return "none";
}
