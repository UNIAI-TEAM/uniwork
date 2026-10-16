"use client";
import { useLayoutEffect, useRef, type RefObject } from "react";

/** Preserve a card's identity as React moves it between status columns. */
export function useDemoItemMotion(stage: RefObject<HTMLElement | null>, step: number, enabled: boolean) {
  const previous = useRef(new Map<string, DOMRect>());
  const lastStep = useRef(step);
  useLayoutEffect(() => {
    const surface = stage.current;
    if (!surface) return;
    const animations: Animation[] = [];
    const clipping = new Map<HTMLElement, string>();
    const next = new Map<string, DOMRect>();
    const scaleX = surface.getBoundingClientRect().width / surface.offsetWidth || 1;
    const scaleY = surface.getBoundingClientRect().height / surface.offsetHeight || 1;
    surface.querySelectorAll<HTMLElement>("[data-demo-item]").forEach(item => {
      const key = item.dataset.demoItem!;
      const rect = item.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      next.set(key, rect);
      const before = previous.current.get(key);
      // Loop reset is instantaneous, not a backwards undo of the example.
      if (!enabled || step <= lastStep.current || !before) return;
      const x = (before.left - rect.left) / scaleX;
      const y = (before.top - rect.top) / scaleY;
      if (Math.abs(x) + Math.abs(y) < 2) return;
      const viewport = item.closest<HTMLElement>("[data-demo-motion-viewport]");
      if (viewport) { if (!clipping.has(viewport)) clipping.set(viewport, viewport.style.overflow); viewport.style.overflow = "visible"; }
      item.style.zIndex = "3";
      const animation = item.animate([
        { transform: `translate(${x}px, ${y}px)` },
        { transform: "translate(0, 0)" },
      ], { duration: 680, easing: "cubic-bezier(.16,1,.3,1)" });
      animation.onfinish = () => { item.style.removeProperty("z-index"); if (viewport) viewport.style.overflow = clipping.get(viewport) ?? ""; };
      animations.push(animation);
    });
    previous.current = next;
    lastStep.current = step;
    // Interruption settles the real result, never strands a floating clone.
    return () => {
      animations.forEach(animation => animation.cancel());
      clipping.forEach((overflow, viewport) => { viewport.style.overflow = overflow; });
      surface.querySelectorAll<HTMLElement>("[data-demo-item]").forEach(item => item.style.removeProperty("z-index"));
    };
  }, [stage, step, enabled]);
}
