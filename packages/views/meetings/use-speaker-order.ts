"use client";
import { useEffect, useRef, useState } from "react";
import { promoteSpeakers, SPEAKER_HOLD_MS } from "./conference-layout";

type Promotion = { key: string; order: string[]; retryAt?: number };

/**
 * The stage's speaker order, with a hold: a promoted speaker keeps their tile
 * for `holdMs` after they last spoke, and a newcomer swaps with one quiet tile
 * instead of pushing every tile back a place (see promoteSpeakers).
 *
 * LiveKit only reports when the set of speakers changes, so someone who was
 * speaking at the previous report is stamped as speaking until this one.
 */
export function useSpeakerOrder(
  cameras: readonly string[],
  slots: number,
  speaking: readonly string[],
  holdMs = SPEAKER_HOLD_MS,
): string[] {
  const lastSpokeAt = useRef(new Map<string, number>());
  const previousSpeaking = useRef<readonly string[]>([]);
  const promotion = useRef<Promotion>({ key: "", order: [] });
  const [tick, setTick] = useState(0);

  // Recomputed only when an input changes, so a render for any other reason
  // (and StrictMode's second pass) leaves the order and the stamps alone.
  const key = `${cameras.join("\n")}|${slots}|${speaking.join("\n")}|${holdMs}|${tick}`;
  if (promotion.current.key !== key) {
    const now = Date.now();
    const stamps = lastSpokeAt.current;
    for (const id of previousSpeaking.current) stamps.set(id, now);
    for (const id of speaking) stamps.set(id, now);
    previousSpeaking.current = speaking;
    const present = new Set(cameras);
    for (const id of stamps.keys()) if (!present.has(id)) stamps.delete(id);
    const next = promoteSpeakers(promotion.current.order, {
      cameras,
      slots,
      speaking,
      lastSpokeAt: stamps,
      now,
      holdMs,
    });
    promotion.current = { key, ...next };
  }

  const { retryAt } = promotion.current;
  useEffect(() => {
    if (retryAt === undefined) return;
    const id = window.setTimeout(() => setTick((n) => n + 1), Math.max(0, retryAt - Date.now()));
    return () => window.clearTimeout(id);
  }, [retryAt, key]);

  return promotion.current.order;
}
