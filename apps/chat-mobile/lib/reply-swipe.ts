// Swipe to reply's drag (components/chat/swipe-to-reply.tsx), pure so the node
// tests hold it and marked as worklets so the gesture runs it on the UI thread.
// The bubble follows a rightward drag at half the finger's speed (the swipeable
// it replaced had friction 2) and stops at the threshold, where letting go
// quotes it: the design language board's 56 pt.

export const REPLY_SWIPE = 56;
const FRICTION = 2;

/** How far the bubble follows a drag: right only, at half speed, no further than the threshold. */
export function replyOffset(translationX: number): number {
  "worklet";
  return Math.min(REPLY_SWIPE, Math.max(0, translationX / FRICTION));
}

/** Whether letting go here quotes the message. */
export function shouldReply(offset: number): boolean {
  "worklet";
  return offset >= REPLY_SWIPE;
}
