import { gsap } from "./register-gsap";

/**
 * The shared vocabulary of the landing page's motion. One duration, one ease,
 * one travel distance: sections differ by WHAT moves, never by how fast, so a
 * long scroll reads as one page rather than nine.
 *
 * Only `transform` and `opacity` are ever animated. Nothing here touches
 * width, height, top, margin or clip-path, so no tween can force layout.
 */
export const DURATION = 0.5;
export const EASE = "power2.out";
/** Vertical travel for an entrance, in px. Small on purpose. */
export const RISE = 14;
/** Seconds between items in a staggered group. */
export const STAGGER = 0.07;

/** Where a section starts animating: a little before its top clears the fold. */
export const START = "top 82%";

/**
 * Runs `build` under two media conditions and hands it whether motion is
 * wanted. matchMedia reverts everything it created — tweens AND ScrollTriggers
 * — when a condition stops matching, which is also what makes the reduced
 * motion switch take effect without a reload.
 *
 * The reduce branch is not "no animation": elements a tween would have faded in
 * must still end up visible, so callers use `motion === false` to `gsap.set()`
 * the end state. Returning early instead would leave anything with a
 * `gsap.from()` start state stuck at opacity 0.
 */
export function withMotionPreference(
  scope: Element | null,
  build: (motion: boolean) => void,
): () => void {
  const mm = gsap.matchMedia();
  mm.add(
    { reduce: "(prefers-reduced-motion: reduce)", motion: "(prefers-reduced-motion: no-preference)" },
    (context) => {
      build(context.conditions?.motion === true);
    },
    scope ?? undefined,
  );
  return () => void mm.revert();
}

/** The default entrance: rise and fade, once, on scroll. */
export function revealFrom(targets: gsap.TweenTarget, trigger: Element, stagger = 0): gsap.core.Tween {
  return gsap.from(targets, {
    opacity: 0,
    y: RISE,
    duration: DURATION,
    ease: EASE,
    stagger,
    scrollTrigger: { trigger, start: START, once: true },
  });
}
