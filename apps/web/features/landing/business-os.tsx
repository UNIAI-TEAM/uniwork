"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ArrowRight, Pause, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Logo } from "@uniwork/ui/brand";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@uniwork/ui/components/ui/accordion";
import { Button } from "@uniwork/ui/components/ui/button";
import { ANCHORS } from "./anchors";
import { BUSINESS_OS_LAYERS } from "./business-os-data";
import { BusinessOsPreview } from "./business-os-preview";
import "./business-os.css";

const SHOWCASES = ["projects", "word", "gateway", "chat"] as const;
const CAPABILITIES = BUSINESS_OS_LAYERS.flatMap(layer => layer.groups.flatMap(group =>
  group.items.map(item => ({ ...item, layer: layer.key, status: item.status ?? layer.status }))));
const PERIMETER = Array.from({ length: 50 }, (_, index) => ({ column: index % 10 + 1, row: Math.floor(index / 10) + 1 }))
  .filter(({ column, row }) => row === 1 || column < 4 || column > 7);

export function BusinessOs() {
  const { t } = useTranslation();
  const [activeLayer, setActiveLayer] = useState<string | null>(null);
  const [activePreview, setActivePreview] = useState<string | null>(null);
  const [motionPaused, setMotionPaused] = useState(false);
  const gallery = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const previews = Array.from(gallery.current?.querySelectorAll<HTMLElement>(".business-os-showcase") ?? []);
    const visible = new Set<Element>();
    const update = () => previews.forEach(preview => {
      preview.dataset.motionVisible = String(!document.hidden && visible.has(preview));
    });
    // Each tile stops independently: on phones most of the gallery is offscreen.
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      });
      update();
    }, { threshold: .1 });
    previews.forEach(preview => observer.observe(preview));
    document.addEventListener("visibilitychange", update);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", update); };
  }, []);
  const surrounding = CAPABILITIES.filter(item => !SHOWCASES.some(key => key === item.key));
  return (
    <section id={ANCHORS.businessOs} className="business-os-section" aria-labelledby="business-os-title">
      <header className="business-os-intro">
        <h2 id="business-os-title">{t("landing.businessOs.title")}</h2>
        <p>{t("landing.businessOs.subtitle")}</p>
      </header>
      <div className="business-os-layers" role="group" aria-label={t("landing.businessOs.highlightLayer")}>
        {BUSINESS_OS_LAYERS.map(layer => (
          <button type="button" key={layer.key} className="business-os-layer" data-layer={layer.key}
            aria-pressed={activeLayer === layer.key} onClick={() => setActiveLayer(activeLayer === layer.key ? null : layer.key)}>
              <span className="business-os-layer-number" aria-hidden>{String(layer.number).padStart(2, "0")}</span>
              <span className="sr-only">{t("landing.businessOs.layer", { number: layer.number })}</span>
              <span className="business-os-layer-copy"><span>{t(`landing.businessOs.layers.${layer.key}.title`)}</span>
                <small>{t(`landing.businessOs.layers.${layer.key}.stage`)}</small></span>
              <layer.icon aria-hidden />
          </button>
        ))}
      </div>
      <ul ref={gallery} className="business-os-grid" data-motion={motionPaused ? "paused" : "playing"}>
        {SHOWCASES.map(key => {
          const item = CAPABILITIES.find(capability => capability.key === key)!;
          const title = t(key === "gateway" ? "landing.businessOs.preview.askUni" : `landing.businessOs.capabilities.${key}`);
          return <li key={key} className="business-os-showcase" data-capability={key} data-showcase={key} data-layer={item.layer}
            data-highlighted={activeLayer === item.layer}>
            <button type="button" className="business-os-showcase-button" aria-label={t("landing.businessOs.previewAction", { name: title })}
              aria-pressed={activePreview === key} onClick={() => setActivePreview(activePreview === key ? null : key)}>
              <BusinessOsPreview kind={key} />
              <span className="business-os-showcase-label"><item.icon aria-hidden /><span>{title}</span><Play className="business-os-play" aria-hidden /></span>
              <span className="sr-only">{t(`landing.businessOs.capabilities.${key}`)}. {t(`landing.businessOs.status.${item.status}`)}</span>
            </button>
          </li>;
        })}
        {surrounding.map((item, index) => <li key={item.key} className="business-os-cell" data-capability={item.key} data-layer={item.layer}
          data-highlighted={activeLayer === item.layer}
          style={{ "--tile-column": PERIMETER[index]!.column, "--tile-row": PERIMETER[index]!.row } as CSSProperties}>
          <item.icon aria-hidden />
          <span>{t(item.key === "memory" ? "landing.businessOs.memoryShort" : `landing.businessOs.capabilities.${item.key}`)}</span>
          <span className="sr-only">{t(`landing.businessOs.status.${item.status}`)}</span>
        </li>)}
        <li className="business-os-brand-cell" aria-hidden><Logo variant="mark" size={34} decorative /></li>
      </ul>
      <footer className="business-os-footer">
        <Accordion className="business-os-availability">
          <AccordionItem value="availability">
            <AccordionTrigger>{t("landing.businessOs.availability")}</AccordionTrigger>
            <AccordionContent className="business-os-availability-content">
              {BUSINESS_OS_LAYERS.map(layer => (
                <section key={layer.key}>
                  <h4>{t(`landing.businessOs.layers.${layer.key}.title`)}</h4>
                  <p>{t(`landing.businessOs.layers.${layer.key}.note`)}</p>
                  <dl>
                    {layer.groups.flatMap(group => group.items).map(item => (
                      <div key={item.key}>
                        <dt>{t(`landing.businessOs.capabilities.${item.key}`)}</dt>
                        <dd>{t(`landing.businessOs.status.${item.status ?? layer.status}`)}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
        <div className="business-os-actions">
          <Button className="business-os-motion-toggle" variant="ghost" size="icon"
            aria-label={t(motionPaused ? "landing.motion.play" : "landing.motion.pause")}
            title={t(motionPaused ? "landing.motion.play" : "landing.motion.pause")}
            onClick={() => setMotionPaused(paused => !paused)}>
            {motionPaused ? <Play aria-hidden /> : <Pause aria-hidden />}
          </Button>
          <a className="business-os-explore" href={`#${ANCHORS.platform}`}>{t("landing.businessOs.explore")}<ArrowRight aria-hidden /></a>
        </div>
      </footer>
    </section>
  );
}
