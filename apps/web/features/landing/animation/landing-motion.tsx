"use client";
import { useEffect } from "react";
import { gsap, ScrollTrigger } from "./register-gsap";

/** Framed scenes expand into view; copy arrives once and stays readable.
 * No scroll hijacking, pinning, blurred seams or decorative page-edge lines. */
export function LandingMotion() {
  useEffect(() => {
    const root = document.querySelector("[data-design-contract]");
    if (!root) return;
    const decisionSections = Array.from(root.querySelectorAll<HTMLElement>(".pricing-section, .landing-faq"));
    const visibleDecisions = new Set<HTMLElement>();
    const updateDecisionMotion = () => decisionSections.forEach((section) => {
      section.dataset.motionVisible = String(document.visibilityState === "visible" && visibleDecisions.has(section));
    });
    const decisionObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const section = entry.target as HTMLElement;
        if (entry.isIntersecting) visibleDecisions.add(section);
        else visibleDecisions.delete(section);
      });
      updateDecisionMotion();
    }, { threshold: .08 });
    decisionSections.forEach((section) => { section.dataset.motionVisible = "false"; decisionObserver.observe(section); });
    document.addEventListener("visibilitychange", updateDecisionMotion);
    const mm = gsap.matchMedia();
    mm.add({ motion: "(prefers-reduced-motion: no-preference)", desktop: "(min-width: 768px)" }, (context) => {
      if (!context.conditions?.motion) return;
      const desktop = context.conditions.desktop;
      root.querySelectorAll<HTMLElement>(".platform-section, .ai-stage, .landing-trust-story, .landing-future-story, .pricing-section, .final-section").forEach((frame) => {
        gsap.fromTo(frame, { scale: desktop ? .94 : .975, y: desktop ? 40 : 18 }, {
          scale: 1, y: 0, ease: "none",
          scrollTrigger: { trigger: frame, start: "top 98%", end: "top 54%", scrub: .35, invalidateOnRefresh: true },
        });
      });

      const arrivals: { surface: HTMLElement; focus: () => void }[] = [];
      root.querySelectorAll<HTMLElement>("#landing-main section:not(.landing-hero)").forEach((section) => {
        const surface = section.classList.contains("ai-section")
          ? section.querySelector<HTMLElement>(".ai-intro")
          : section.firstElementChild;
        if (!(surface instanceof HTMLElement)) return;
        surface.dataset.scrollReveal = "pending";
        const tween = gsap.fromTo(surface, { y: desktop ? 28 : 18, opacity: 0 }, {
          y: 0, opacity: 1, duration: .7, ease: "power3.out",
          onComplete: () => { surface.dataset.scrollReveal = "ready"; },
          scrollTrigger: { trigger: section, start: "top 88%", once: true },
        });
        const focus = () => { tween.progress(1); };
        surface.addEventListener("focusin", focus);
        arrivals.push({ surface, focus });
      });

      const mascot = root.querySelector(".ai-stage .ai-visual");
      if (mascot) gsap.fromTo(mascot, { y: desktop ? 64 : 24, scale: .88 }, {
        y: 0, scale: 1, ease: "none",
        scrollTrigger: { trigger: root.querySelector(".ai-stage"), start: "top 96%", end: "top 38%", scrub: .45, invalidateOnRefresh: true },
      });
      return () => arrivals.forEach(({ surface, focus }) => {
        surface.removeEventListener("focusin", focus);
        delete surface.dataset.scrollReveal;
      });
    }, root);
    // Accordions, translated copy and media may change document height.
    // Debounced: an accordion animates its height every frame, and a full
    // refresh per frame re-measures every trigger mid-interaction.
    let refreshTimer = 0;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => ScrollTrigger.refresh(), 150);
    });
    observer.observe(root);
    return () => {
      observer.disconnect();
      decisionObserver.disconnect();
      document.removeEventListener("visibilitychange", updateDecisionMotion);
      decisionSections.forEach((section) => delete section.dataset.motionVisible);
      window.clearTimeout(refreshTimer);
      mm.revert();
    };
  }, []);
  return null;
}
