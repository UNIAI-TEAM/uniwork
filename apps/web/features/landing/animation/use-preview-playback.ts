"use client";
import { useEffect, useRef, useState, type RefObject } from "react";

/** A bounded local storyboard. No background timers or workspace mutations. */
export function usePreviewPlayback(host: RefObject<HTMLElement | null>, beatCount = 4, enabled = true) {
  const [step, setStep] = useState(0);
  const [reduced, setReduced] = useState(true);
  const [requested, setRequested] = useState<boolean | null>(null);
  const [visible, setVisible] = useState(false);
  const [foreground, setForeground] = useState(true);
  const [pressing, setPressing] = useState(false);
  const remaining = useRef(2600);
  const playing = requested ?? !reduced;
  const running = enabled && playing && visible && foreground;
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { setReduced(media.matches); setRequested(null); };
    update(); media.addEventListener("change", update);
    const visibility = () => setForeground(!document.hidden);
    visibility(); document.addEventListener("visibilitychange", visibility);
    const observer = new IntersectionObserver(([entry]) => setVisible(!!entry?.isIntersecting), { threshold: .15 });
    if (host.current) observer.observe(host.current);
    return () => { media.removeEventListener("change", update); document.removeEventListener("visibilitychange", visibility); observer.disconnect(); };
  }, [host]);
  useEffect(() => {
    if (!running) return;
    const started = performance.now();
    let fired = false;
    // A click leads the resulting state by 240ms; both clocks retain their
    // remaining time when the visitor pauses or leaves the visible preview.
    const press = window.setTimeout(() => setPressing(true), Math.max(0, remaining.current - 240));
    const timer = window.setTimeout(() => {
      fired = true; remaining.current = 2600; setPressing(false); setStep(value => (value + 1) % beatCount);
    }, remaining.current);
    return () => { clearTimeout(press); clearTimeout(timer); if (!fired) { remaining.current = Math.max(0, remaining.current - (performance.now() - started)); setPressing(false); } };
  }, [running, step, beatCount]);
  return { step, running, playing, reduced, pressing, toggle: () => setRequested(!playing) };
}
