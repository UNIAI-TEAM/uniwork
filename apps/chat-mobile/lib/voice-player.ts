// A voice message's player controls (audit UX P3 "voice-player-basic"): the
// speeds it cycles through (1×, 1.5×, 2×, as WhatsApp and Telegram), a seek
// by a step that stays inside the clip (a screen reader's increment and
// decrement), a seek to where a tap landed on the bars, and how many bars the
// played part fills. Seconds throughout, as expo-audio reports them. Pure.

const VOICE_RATES = [1, 1.5, 2] as const;
export type VoiceRate = (typeof VOICE_RATES)[number];
/** How far one increment or decrement of the player moves, in seconds. */
export const VOICE_SEEK_STEP_S = 5;

/** The next speed after `rate`, round the cycle; an unknown rate starts it over. */
export function nextVoiceRate(rate: number): VoiceRate {
  const index = VOICE_RATES.indexOf(rate as VoiceRate);
  return VOICE_RATES[(index + 1) % VOICE_RATES.length] as VoiceRate;
}

/** `current` moved by `delta`, kept within the clip (a clip of unknown length only stops at its start). */
export function seekBy(current: number, delta: number, duration: number): number {
  const to = Math.max(0, current + delta);
  return duration > 0 ? Math.min(to, duration) : to;
}

/** The time a tap at `x` on bars `width` wide points at. */
export function seekToTap(x: number, width: number, duration: number): number {
  if (width <= 0 || duration <= 0) return 0;
  return (Math.min(Math.max(x, 0), width) / width) * duration;
}

/** How many of `bars` the played part fills. */
export function playedBars(current: number, duration: number, bars: number): number {
  return duration > 0 ? Math.round((Math.min(current, duration) / duration) * bars) : 0;
}
