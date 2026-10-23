"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Logo } from "@uniwork/ui/brand";
import type { createMascotRenderer } from "./animation/mascot-renderer";

export function HorseMascot() {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<ReturnType<typeof createMascotRenderer> | null>(null);
  const [reduced, setReduced] = useState(true);
  const [failed, setFailed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const state = useRef({ paused: reduced });
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update(); media.addEventListener("change", update); return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => { state.current = { paused: reduced }; renderer.current?.setState(state.current); }, [reduced]);
  useEffect(() => {
    const element = host.current; if (!element) return;
    let cancelled = false;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return; observer.disconnect();
      void import("./animation/mascot-renderer").then(({ createMascotRenderer: create }) => {
        if (cancelled) return;
        renderer.current = create(element, setFailed);
        renderer.current.setState(state.current);
      }).catch(() => { if (!cancelled) setFailed(true); });
    }, { rootMargin: "200px" }); observer.observe(element);
    return () => { cancelled = true; observer.disconnect(); renderer.current?.dispose(); renderer.current = null; };
  }, []);
  return <div className="horse-mascot" data-scene="character" data-motion={reduced ? "paused" : "once"} data-render-error={failed}>
    <div className="mascot-stage">
      <div className="mascot-ground" aria-hidden />
      <div ref={host} className="mascot-portrait" role="img" aria-label={t("landing.motion.characterLabel")}>
        {!imageFailed && <Image src="/landing/mascot/uni-horse-v2.webp" alt="" fill unoptimized sizes="(min-width: 768px) 640px, 100vw" onError={() => setImageFailed(true)} />}
        {imageFailed && <div className="mascot-unavailable"><Logo variant="mark" size={72} decorative /><p>{t("landing.motion.mascotFallback")}</p></div>}
        {!imageFailed && <div className="mascot-brand-plane" aria-hidden><span className="mascot-shirt-logo"><Logo variant="mark" tone="mono" size={48} decorative /></span></div>}
      </div>
    </div>
    <p className="sr-only">{t("landing.motion.mascotNote")}</p>
  </div>;
}
