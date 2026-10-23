// A room's timeline as its screen shows it: the newest page first, older pages
// chained by cursor, the page around an anchored message (a deep link, a
// search result, a quote outside the loaded window) while there is one, and
// this device's sends merged in until the server echoes them. Opening a room
// that was open before drops the older pages scrolled in last time and
// refreshes the newest; where its unread messages began is read from the
// inbox before the open marks them read. The screen only draws what this
// returns: no route or component reads or writes the cache for it. The
// person's queued reactions, votes, edits and deletes are laid over every
// copy the server sends back until they are delivered (lib/pending-ops-overlay.ts).
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { refreshRoomTimelineOnOpen } from "@/data/chat-timeline";
import { selectRoomSends, useChatSendStore } from "@/data/stores/chat-send-store";
import { selectRoomOps, usePendingOpsStore } from "@/data/stores/pending-ops-store";
import { overlayPendingOps } from "@/lib/pending-ops-overlay";
import { buildMainTimelineMessages } from "@/lib/timeline-display";
import { unreadSnapshot } from "@/lib/unread-divider";
import { roomAroundOptions, roomTimelineOptions, roomsOptions } from "./chat";

interface RoomTimelineInput {
  wsId: string;
  roomId: string;
  userId: string;
  /** The message the screen is anchored on; null shows the newest page. */
  anchorId: string | null;
}

export function useRoomTimeline({ wsId, roomId, userId, anchorId }: RoomTimelineInput) {
  const qc = useQueryClient();
  const timeline = useInfiniteQuery(roomTimelineOptions(wsId, roomId));
  // Where this room's unread messages began, read from the inbox before opening marks it read (lib/unread-divider.ts).
  const [unread] = useState(() => unreadSnapshot(qc.getQueryData(roomsOptions(wsId).queryKey)?.find((entry) => entry.id === roomId)));
  // Unread in the other conversations, for the back button.
  const otherUnread =
    useQuery(roomsOptions(wsId)).data?.reduce((sum, entry) => (entry.id === roomId ? sum : sum + (entry.unread_count ?? 0)), 0) ?? 0;

  // Reopening a room: drop the older pages scrolled in last time and refresh the newest.
  useEffect(() => {
    if (qc.getQueryData(roomTimelineOptions(wsId, roomId).queryKey)) refreshRoomTimelineOnOpen(qc, wsId, roomId);
  }, [qc, wsId, roomId]);

  const ops = usePendingOpsStore(useShallow((s) => selectRoomOps(s.ops, wsId, roomId, userId)));
  const latestRows = useMemo(() => overlayPendingOps(timeline.data ?? [], ops, userId), [timeline.data, ops, userId]);
  const anchorLoaded = anchorId ? latestRows.some((m) => m.id === anchorId) : true;
  const around = useQuery({ ...roomAroundOptions(wsId, roomId, anchorId ?? ""), enabled: !anchorLoaded && timeline.isSuccess });
  const aroundRows = anchorLoaded ? undefined : around.data;
  const anchorRows = useMemo(() => (aroundRows ? overlayPendingOps(aroundRows, ops, userId) : null), [aroundRows, ops, userId]);
  const sends = useChatSendStore(useShallow((s) => selectRoomSends(s.entries, wsId, roomId, userId)));
  const messages = useMemo(
    () => buildMainTimelineMessages({ anchorRows, latestRows, pending: sends, currentUserId: userId }),
    [anchorRows, latestRows, sends, userId],
  );

  return {
    timeline,
    messages,
    /** The rows of the page around the anchor while the screen shows it; null on the newest page. */
    anchorRows,
    /** The anchor's page is still loading. */
    anchorPending: !anchorLoaded && around.isPending,
    newestId: latestRows.at(-1)?.id ?? null,
    unread,
    otherUnread,
    /** The oldest message of the room is loaded: nothing older could be the first unread one. */
    historyComplete: timeline.isSuccess && !timeline.hasNextPage,
  };
}
