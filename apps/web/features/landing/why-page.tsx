"use client";
import { AlertCircle, Boxes, Brain, FileCheck2, Info, Server } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { gsap, useGSAP } from "./animation/register-gsap";
import { revealFrom, withMotionPreference } from "./animation/reveal";
import { Container, EmphasisSection, Eyebrow, SectionTitle } from "./layout-primitives";
import { MarketingShell } from "./marketing-shell";
import { PLATFORM_ISSUES, PLATFORM_KEYS, PLATFORMS } from "./platforms";
import { TrustBand } from "./trust-band";

// One brand ink: these are topics, not states, so no signal colour applies.
const PILLARS = [
  { icon: Boxes, key: "pillar1" },
  { icon: Brain, key: "pillar2" },
  { icon: FileCheck2, key: "pillar3" },
  { icon: Server, key: "pillar4" },
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
    <MarketingShell>
      <WhyHero />
      <Platforms />
      <MarketGap />
      <Pillars />
      <TrustBand />
    </MarketingShell>
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
    <section ref={root} aria-labelledby="why-title" className="bg-background pb-16 sm:pb-20">
      <Container>
        <div ref={body} className="max-w-3xl">
          <Eyebrow className="text-brand">{t("landing.why.eyebrow")}</Eyebrow>
          <h1 id="why-title" className="mt-3">{t("landing.why.title")}</h1>
          <p className="mt-4 max-w-prose text-title-sm leading-relaxed text-pretty text-muted-foreground">
            {t("landing.why.sub")}
          </p>
          <p className="mt-4 max-w-prose text-body-lg leading-relaxed text-muted-foreground">
            {t("landing.why.lead")}
          </p>
          {/* In the hero, not the footer: a reader who acts on a comparison
              needs to know how old it is before they act, not after. */}
          <p className="mt-8 flex max-w-prose gap-2 text-body leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
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
    <section ref={root} aria-label={t("landing.why.issuesLabel")} className="bg-surface py-20 sm:py-24">
      <Container>
        <ul ref={list} className="grid gap-10 lg:grid-cols-2 lg:gap-x-14 lg:gap-y-16">
          {PLATFORM_KEYS.map((key) => {
            const { ns } = PLATFORMS[key];
            return (
              <li key={key}>
                <h2 className="font-heading text-title font-bold leading-snug">{t(`${ns}.name`)}</h2>
                <p className="mt-1 text-body font-medium text-muted-foreground">
                  {t(`${ns}.tagline`)}
                </p>
                <p className="mt-4 max-w-prose text-body-lg leading-relaxed text-muted-foreground">
                  {t(`${ns}.desc`)}
                </p>

                <h3 className="mt-8 text-body font-semibold">{t("landing.why.issuesLabel")}</h3>
                <ul className="mt-4 grid gap-4">
                  {PLATFORM_ISSUES.map((issue) => (
                    <li key={issue} className="flex gap-3">
                      <AlertCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <div>
                        <p className="text-body-lg font-semibold">{t(`${ns}.${issue}Title`)}</p>
                        <p className="mt-1 max-w-prose text-body-lg leading-relaxed text-muted-foreground">
                          {t(`${ns}.${issue}Desc`)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>

                {/* Deliberately not a blockquote and deliberately unquoted:
                    this is our own reading, not something anyone said. */}
                <div className="mt-8 rounded-lg bg-muted p-5">
                  <p className="text-body font-semibold text-muted-foreground">{t("landing.why.summaryLabel")}</p>
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
          {PILLARS.map(({ icon: Icon, key }) => (
            <li key={key}>
              <Icon className="size-6 text-brand" aria-hidden />
              <h3 className="mt-4 font-heading text-title-sm font-bold leading-snug">{t(`landing.why.${key}Title`)}</h3>
              <p className="mt-2 max-w-prose text-body-lg leading-relaxed text-muted-foreground">
                {t(`landing.why.${key}Desc`)}
              </p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
