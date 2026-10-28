"use client";
import { useLayoutEffect, type RefObject } from "react";
import { useReducedMotion } from "motion/react";
import { UI_EASE_SETTLE } from "@uniwork/ui/lib/motion";

/** The room opens from the join button as a growing circle (clip D). */
const WASH_MS = 450;
// A press whose room never came (a refusal, a leave) must not wash a later screen.
const STALE_MS = 60_000;

type Wash = { x: number; y: number; at: number; shell: Element; nodes: Element[] };
// One join at a time: the press marks it, the shell that held the prejoin plays it once.
let pending: Wash | null = null;

/**
 * The join press: remember the button's centre and the screen it sits on, so
 * the next screen in the same room shell (`[data-join-wash]`, set by `useJoinWash`) opens from there.
 * It never waits: the join goes on at once and the wash plays when the room
 * draws its first frame.
 */
export function markJoinWash(button: HTMLElement) {
  const shell = button.closest("[data-join-wash]");
  if (!shell) return;
  const r = button.getBoundingClientRect();
  pending = { x: r.x + r.width / 2, y: r.y + r.height / 2, at: Date.now(), shell, nodes: [...shell.children] };
}

/**
 * On the room shell: once the screen the press marked has left it, the new
 * frame is clipped to a circle at the button that grows over a still of the
 * old screen in ≈450ms `--ease-settle`. Reduced motion swaps at once.
 */
export function useJoinWash(ref: RefObject<HTMLElement | null>) {
  const reduce = useReducedMotion() ?? false;
  useLayoutEffect(() => {
    const el = ref.current;
    // The mark a join press looks for.
    el?.setAttribute("data-join-wash", "");
    const wash = pending;
    if (!el || !wash || wash.shell !== el || wash.nodes.some((n) => el.contains(n))) return;
    pending = null;
    if (reduce || Date.now() - wash.at > STALE_MS || typeof el.animate !== "function") return;
    // The old screen's nodes are detached but whole: a copy of them stands behind while the circle grows.
    const still = el.cloneNode(false) as HTMLElement;
    still.removeAttribute("data-testid");
    still.removeAttribute("data-join-wash");
    still.setAttribute("aria-hidden", "true");
    still.inert = true;
    still.append(...wash.nodes.map((n) => n.cloneNode(true)));
    el.before(still);
    const at = `at ${wash.x}px ${wash.y}px`;
    const anim = el.animate([{ clipPath: `circle(22px ${at})` }, { clipPath: `circle(150vmax ${at})` }], {
      duration: WASH_MS,
      easing: `cubic-bezier(${UI_EASE_SETTLE.join(",")})`,
    });
    const done = () => still.remove();
    anim.onfinish = done;
    anim.oncancel = done;
  });
}
