"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { Logo } from "@uniwork/ui/brand";
import { gsap } from "./animation/register-gsap";

/** A small companion that follows native scroll without taking focus or space. */
export function ScrollMascot() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return;

    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const aiStage = document.querySelector<HTMLElement>(".ai-stage");
    const footer = document.querySelector<HTMLElement>(".landing-site > footer");
    const moveX = gsap.quickTo(element, "x", { duration: 0.32, ease: "power3.out" });
    const moveY = gsap.quickTo(element, "y", { duration: 0.32, ease: "power3.out" });
    let frame = 0;
    let idleTimer = 0;
    let previousScroll = window.scrollY;
    let placed = false;

    const stop = () => {
      window.clearTimeout(idleTimer);
      element.dataset.running = "false";
    };

    const update = () => {
      frame = 0;
      const scroll = window.scrollY;
      const distance = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const progress = Math.min(1, Math.max(0, scroll / distance));
      const size = element.getBoundingClientRect().width;
      const stage = aiStage?.getBoundingClientRect();
      const footerTop = footer?.getBoundingClientRect().top ?? Infinity;
      const atAiStage = !!stage && stage.top < window.innerHeight * 0.78 && stage.bottom > window.innerHeight * 0.2;
      // Give the character a visible route through the viewport as the page
      // advances. Keep its body near the edge so the content remains readable.
      const route = progress * Math.PI * 12;
      const x = window.innerWidth - size * (0.92 + Math.sin(route * 0.5) * 0.06);
      let y = window.innerHeight * (0.49 + Math.sin(route) * 0.26) - size / 2;
      let hasClearLane = true;
      if (window.innerWidth < 768) {
        // At phone widths the mascot shares the content column. Move it clear
        // of buttons and links; hide it if no safe position is available.
        const minY = 96;
        const maxY = Math.max(minY, window.innerHeight - size - 16);
        const candidates = [0, -1, 1, -2, 2, -3, 3].map((step) =>
          Math.min(maxY, Math.max(minY, y + step * size * 1.1)),
        );
        const clear = candidates.find((candidate) =>
          [0.2, 0.5, 0.8].every((part) => {
            const behind = document.elementFromPoint(window.innerWidth - size * 0.55, candidate + size * part);
            return !behind?.closest("a, button, input, select, textarea, [role='button'], .lovable-preview-tools, .mobile-feature-story");
          }),
        );
        hasClearLane = clear !== undefined;
        if (clear !== undefined) y = clear;
      }
      const visible = !reducedMotion.matches && !document.hidden && scroll > 24 && !atAiStage && footerTop > window.innerHeight * 0.85 && hasClearLane;
      element.dataset.visible = String(visible);
      if (!placed) {
        gsap.set(element, { x, y });
        placed = true;
      } else {
        moveX(x);
        moveY(y);
      }

      const delta = scroll - previousScroll;
      previousScroll = scroll;
      if (visible && Math.abs(delta) > 1) {
        element.dataset.running = "true";
        element.style.setProperty("--mascot-stride-duration", `${Math.max(230, 420 - Math.abs(delta) * 5)}ms`);
        window.clearTimeout(idleTimer);
        idleTimer = window.setTimeout(stop, 150);
      } else if (!visible) {
        stop();
      }
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const visibility = () => {
      if (document.hidden) stop();
      schedule();
    };

    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    document.addEventListener("visibilitychange", visibility);
    reducedMotion.addEventListener("change", schedule);
    return () => {
      cancelAnimationFrame(frame);
      stop();
      gsap.killTweensOf(element);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("visibilitychange", visibility);
      reducedMotion.removeEventListener("change", schedule);
    };
  }, []);

  return (
    <div ref={host} className="landing-scroll-mascot" aria-hidden="true" data-visible="false" data-running="false">
      <div className="landing-scroll-mascot-figure">
        <Image src="/landing/mascot/uni-horse-v2.webp" alt="" fill unoptimized sizes="112px" />
        <span className="landing-scroll-mascot-mark"><Logo variant="mark" tone="mono" size={18} decorative /></span>
      </div>
    </div>
  );
}
