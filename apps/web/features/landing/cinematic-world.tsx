"use client";
import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Logo } from "@uniwork/ui/brand";
import { Button } from "@uniwork/ui/components/ui/button";
import type { createStudioWorld } from "./animation/studio-world";

export function CinematicWorld() {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null), mark = useRef<HTMLSpanElement>(null);
  const renderer = useRef<ReturnType<typeof createStudioWorld> | null>(null);
  const [reduced, setReduced] = useState(true);
  const [manualPause, setManualPause] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const paused = manualPause ?? reduced;
  const state = useRef({ progress: 0, paused, milestones: [] as number[] });
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { setReduced(media.matches); setManualPause(null); };
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    state.current.paused = paused; renderer.current?.setState(state.current);
  }, [paused]);
  useEffect(() => {
    const element = host.current, source = mark.current?.querySelector("svg");
    if (!element || !source) return;
    let cancelled = false, scrollFrame = 0;
    const svg = source.cloneNode(true) as SVGElement;
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.setAttribute("width", "128"); svg.setAttribute("height", "92");
    const init = async () => {
      const { createStudioWorld: create } = await import("./animation/studio-world");
      if (cancelled) return;
      const style = getComputedStyle(element);
      const colour = (name: string) => toSrgb(style.getPropertyValue(name).trim());
      svg.setAttribute("color", colour("--landing-model-shell"));
      renderer.current?.dispose();
      try {
        renderer.current = create(element, {
          floor: colour("--landing-stage"), paper: colour("--landing-model-shell"),
          coat: colour("--landing-model-shell"), ink: colour("--landing-deep"),
          blue: colour("--brand"), cyan: colour("--landing-close-light"), coral: colour("--brand-accent"),
        }, new XMLSerializer().serializeToString(svg), setFailed);
        renderer.current.setState(state.current); setFailed(false);
      } catch { setFailed(true); }
    };
    const scroll = () => {
      if (scrollFrame) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        const distance = document.documentElement.scrollHeight - innerHeight;
        state.current.progress = distance > 0 ? scrollY / distance : 0;
        state.current.milestones = [...document.querySelectorAll(".studio-world-passage")].map(passage => {
          const bounds = passage.getBoundingClientRect();
          return Math.max(0, Math.min(1, (bounds.top + scrollY + bounds.height / 2 - innerHeight / 2) / Math.max(1, distance)));
        });
        renderer.current?.setState(state.current);
      });
    };
    const theme = new MutationObserver(() => { void init().catch(() => setFailed(true)); });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("scroll", scroll, { passive: true });
    const layout = new ResizeObserver(scroll); layout.observe(document.body);
    scroll(); void init().catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true; cancelAnimationFrame(scrollFrame); theme.disconnect(); layout.disconnect();
      window.removeEventListener("scroll", scroll); renderer.current?.dispose(); renderer.current = null;
    };
  }, []);
  return <>
    <div ref={host} className="studio-world" aria-hidden="true" data-motion={paused ? "paused" : "scroll"} data-failed={failed}>
      {/* The generated frame is also the no-WebGL fallback; it carries no baked UI. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="studio-world-fallback" src="/landing/mascot/uni-studio-fallback.webp" alt="" width={1672} height={941} fetchPriority="high" />
      <span ref={mark} className="studio-world-mark"><Logo variant="mark" tone="mono" decorative /></span>
    </div>
    <Button className="studio-world-toggle" variant="outline" size="icon" disabled={failed}
      aria-label={t(paused ? "landing.motion.play" : "landing.motion.pause")}
      aria-pressed={paused} onClick={() => setManualPause(!paused)}>
      {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
    </Button>
  </>;
}
/** Resolve theme CSS colors, including oklch(), to Three's supported sRGB input. */
function toSrgb(value: string) {
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!context || !value) return value;
  context.fillStyle = value; context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return "rgb(" + [r, g, b].join(", ") + ")";
}