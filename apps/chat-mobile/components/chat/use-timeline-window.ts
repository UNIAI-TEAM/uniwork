// An open room's sliding window (data/timeline-window.ts): each time the
// reader comes back to the newest message, the older pages scrolled in on the
// way up are dropped, so a long scroll-back does not leave a thousand messages
// to lay out on every frame. Never while the room shows a page around an
// older message, nor while the reader is up in the history.
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { trimRoomTimelineTail } from "@/data/timeline-window";

export function useTimelineWindow(wsId: string, roomId: string, atLatest: boolean): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (atLatest) trimRoomTimelineTail(qc, wsId, roomId);
  }, [qc, wsId, roomId, atLatest]);
}
