"use client";
import { MousePointer2, Pause, Play } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Logo } from "@uniwork/ui/brand";
import { Button } from "@uniwork/ui/components/ui/button";
import { type ProductFeature } from "./showcase";
import { usePreviewPlayback } from "./animation/use-preview-playback";
import { useDemoItemMotion } from "./animation/use-demo-item-motion";
import { LovablePoster } from "./lovable-frame";
import { ProductTaskScene } from "./product-task-scene";
import { ProductEmailPreview } from "./product-email-preview";
import { ProductMeetingPreview } from "./product-meeting-preview";

const ProductChatPreview = lazy(() => import("./product-chat-preview").then(module => ({ default: module.ProductChatPreview })));
const ProductAskPreview = lazy(() => import("./product-ask-preview").then(module => ({ default: module.ProductAskPreview })));
const PLAYBACK_FEATURES = ["tasks", "meetings", "chat", "email", "ask"] as const;
type PlaybackFeature = typeof PLAYBACK_FEATURES[number];
export function hasPlayback(feature: ProductFeature): feature is PlaybackFeature {
  return PLAYBACK_FEATURES.some(key => key === feature);
}
const TARGETS: Record<PlaybackFeature, readonly (string | null)[]> = {
  tasks: ["task-row", "assignee", "member", "task-close", "task-status", "task-done", null],
  meetings: ["share-start", "share-source", "share-confirm", null],
  chat: ["message-menu", "create-from-message", "create-confirm", null, null],
  email: ["mail-row", "mail-star", null, null],
  ask: ["ask-send", null, "ask-source", null],
};
/** Illustrative controls are not interactive. Real controls live outside the film. */
export function ProductPlayback({ featureKey }: { featureKey: PlaybackFeature; onExplore?: () => void }) {
  const { t, i18n } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [surface, setSurface] = useState<HTMLDivElement | null>(null);
  const attachStage = useCallback((node: HTMLDivElement | null) => { stage.current = node; setSurface(node); }, []);
  const cursor = useRef<HTMLDivElement>(null);
  const beatCount = TARGETS[featureKey].length;
  const [sceneVisible, setSceneVisible] = useState(true);
  const { step, playing, running, reduced, pressing, toggle } = usePreviewPlayback(host, beatCount, sceneVisible);
  useDemoItemMotion(stage, step, running && !reduced);
  useEffect(() => {
    const pointer = cursor.current;
    if (!surface || !pointer) return;
    const measure = () => {
      const name = TARGETS[featureKey][step];
      const target = name ? surface.querySelector<HTMLElement>(`[data-demo-target="${name}"]`) ?? (featureKey === "email" ? surface.querySelector<HTMLElement>(name === "mail-row" ? "[data-thread-row]" : "[role=toolbar] button[aria-pressed]") : null) : null;
      pointer.hidden = !target;
      surface.querySelectorAll<HTMLElement>("[data-demo-pointed]").forEach(item => item.removeAttribute("data-demo-pointed"));
      if (!target) return;
      target.dataset.demoPointed = "true";
      const rect = target.getBoundingClientRect();
      const bounds = surface.getBoundingClientRect();
      const scaleX = bounds.width / surface.offsetWidth;
      const scaleY = bounds.height / surface.offsetHeight;
      const x = (rect.left - bounds.left + rect.width * .68) / scaleX;
      const y = (rect.top - bounds.top + rect.height * .65) / scaleY;
      pointer.style.transform = `translate(${x}px, ${y}px)`;
      const label = pointer.querySelector<HTMLElement>(".action-cursor-label");
      if (label) {
        label.style.left = `${Math.max(8 - x, Math.min(12, surface.offsetWidth - x - label.offsetWidth - 8))}px`;
        label.style.top = `${y + label.offsetHeight + 33 > surface.offsetHeight ? -label.offsetHeight - 12 : 25}px`;
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(surface);
    const timer = window.setTimeout(measure, 300);
    surface.addEventListener("scroll", measure, true);
    return () => { observer.disconnect(); clearTimeout(timer); surface.removeEventListener("scroll", measure, true); };
  }, [featureKey, step, i18n.language, surface]);
  const playbackControl = <Button variant="ghost" size="icon" data-action="toggle-playback" onClick={toggle} aria-label={t(playing ? "landing.playback.pause" : "landing.playback.play")}>{playing ? <Pause aria-hidden /> : <Play aria-hidden />}</Button>;
  const cursorContent = <div ref={cursor} className="action-cursor" aria-hidden><i className="action-click-ring" /><MousePointer2 /><div className="action-cursor-label"><Logo variant="mark" size={22} decorative /><span><strong>Đạt Đặng</strong><small>{t(`landing.actionDemo.pointer.${TARGETS[featureKey][step] ?? "task-row"}`)}</small></span></div></div>;
  if (featureKey === "tasks") return <div ref={host} className="product-playback product-current-task-player" data-feature-preview={featureKey} data-step={step} data-beat-count={beatCount} data-running={running} data-reduced={reduced} data-pressing={pressing}>
    <div className="product-demo-playback-control">{playbackControl}</div>
    <div ref={attachStage} className="action-stage demo-stage product-task-stage" data-scene-kind="tasks" role="img" aria-label={t(`landing.actionDemo.steps.tasks${step}`)}><div inert aria-hidden="true"><ProductTaskScene step={step} /></div>{cursorContent}</div>
  </div>;
  if (featureKey === "meetings") return <div ref={host} className="product-playback product-current-meeting-player" data-feature-preview={featureKey} data-step={step} data-beat-count={beatCount} data-running={running} data-reduced={reduced} data-pressing={pressing}>
    <ProductMeetingPreview step={step} control={playbackControl} cursor={cursorContent} stageRef={attachStage} label={t(`landing.actionDemo.steps.meetings${step}`)} onSceneVisibilityChange={setSceneVisible} />
  </div>;
  if (featureKey === "email") return <div ref={host} className="product-playback product-current-email-player" data-feature-preview={featureKey} data-step={step} data-beat-count={beatCount} data-running={running} data-reduced={reduced} data-pressing={pressing}>
    <ProductEmailPreview step={step} control={playbackControl} cursor={cursorContent} stageRef={attachStage} label={t(`landing.actionDemo.steps.email${step}`)} />
  </div>;
  const Scene = featureKey === "chat" ? ProductChatPreview : ProductAskPreview;
  return <div ref={host} className={`product-playback product-current-${featureKey}-player`} data-feature-preview={featureKey} data-step={step} data-beat-count={beatCount} data-running={running} data-reduced={reduced} data-pressing={pressing}>
    <Suspense fallback={null}><Scene step={step} control={playbackControl} cursor={cursorContent} stageRef={attachStage} label={t(`landing.actionDemo.steps.${featureKey}${step}`)} /></Suspense>
  </div>;
}

export function TaskPoster() {
  const { t } = useTranslation();
  return <LovablePoster feature="tasks" label={`${t("landing.lovable.allTasks")} — ${t("landing.lovable.sample")}`} completed><ProductTaskScene step={6} /></LovablePoster>;
}
