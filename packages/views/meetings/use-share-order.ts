"use client";
import { useRef } from "react";
import type { TrackReferenceOrPlaceholder } from "@livekit/components-react";
import { Track } from "livekit-client";
import { newestSharesFirst, shareTrackSid } from "./conference-layout";

/**
 * The stage's screen-share order, newest first (see newestSharesFirst). A
 * share is stamped the first time this client sees it, which for the
 * presenter's own is when it was published, and the stamp goes when the share
 * ends, so a share started again counts as new.
 */
export function useShareOrder(tracks: readonly TrackReferenceOrPlaceholder[]): string[] {
  const seenAt = useRef(new Map<string, number>());
  const memo = useRef<{ key: string; order: string[] }>({ key: "", order: [] });
  const shares = tracks
    .filter((t) => t.source === Track.Source.ScreenShare)
    .map((t) => ({ sid: shareTrackSid(t), identity: t.participant.identity }));

  // Recomputed only when the set of shares changes, so a render for any other
  // reason (and StrictMode's second pass) leaves the stamps alone.
  const key = shares.map((s) => s.sid).join("\n");
  if (memo.current.key !== key) {
    const now = Date.now();
    const stamps = seenAt.current;
    const present = new Set(shares.map((s) => s.sid));
    for (const sid of stamps.keys()) if (!present.has(sid)) stamps.delete(sid);
    for (const s of shares) if (!stamps.has(s.sid)) stamps.set(s.sid, now);
    memo.current = {
      key,
      order: newestSharesFirst(shares.map((s) => ({ ...s, seenAt: stamps.get(s.sid) ?? now }))),
    };
  }
  return memo.current.order;
}
