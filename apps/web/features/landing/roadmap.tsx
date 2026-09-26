"use client";
import { CalendarDays, CircleDashed, FileStack, Hammer, Network, Server, Sparkles } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@uniwork/ui/components/ui/accordion";
import { ANCHORS } from "./anchors";
import { gsap, useGSAP } from "./animation/register-gsap";
import { revealFrom, withMotionPreference } from "./animation/reveal";
import { Container, SectionTitle } from "./layout-primitives";
import { WorkProducts } from "./work-products";
import { Logo } from "@uniwork/ui/brand";

/**
 * The roadmap, printed rather than implied.
 *
 * PRODUCT.md's fourth principle is that no surface lists a capability the
 * product cannot back today, and this section is the honest way to say more
 * without breaking it: everything here is labelled as unbuilt, in the column
 * that says how unbuilt it is. The items are copied from
 * docs/roadmap/FEATURE_ROADMAP.md, which is the single list development works
 * from, so a claim here cannot outrun the plan.
 *
 * No dates. The roadmap carries month ranges internally; PRODUCT.md rules
 * availability dates out of any public surface, and a date is the one thing on
 * a roadmap a reader will hold you to.
 *
 * When an item ships it does not move down this list. It moves out of it, into
 * the grid or a band above, and the row is deleted.
 */
const PHASES = [
  {
    key: "now",
    icon: Hammer,
    ink: "text-brand",
    items: [2, 3, 5, 6],
  },
  {
    key: "next",
    icon: CircleDashed,
    ink: "text-brand-accent",
    items: [1, 2, 3, 4, 5, 6],
  },
  {
    key: "ent",
    icon: Server,
    ink: "text-info",
    items: [1, 2, 3, 4],
  },
] as const;

export function Roadmap() {
  const { t } = useTranslation();
  const root = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);

  useGSAP(
    () =>
      withMotionPreference(root.current, (motion) => {
        const parts = body.current ? Array.from(body.current.children) : [];
        if (!motion || !root.current) {
          gsap.set(parts, { clearProps: "all" });
          return;
        }
        revealFrom(parts, root.current, 0.08);
      }),
    { scope: root },
  );

  return (
    <section
      ref={root}
      id={ANCHORS.roadmap}
      aria-labelledby="landing-roadmap-title"
      className="roadmap-section scroll-mt-16 border-t border-border bg-background py-16 sm:scroll-mt-18 sm:py-20"
    >
      <Container ref={body}>
        <div className="roadmap-hero">
          <div className="roadmap-hero-copy">
            <SectionTitle className="mt-0"><span id="landing-roadmap-title">{t("landing.roadmap.title")}</span></SectionTitle>
            <p>{t("landing.roadmap.sub")}</p>
            <span className="roadmap-hero-note"><CalendarDays aria-hidden />{t("landing.roadmap.note")}</span>
          </div>
          <div className="roadmap-visual" role="img" aria-label={`${t("landing.discovery.workProducts")}: ${t("landing.studio.workProductsShort")}`}>
            <div className="roadmap-visual-bar"><Logo variant="mark" size={25} decorative /><span>{t("landing.studio.demoWorkspace")}</span><span aria-hidden className="roadmap-visual-dots"><i /><i /><i /></span></div>
            <div className="roadmap-visual-body">
              <svg className="roadmap-graph-lines" viewBox="0 0 600 300" preserveAspectRatio="none" aria-hidden>{/* Every line runs under the centre card (painted after the SVG), so it meets the
                  card edge at any breakpoint instead of stopping short of it. */}
                <path d="M135 72 C205 72 202 150 280 150 M121 222 C205 222 219 150 280 150 M469 102 C400 102 380 150 280 150" /></svg>
              <div className="roadmap-visual-node roadmap-node-meeting"><CalendarDays aria-hidden /><span>{t("landing.reference.meeting")}</span></div>
              <div className="roadmap-visual-node roadmap-node-task"><Network aria-hidden /><span>{t("landing.reference.task")}</span></div>
              <div className="roadmap-visual-center"><span className="roadmap-visual-halo"><FileStack aria-hidden /></span><strong>{t("landing.discovery.workProducts")}</strong><small>{t("landing.studio.workProductsNote")}</small></div>
              <div className="roadmap-visual-node roadmap-node-ai"><Sparkles aria-hidden /><span>{t("landing.studio.askTab")}</span></div>
            </div>
          </div>
        </div>

        <Accordion className="roadmap-phases">
          <WorkProducts />
          {PHASES.map((phase) => (
            <AccordionItem key={phase.key} value={phase.key}>
              {/* The heading names the phase only; its summary and count stay visible
                  but reach assistive tech as the trigger's description. */}
              <AccordionTrigger aria-describedby={`roadmap-${phase.key}-desc roadmap-${phase.key}-count`}><span className="roadmap-phase-name"><phase.icon aria-hidden className={cn("size-6", phase.ink)} /><span>{t(`landing.roadmap.${phase.key}Name`)}<small id={`roadmap-${phase.key}-desc`} aria-hidden>{t(`landing.roadmap.${phase.key}Desc`)}</small></span></span><span id={`roadmap-${phase.key}-count`} aria-hidden className="roadmap-count">{t("landing.explorer.plannedCount", { count: phase.items.length })}</span></AccordionTrigger>
              <AccordionContent><ul className="roadmap-items">
                {phase.items.map((n) => (
                  <li key={n} className="flex gap-3 text-body-lg leading-relaxed">
                    <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-current opacity-40" />
                    {t(`landing.roadmap.${phase.key}${n}`)}
                  </li>
                ))}
              </ul></AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

      </Container>
    </section>
  );
}
