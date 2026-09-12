"use client";
import { FileCheck2, FileStack, Network, Sparkles } from "lucide-react";
import Image from "next/image";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { ANCHORS } from "./anchors";
import { gsap, useGSAP } from "./animation/register-gsap";
import { revealFrom, withMotionPreference } from "./animation/reveal";
import { useArtwork } from "./artwork";
import { Container, Eyebrow, SectionTitle } from "./layout-primitives";

const VALUES = [
  { icon: Network, key: "v1", ink: "text-brand" },
  { icon: Sparkles, key: "v2", ink: "text-brand-accent" },
  { icon: FileCheck2, key: "v3", ink: "text-info" },
  { icon: FileStack, key: "v4", ink: "text-warning" },
] as const;

const PHASES = ["p1", "p2", "p3", "p4"] as const;

/**
 * What UniWork produces, as opposed to what it keeps track of.
 *
 * This section deliberately does NOT use ProductBand, for three reasons. The
 * artwork is a dense three-column screen that is unreadable at half a column's
 * width; a fourth band in a row of bands is the same figure a fourth time
 * whichever way it is flipped; and this is the only section on the page
 * carrying a phased timeline, which the band has no slot for.
 *
 * It is also the one section on this page that describes software that is not
 * running yet. That is a deliberate exception to the rule the rest of the page
 * keeps, approved 2026-09-09 — see the note at the top of landing-page.tsx.
 * The copy earns it by naming the phases and by saying, in timelineNote, that
 * the schedule is a plan rather than a promise. If that note ever comes off,
 * this section has to come off with it.
 */
export function WorkProducts() {
  const { t } = useTranslation();
  const artwork = useArtwork();
  const root = useRef<HTMLElement>(null);
  const intro = useRef<HTMLDivElement>(null);
  const values = useRef<HTMLUListElement>(null);
  const rest = useRef<HTMLDivElement>(null);

  useGSAP(
    () =>
      withMotionPreference(root.current, (motion) => {
        const lines = intro.current ? Array.from(intro.current.children) : [];
        const cells = values.current ? Array.from(values.current.children) : [];
        const tail = rest.current ? Array.from(rest.current.children) : [];
        if (!motion || !root.current) {
          gsap.set([...lines, ...cells, ...tail], { clearProps: "all" });
          return;
        }
        revealFrom([...lines, ...cells, ...tail], root.current, 0.05);
      }),
    { scope: root },
  );

  return (
    <section
      ref={root}
      id={ANCHORS.workProducts}
      aria-labelledby="landing-work-products-title"
      className="scroll-mt-16 bg-background py-20 sm:scroll-mt-18 sm:py-28"
    >
      <Container>
        <div ref={intro} className="max-w-3xl">
          <Eyebrow className="text-brand">{t("landing.workProducts.eyebrow")}</Eyebrow>
          <SectionTitle>
            <span id="landing-work-products-title">{t("landing.workProducts.title")}</span>
          </SectionTitle>
          <p className="mt-4 max-w-prose text-title-sm leading-relaxed text-pretty text-muted-foreground">
            {t("landing.workProducts.sub")}
          </p>
        </div>

        <ul ref={values} className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-10">
          {VALUES.map(({ icon: Icon, key, ink }) => (
            <li key={key}>
              <Icon className={cn("size-6", ink)} aria-hidden />
              <h3 className="mt-4 font-heading text-body-lg font-bold leading-snug">
                {t(`landing.workProducts.${key}Title`)}
              </h3>
              <p className="mt-2 max-w-prose text-body leading-relaxed text-muted-foreground">
                {t(`landing.workProducts.${key}Desc`)}
              </p>
            </li>
          ))}
        </ul>

        <div ref={rest}>
          {/* Full container width, and it scrolls sideways below that width
              rather than shrinking. The screen is three columns of small type:
              fitted to a phone it stops being readable and becomes decoration,
              which is the one thing this section must not be. The scroller is
              the pattern wide content uses everywhere else on the site — the
              page body itself never scrolls horizontally. */}
          <div className="mt-16 overflow-x-auto rounded-xl border border-border">
            <Image
              src={artwork("work-products")}
              alt={t("landing.workProducts.imageAlt")}
              width={1536}
              height={1024}
              sizes="(min-width: 1280px) 1216px, 1024px"
              className="w-[1024px] max-w-none lg:w-full"
            />
          </div>

          <div className="mt-16 rounded-xl bg-muted p-8 sm:p-10">
            <h3 className="font-heading text-title font-bold leading-snug">
              {t("landing.workProducts.notOfficeTitle")}
            </h3>
            <p className="mt-3 max-w-prose text-body-lg leading-relaxed text-muted-foreground">
              {t("landing.workProducts.notOfficeDesc")}
            </p>
            <p className="mt-6 text-label font-semibold text-muted-foreground">
              {t("landing.workProducts.summaryLabel")}
            </p>
            <p className="mt-2 max-w-prose text-body-lg leading-relaxed">{t("landing.workProducts.summary")}</p>
          </div>

          <h3 className="mt-16 font-heading text-title font-bold leading-snug">
            {t("landing.workProducts.timelineTitle")}
          </h3>
          <p className="mt-2 text-body text-muted-foreground">{t("landing.workProducts.timelineNote")}</p>
          <ol className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-10">
            {PHASES.map((phase) => (
              <li key={phase} className="border-t border-border pt-4">
                <p className="text-label font-semibold text-brand">{t(`landing.workProducts.${phase}When`)}</p>
                <h4 className="mt-2 font-heading text-body-lg font-bold leading-snug">
                  {t(`landing.workProducts.${phase}Name`)}
                </h4>
                <p className="mt-2 max-w-prose text-body leading-relaxed text-muted-foreground">
                  {t(`landing.workProducts.${phase}Desc`)}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </Container>
    </section>
  );
}
