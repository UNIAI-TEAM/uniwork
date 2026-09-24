"use client";
import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { useArtwork } from "./artwork";

export function WorkflowFilm() {
  const { t } = useTranslation();
  const artwork = useArtwork();
  const video = useRef<HTMLVideoElement>(null);
  const pendingSeek = useRef<number | null>(null);
  const [manual, setManual] = useState<boolean | null>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(false);
  const [step, setStep] = useState(0);
  useEffect(() => {
    const element = video.current; if (!element) return;
    let visible = false;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      if (visible && !document.hidden && (manual ?? !media.matches)) {
        void element.play().catch(() => setPlaying(false));
      } else element.pause();
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? false; sync(); }, { threshold: .2 });
    observer.observe(element); media.addEventListener("change", sync); document.addEventListener("visibilitychange", sync);
    return () => { observer.disconnect(); media.removeEventListener("change", sync); document.removeEventListener("visibilitychange", sync); element.pause(); };
  }, [manual]);
  const toggle = () => {
    const element = video.current; if (!element) return;
    if (playing) { element.pause(); setManual(false); }
    else { if (error) { element.load(); setError(false); } setManual(true); void element.play().catch(() => setError(true)); }
  };
  return <figure className="workflow-film">
    <div className="film-screen">
      <video ref={video} src="/landing/motion/workflow-film.mp4" poster={error ? artwork("studio/team-session") : "/landing/motion/workflow-film.webp"} muted loop playsInline preload="none" aria-label={t("landing.motion.filmLabel")}
        onLoadedMetadata={(event) => { if (pendingSeek.current !== null) { event.currentTarget.currentTime = event.currentTarget.duration * pendingSeek.current / 3; pendingSeek.current = null; } }}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => setError(true)}
        onTimeUpdate={(event) => { const duration = event.currentTarget.duration; if (Number.isFinite(duration)) setStep(Math.min(2, Math.floor(event.currentTarget.currentTime / duration * 3))); }} />
      <div className="film-overlay"><span>{t(`landing.motion.filmStep${step}`)}</span><Button variant="outline" size="icon" onClick={toggle} aria-label={t(playing ? "landing.motion.filmPause" : "landing.motion.filmPlay")}>{playing ? <Pause aria-hidden /> : <Play aria-hidden />}</Button></div>
    </div>
    <div className="film-timeline" aria-label={t("landing.motion.filmLabel")}>{[0, 1, 2].map(index => <button type="button" key={index} aria-pressed={step === index} onClick={() => { const element = video.current; setStep(index); if (element && Number.isFinite(element.duration)) element.currentTime = element.duration * index / 3; else if (element) { pendingSeek.current = index; element.load(); } }}><span /><span>{t(`landing.motion.filmStep${index}`)}</span></button>)}</div>
    <figcaption>{t(error ? "landing.motion.filmError" : "landing.motion.filmNote")}</figcaption>
  </figure>;
}
