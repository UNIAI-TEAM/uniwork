"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { defaultStorage } from "@uniwork/core/platform";
import type { MeetingJoinRequest } from "@uniwork/core/types";
import { playJoinRequestChime } from "./join-request-chime";

const MUTE_KEY = "uniwork_meeting_join_chime_muted";
/** This page's choice, so a blocked storage still keeps it for the room. */
let pageChoice: boolean | null = null;

function readMuted(): boolean {
  if (pageChoice !== null) return pageChoice;
  try {
    return defaultStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * One chime per batch of new knocks, unless this host turned it off. Guests
 * already waiting when the host arrives count as new: nobody has heard them.
 * The choice is read when a knock arrives, so the toggle in the people tab
 * takes effect at once.
 */
export function useJoinRequestChime(pending: MeetingJoinRequest[]) {
  const heard = useRef<Set<string>>(new Set());

  useEffect(() => {
    const current = new Set(pending.map((r) => r.id));
    for (const id of heard.current) if (!current.has(id)) heard.current.delete(id);
    const fresh = pending.filter((r) => !heard.current.has(r.id));
    for (const r of fresh) heard.current.add(r.id);
    if (fresh.length > 0 && !readMuted()) playJoinRequestChime();
  }, [pending]);
}

/** The chime switch. The choice is per browser — a quiet office and a headset are per device. */
export function useJoinRequestChimeSetting() {
  const [muted, setMutedState] = useState(readMuted);
  const setMuted = useCallback((next: boolean) => {
    setMutedState(next);
    pageChoice = next;
    try {
      if (next) defaultStorage.setItem(MUTE_KEY, "1");
      else defaultStorage.removeItem(MUTE_KEY);
    } catch {
      // Storage off (private mode): the choice lasts for this page only.
    }
  }, []);
  return { muted, setMuted };
}
