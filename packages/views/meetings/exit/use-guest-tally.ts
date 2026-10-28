"use client";

import { useEffect } from "react";
import { useParticipants as useLiveKitParticipants } from "@livekit/components-react";
import { humanParticipants, ROSTER_EVENTS } from "../meeting-signals";

/**
 * What a guest's thank-you screen (board H) says about their visit, counted
 * on their own machine: a guest cannot read the attendance roll. Lives for the
 * page, across rejoins.
 */
export type GuestTally = { connectedMs: number; since: number | null; seen: Map<string, string> };

export function newGuestTally(): GuestTally {
  return { connectedMs: 0, since: null, seen: new Map() };
}

/** Minutes in the room so far (the running connection included) and the people seen, once each. */
export function tallySummary(tally: GuestTally, now: number): { minutes: number; people: number; names: string[] } {
  const ms = tally.connectedMs + (tally.since === null ? 0 : now - tally.since);
  return { minutes: Math.round(ms / 60_000), people: tally.seen.size, names: [...tally.seen.values()] };
}

/** Mounted inside the guest's LiveKitRoom: times the connection and notes everyone it sees. */
export function GuestTallyProbe({ tally }: { tally: GuestTally }) {
  const people = humanParticipants(useLiveKitParticipants({ updateOnlyOn: ROSTER_EVENTS }));
  useEffect(() => {
    tally.since = Date.now();
    return () => {
      if (tally.since !== null) tally.connectedMs += Date.now() - tally.since;
      tally.since = null;
    };
  }, [tally]);
  // The people the guest met: not themselves, and only once a name has arrived.
  useEffect(() => {
    for (const p of people) if (!p.isLocal && p.name) tally.seen.set(p.identity, p.name);
  }, [people, tally]);
  return null;
}
