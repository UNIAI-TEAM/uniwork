"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { defaultStorage } from "@uniwork/core/platform";
import type { MeetingJoinRequest } from "@uniwork/core/types";
import { playJoinRequestChime } from "./join-request-chime";

const MUTE_KEY = "uniwork_meeting_join_chime_muted";

function readMuted(): boolean {
  try {
    return defaultStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * One chime per batch of new knocks, unless this host turned it off. Guests
 * already waiting when the host arrives count as new: nobody has heard them.
 * The choice is per browser — a quiet office and a headset are per device.
 */
export function useJoinRequestChime(pending: MeetingJoinRequest[]) {
  const [muted, setMutedState] = useState(readMuted);
  const heard = useRef<Set<string>>(new Set());

  useEffect(() => {
    const current = new Set(pending.map((r) => r.id));
    for (const id of heard.current) if (!current.has(id)) heard.current.delete(id);
    const fresh = pending.filter((r) => !heard.current.has(r.id));
    for (const r of fresh) heard.current.add(r.id);
    if (fresh.length > 0 && !muted) playJoinRequestChime();
  }, [pending, muted]);

  const setMuted = useCallback((next: boolean) => {
    setMutedState(next);
    try {
      if (next) defaultStorage.setItem(MUTE_KEY, "1");
      else defaultStorage.removeItem(MUTE_KEY);
    } catch {
      // Storage off (private mode): the choice lasts for this room only.
    }
  }, []);

  return { muted, setMuted };
}
