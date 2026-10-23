// Which sheet a conversation shows over itself: at most one at a time, each
// with what it was opened for. One state instead of one flag per sheet, so two
// can never be up together, and a sheet's late `onClose` (iOS reports a
// dismissal after the next sheet may already be up) closes only itself.
import type { TimelineMessage } from "./timeline-display";

export type ConversationSheet =
  | { kind: "none" }
  /** The long-press menu of one message. */
  | { kind: "actions"; message: TimelineMessage }
  /** Every reaction, for one message. */
  | { kind: "emoji"; message: TimelineMessage }
  | { kind: "forward"; messageId: string }
  | { kind: "report"; messageId: string; senderId: string; name: string }
  /** The long-press menu of a link in a message. */
  | { kind: "link"; url: string }
  /** The photo viewer, opened on one photo. */
  | { kind: "image"; photo: { id: string; url: string; name: string } }
  /** The sticker and GIF picker. */
  | { kind: "expressions" }
  | { kind: "reminder" };

type ConversationSheetKind = ConversationSheet["kind"];

export type ConversationSheetAction =
  | { type: "open"; sheet: Exclude<ConversationSheet, { kind: "none" }> }
  | { type: "close"; kind: ConversationSheetKind };

export const NO_SHEET: ConversationSheet = { kind: "none" };

export function conversationSheetReducer(state: ConversationSheet, action: ConversationSheetAction): ConversationSheet {
  if (action.type === "open") return action.sheet;
  return state.kind === action.kind ? NO_SHEET : state;
}
