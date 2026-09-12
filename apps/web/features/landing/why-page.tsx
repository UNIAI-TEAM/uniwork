"use client";
import { AlertCircle, Boxes, Brain, FileCheck2, Server } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { gsap, useGSAP } from "./animation/register-gsap";
import { revealFrom, withMotionPreference } from "./animation/reveal";
import { FinalCta } from "./final-cta";
import { Container, EmphasisSection, Eyebrow, SectionTitle } from "./layout-primitives";
import { PLATFORM_ISSUES, PLATFORM_KEYS, PLATFORMS } from "./platforms";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { TrustBand } from "./trust-band";

const PILLARS = [
  { icon: Boxes, key: "pillar1", ink: "text-brand" },
  { icon: Brain, key: "pillar2", ink: "text-brand-accent" },
  { icon: FileCheck2, key: "pillar3", ink: "text-info" },
  { icon: Server, key: "pillar4", ink: "text-warning" },
] as const;

/**
 * The page a buyer reaches when they ask why they need this on top of what
 * they already pay for.
 *
 * Every claim about another vendor is a claim this repo cannot test, which is
 * why the disclaimer is in the hero rather than the footer, and why each
 * platform block opens by saying what that platform is good at. A comparison
 * that only lists the other side's faults is read as advertising and stops
 * being evidence.
 *
 * No tick table and no logos. A self-scored grid is the one thing on a
 * comparison page a reader can dismiss in a second, and a competitor's mark
 * beside our own reads as a partnership.
 */
export function WhyPage() {
  return (
    <div className="min-h-dvh overflow-x-hidden bg-background text-foreground">
      <SiteHeader />
      <main>
        <WhyHero />
        <Platforms />
        <MarketGap />
        <Pillars />
        <TrustBand />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}

function WhyHero() {
  const { t } = useTranslation();
  const root = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);

  useGSAP(
    () =>
      withMotionPreference(root.current, (motion) => {
        const lines = body.current ? Array.from(body.current.children) : [];
        if (!motion || !root.current) {
          gsap.set(lines, { clearProps: "all" });
          return;
        }
        revealFrom(lines, root.current, 0.06);
      }),
    { scope: root },
  );

  return (
    <section ref={root} aria-labelledby="why-title" className="bg-background pt-28 pb-16 sm:pt-32 sm:pb-20">
      <Container>
        <div ref={body} className="max-w-3xl">
          <Eyebrow className="text-brand">{t("landing.why.eyebrow")}</Eyebrow>
          <SectionTitle>
            <span id="why-title">{t("landing.why.title")}</span>
          </SectionTitle>
          <p className="mt-4 max-w-prose text-title-sm leading-relaxed text-pretty text-muted-foreground">
            {t("landing.why.sub")}
          </p>
          <p className="mt-4 max-w-prose text-body-lg leading-relaxed text-muted-foreground">
            {t("landing.why.lead")}
          </p>
          {/* In the hero, not the footer: a reader who acts on a comparison
              needs to know how old it is before they act, not after. */}
          <p className="mt-8 max-w-prose border-l-2 border-border pl-4 text-caption leading-relaxed text-muted-foreground">
            {t("landing.why.disclaimer")}
          </p>
        </div>
      </Container>
    </section>
  );
}

function Platforms() {
  const { t } = useTranslation();
  const root = useRef<HTMLElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useGSAP(
    () =>
      withMotionPreference(root.current, (motion) => {
        const cells = list.current ? Array.from(list.current.children) : [];
        if (!motion || !root.current) {
          gsap.set(cells, { clearProps: "all" });
          return;
        }
        revealFrom(cells, root.current, 0.08);
      }),
    { scope: root },
  );

  return (
    <section ref={root} aria-label={t("landing.why.title")} className="bg-surface py-20 sm:py-24">
      <Container>
        <ul ref={list} className="grid gap-10 lg:grid-cols-2 lg:gap-x-14 lg:gap-y-16">
          {PLATFORM_KEYS.map((key) => {
            const { ns, ink } = PLATFORMS[key];
            return (
              <li key={key}>
                <h2 className={cn("font-heading text-title font-bold leading-snug", ink)}>{t(`${ns}.name`)}</h2>
                <p className="mt-1 text-caption font-medium tracking-wide text-muted-foreground">
                  {t(`${ns}.tagline`)}
                </p>
                <p className="mt-4 max-w-prose text-body-lg leading-relaxed text-muted-foreground">
                  {t(`${ns}.desc`)}
                </p>

                <h3 className="mt-8 text-label font-semibold">{t("landing.why.issuesLabel")}</h3>
                <ul className="mt-4 grid gap-4">
                  {PLATFORM_ISSUES.map((issue) => (
                    <li key={issue} className="flex gap-3">
                      <AlertCircle className={cn("mt-0.5 size-4 shrink-0", ink)} aria-hidden />
                      <div>
                        <p className="text-body font-semibold">{t(`${ns}.${issue}Title`)}</p>
                        <p className="mt-1 max-w-prose text-body leading-relaxed text-muted-foreground">
                          {t(`${ns}.${issue}Desc`)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>

                {/* Deliberately not a blockquote and deliberately unquoted:
                    this is our own reading, not something anyone said. */}
                <div className="mt-8 rounded-lg bg-muted p-5">
                  <p className="text-label font-semibold text-muted-foreground">{t("landing.why.summaryLabel")}</p>
                  <p className="mt-2 max-w-prose text-body-lg leading-relaxed">{t(`${ns}.summary`)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </Container>
    </section>
  );
}

function MarketGap() {
  const { t } = useTranslation();

  return (
    <EmphasisSection className="py-20 sm:py-24">
      <Container>
        <div className="max-w-3xl">
          <Eyebrow className="text-brand">{t("landing.why.gapTitle")}</Eyebrow>
          <SectionTitle>{t("landing.why.gapSub")}</SectionTitle>
          <p className="mt-4 max-w-prose text-title-sm leading-relaxed text-pretty text-muted-foreground">
            {t("landing.why.gapBody")}
          </p>
        </div>
      </Container>
    </EmphasisSection>
  );
}

function Pillars() {
  const { t } = useTranslation();
  const root = useRef<HTMLElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useGSAP(
    () =>
      withMotionPreference(root.current, (motion) => {
        const cells = list.current ? Array.from(list.current.children) : [];
        if (!motion || !root.current) {
          gsap.set(cells, { clearProps: "all" });
          return;
        }
        revealFrom(cells, root.current, 0.07);
      }),
    { scope: root },
  );

  return (
    <section ref={root} aria-labelledby="why-pillars-title" className="bg-background py-20 sm:py-24">
      <Container>
        <SectionTitle className="mt-0 max-w-3xl">
          <span id="why-pillars-title">{t("landing.why.pillarsTitle")}</span>
        </SectionTitle>
        <ul ref={list} className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-10">
          {PILLARS.map(({ icon: Icon, key, ink }) => (
            <li key={key}>
              <Icon className={cn("size-6", ink)} aria-hidden />
              <h3 className="mt-4 font-heading text-body-lg font-bold leading-snug">{t(`landing.why.${key}Title`)}</h3>
              <p className="mt-2 max-w-prose text-body leading-relaxed text-muted-foreground">
                {t(`landing.why.${key}Desc`)}
              </p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
