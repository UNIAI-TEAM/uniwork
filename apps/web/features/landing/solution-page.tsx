"use client";
import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { gsap, useGSAP } from "./animation/register-gsap";
import { revealFrom, withMotionPreference } from "./animation/reveal";
import { Faq } from "./faq";
import { FinalCta } from "./final-cta";
import { Container, EmphasisSection, Eyebrow, SectionTitle } from "./layout-primitives";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { SOLUTIONS, type SolutionKey } from "./solutions";
import { TrustBand } from "./trust-band";

const SCENARIOS = ["s1", "s2", "s3"] as const;
const REASONS = ["w1", "w2", "w3"] as const;
/** Every department carries the same three questions; see the i18n file. */
const FAQ_COUNT = 3;

/**
 * Both department pages are this component with a different namespace, so the
 * section order, the spacing and the alternating polarity cannot drift apart
 * as copy is added to one of them.
 */
export function SolutionPage({ solution }: { solution: SolutionKey }) {
  const { ns } = SOLUTIONS[solution];

  return (
    <div className="min-h-dvh overflow-x-hidden bg-background text-foreground">
      <SiteHeader />
      <main>
        <SolutionHero ns={ns} />
        <TrustBand />
        <Scenarios ns={ns} />
        <Reasons ns={ns} />
        <Faq namespace={ns} count={FAQ_COUNT} title="landing.solutions.faqTitle" />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}

function SolutionHero({ ns }: { ns: string }) {
  const { t } = useTranslation();
  const root = useRef<HTMLElement>(null);
  const copy = useRef<HTMLDivElement>(null);

  useGSAP(
    () =>
      withMotionPreference(root.current, (motion) => {
        const lines = copy.current ? Array.from(copy.current.children) : [];
        if (!motion) {
          gsap.set(lines, { clearProps: "all" });
          return;
        }
        gsap.from(lines, { opacity: 0, y: 14, duration: 0.5, ease: "power2.out", stagger: 0.07 });
      }),
    { scope: root },
  );

  return (
    <section ref={root} aria-labelledby="solution-title" className="pt-16 sm:pt-18">
      <Container className="py-16 sm:py-24">
        <div ref={copy} className="max-w-3xl">
          <Eyebrow className="text-brand">{t(`${ns}.name`)}</Eyebrow>
          <h1 className="mt-3 font-heading text-display font-bold leading-[1.08] sm:text-hero-sm lg:text-hero">
            <span id="solution-title">{t(`${ns}.title`)}</span>
          </h1>
          <p className="mt-5 text-title-sm leading-relaxed text-muted-foreground">{t(`${ns}.sub`)}</p>
          <div className="mt-8 grid grid-cols-1 gap-3 min-[390px]:grid-cols-2 sm:flex sm:flex-wrap">
            <Link
              href={paths.register()}
              className={cn(buttonVariants({ size: "lg" }), "h-12 w-full px-5 text-body-lg sm:w-auto sm:px-6")}
            >
              {t("landing.cta.start")}
              <ArrowRight />
            </Link>
            <Link
              href={paths.root()}
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "h-12 w-full px-5 text-body-lg sm:w-auto sm:px-6",
              )}
            >
              {t("landing.solutions.back")}
            </Link>
          </div>
        </div>
      </Container>
    </section>
  );
}

function Scenarios({ ns }: { ns: string }) {
  const { t } = useTranslation();
  const root = useRef<HTMLElement>(null);
  const list = useRef<HTMLOListElement>(null);

  useGSAP(
    () =>
      withMotionPreference(root.current, (motion) => {
        const cells = list.current ? Array.from(list.current.children) : [];
        if (!motion || !root.current) {
          gsap.set(cells, { clearProps: "all" });
          return;
        }
        revealFrom(cells, root.current, 0.06);
      }),
    { scope: root },
  );

  return (
    <section ref={root} aria-labelledby="solution-scenarios-title" className="bg-background py-20 sm:py-28">
      <Container>
        <SectionTitle className="mt-0 max-w-3xl">
          <span id="solution-scenarios-title">{t("landing.solutions.scenarios")}</span>
        </SectionTitle>
        <ol ref={list} className="mt-12 grid gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-3">
          {SCENARIOS.map((step, i) => (
            <li key={step} className="bg-surface p-6 sm:p-8">
              <span className="text-label font-semibold tabular-nums text-brand">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-6 font-heading text-title font-bold leading-snug">{t(`${ns}.${step}Title`)}</h3>
              <p className="mt-3 text-body leading-relaxed text-muted-foreground">{t(`${ns}.${step}Desc`)}</p>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}

function Reasons({ ns }: { ns: string }) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useGSAP(
    () =>
      withMotionPreference(root.current, (motion) => {
        const cells = list.current ? Array.from(list.current.children) : [];
        if (!motion || !root.current) {
          gsap.set(cells, { clearProps: "all" });
          return;
        }
        revealFrom(cells, root.current, 0.06);
      }),
    { scope: root },
  );

  return (
    <EmphasisSection>
      <Container ref={root} className="grid gap-12 py-20 sm:py-28 lg:grid-cols-2 lg:gap-20">
        <SectionTitle className="mt-0">{t("landing.solutions.why")}</SectionTitle>
        <ul ref={list} className="grid gap-5">
          {REASONS.map((reason) => (
            <li key={reason} className="flex items-start gap-3 text-title-sm leading-relaxed">
              <span className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand">
                <Check className="size-3.5" />
              </span>
              {t(`${ns}.${reason}`)}
            </li>
          ))}
        </ul>
      </Container>
    </EmphasisSection>
  );
}
