"use client";
import { Check, MessageSquare, Pause, Play, Sparkles, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Logo } from "@uniwork/ui/brand";
import type { createScene } from "./animation/scene-renderer";

export function InteractiveScene() {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<ReturnType<typeof createScene> | null>(null);
  const [reduced, setReduced] = useState(true);
  const [manualPause, setManualPause] = useState<boolean | null>(null);
  const [selected, setSelected] = useState(0);
  const [failed, setFailed] = useState(false);
  const paused = manualPause ?? reduced;
  const state = useRef({ paused, selected, turn: 0 });
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { setReduced(media.matches); setManualPause(null); };
    update(); media.addEventListener("change", update); return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    state.current = { paused, selected, turn: 0 }; renderer.current?.setState(state.current);
  }, [paused, selected]);
  useEffect(() => {
    const element = host.current; if (!element) return;
    let cancelled = false;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return; observer.disconnect();
      void import("./animation/scene-renderer").then(({ createScene: create }) => {
        if (cancelled) return;
        const style = getComputedStyle(element);
        renderer.current = create(element, { brand: style.getPropertyValue("--brand").trim(), paper: style.getPropertyValue("--landing-model-shell").trim(), ink: style.getPropertyValue("--landing-deep").trim(), mint: style.getPropertyValue("--landing-model-light").trim() }, setSelected, setFailed);
        renderer.current.setState(state.current);
      }).catch(() => { if (!cancelled) setFailed(true); });
    }, { rootMargin: "200px" });
    observer.observe(element);
    return () => { cancelled = true; observer.disconnect(); renderer.current?.dispose(); renderer.current = null; };
  }, []);
  return <div className="interactive-scene scene-core" data-scene="core" data-motion={paused ? "paused" : "playing"} data-selection={selected}>
    <div className="hero-context hero-context-work"><Check aria-hidden /><strong>{t("landing.studio.tasksTab")}</strong></div>
    <div className="hero-context hero-context-chat"><MessageSquare aria-hidden /><strong>{t("landing.studio.chatTab")}</strong></div>
    <div className="hero-context hero-context-meet"><Video aria-hidden /><strong>{t("landing.meeting.online")}</strong></div>
    <div className="hero-context hero-context-ai"><Sparkles aria-hidden /><strong>{t("landing.studio.askTab")}</strong></div>
    <div ref={host} className="scene-canvas" aria-label={t("landing.motion.coreLabel")} role="img">
      <div className="scene-fallback"><span>{t(failed ? "landing.motion.fallback" : "landing.motion.loading")}</span></div>
      <div className="scene-brand"><Logo variant="mark" size={64} decorative /></div>
    </div>
    <Button className="scene-motion-toggle" variant="ghost" size="icon" disabled={failed} aria-label={t(paused ? "landing.motion.play" : "landing.motion.pause")} onClick={() => setManualPause(!paused)}>{paused ? <Play aria-hidden /> : <Pause aria-hidden />}</Button>
  </div>;
}
