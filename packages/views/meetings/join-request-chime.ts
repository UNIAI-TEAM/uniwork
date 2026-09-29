"use client";

/**
 * A short two-note chime for "someone is asking to join". Web Audio, no asset:
 * the host already interacted with the page to enter the room, so the context
 * is allowed to start. Silently does nothing where audio is unavailable.
 */
export function playJoinRequestChime(): void {
  if (typeof window === "undefined" || typeof window.AudioContext !== "function") return;
  let ctx: AudioContext;
  try {
    ctx = new window.AudioContext();
  } catch {
    return;
  }
  const note = (frequency: number, startOffset: number, duration: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;
    const start = ctx.currentTime + startOffset;
    // A quick fade in and out keeps the notes from clicking.
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.14, start + 0.02);
    gain.gain.linearRampToValueAtTime(0, start + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration);
  };
  void ctx
    .resume()
    .then(() => {
      note(660, 0, 0.18);
      note(880, 0.2, 0.26);
      window.setTimeout(() => void ctx.close().catch(() => {}), 800);
    })
    .catch(() => {});
}
