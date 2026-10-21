// A busy room opened with more unread messages than its newest page holds
// (audit UX P2 "no unread divider", the review's "busy room" case): the
// reader's pointer is further up than what is loaded, so the unread line has
// nowhere to go. Older pages load by cursor, UNREAD_BACKFILL_PAGES at most,
// until the pointer is on screen (lib/unread-divider.ts › unreadLineNeedsOlder);
// the list then lands on the line (message-list.tsx). Never while a fetch
// runs (a page asked mid-refresh would cancel it), and never for a room
// opened on a linked message.
import { useEffect, useRef } from "react";
import type { TimelineMessage } from "@/lib/timeline-display";
import { UNREAD_BACKFILL_PAGES, unreadLineNeedsOlder } from "@/lib/unread-divider";

export interface UnreadBackfillInput {
  messages: readonly TimelineMessage[];
  userId: string;
  /** The reader's pointer when the room opened (null: nothing unread, nothing to find). */
  since: string | null;
  /** The oldest message of the room is loaded. */
  complete: boolean;
  /** An older page can be asked now: one exists, nothing is fetching, the room shows its newest messages. */
  canLoadOlder: boolean;
  loadOlder: () => void;
}

export function useUnreadBackfill({ messages, userId, since, complete, canLoadOlder, loadOlder }: UnreadBackfillInput): void {
  const asked = useRef(0);
  useEffect(() => {
    if (!canLoadOlder || asked.current >= UNREAD_BACKFILL_PAGES || !unreadLineNeedsOlder(messages, userId, since, complete)) return;
    asked.current += 1;
    loadOlder();
  }, [messages, userId, since, complete, canLoadOlder, loadOlder]);
}
