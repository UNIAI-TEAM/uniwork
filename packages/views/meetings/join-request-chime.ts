"use client";

/** How long a suspended context may wait for the page to allow audio. */
const RESUME_TIMEOUT_MS = 1000;

type NavigatorWithActivation = Navigator & { userActivation?: { hasBeenActive: boolean } };

/**
 * A short two-note chime for "someone is asking to join". Web Audio, no asset.
 * Only plays on a page the person has interacted with: before that the
 * browser keeps the context suspended, and queued chimes would all ring at
 * once on the first click. Every context it opens is closed again, played or
 * not. Silently does nothing where audio is unavailable.
 */
export function playJoinRequestChime(): void {
  if (typeof window === "undefined" || typeof window.AudioContext !== "function") return;
  const activation = (navigator as NavigatorWithActivation).userActivation;
  if (activation && !activation.hasBeenActive) return;
  let ctx: AudioContext;
  try {
    ctx = new window.AudioContext();
  } catch {
    return;
  }
  const close = () => void ctx.close().catch(() => {});
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
  let settled = false;
  // A resume that never settles (no permission to play) must not leave the
  // context open, nor ring late.
  const giveUp = window.setTimeout(() => {
    if (settled) return;
    settled = true;
    close();
  }, RESUME_TIMEOUT_MS);
  ctx
    .resume()
    .then(() => {
      if (settled) return;
      settled = true;
      window.clearTimeout(giveUp);
      if (ctx.state !== "running") {
        close();
        return;
      }
      note(660, 0, 0.18);
      note(880, 0.2, 0.26);
      window.setTimeout(close, 800);
    })
    .catch(() => {
      settled = true;
      window.clearTimeout(giveUp);
      close();
    });
}
