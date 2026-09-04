"use client";

import { useEffect, useRef } from "react";

export type CallRingtoneKind = "incoming" | "outgoing";

/** Plays a simple looped ringtone via Web Audio until kind becomes null. */
export function useCallRingtone(kind: CallRingtoneKind | null) {
  const timeoutsRef = useRef<number[]>([]);
  const oscillatorsRef = useRef<OscillatorNode[]>([]);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    let stopped = false;
    const clearAll = () => {
      stopped = true;
      for (const id of timeoutsRef.current) {
        window.clearTimeout(id);
      }
      timeoutsRef.current = [];
      for (const osc of oscillatorsRef.current) {
        try {
          osc.stop();
        } catch {
          // already stopped
        }
      }
      oscillatorsRef.current = [];
      const ctx = ctxRef.current;
      ctxRef.current = null;
      if (ctx && ctx.state !== "closed") {
        void ctx.close();
      }
    };

    clearAll();
    stopped = false;

    if (!kind || typeof window === "undefined") return clearAll;

    const ctx = new AudioContext();
    ctxRef.current = ctx;

    const schedule = (fn: () => void, delayMs: number) => {
      const id = window.setTimeout(fn, delayMs);
      timeoutsRef.current.push(id);
    };

    const tone = (frequency: number, durationMs: number, delayMs = 0) => {
      schedule(() => {
        if (stopped || ctx.state === "closed") return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = frequency;
        gain.gain.value = 0.12;
        osc.connect(gain);
        gain.connect(ctx.destination);
        oscillatorsRef.current.push(osc);
        const start = ctx.currentTime;
        osc.start(start);
        osc.stop(start + durationMs / 1000);
      }, delayMs);
    };

    const loop = () => {
      if (stopped) return;
      if (kind === "incoming") {
        tone(440, 180);
        tone(480, 180, 220);
        schedule(loop, 2200);
      } else {
        tone(400, 320);
        tone(350, 320, 380);
        schedule(loop, 1800);
      }
    };

    void ctx.resume().then(loop);

    return clearAll;
  }, [kind]);
}
