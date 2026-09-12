"use client";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { ANCHORS } from "./anchors";
import { gsap, useGSAP } from "./animation/register-gsap";
import { revealFrom, withMotionPreference } from "./animation/reveal";
import { Container, SectionTitle } from "./layout-primitives";
import { SOLUTIONS, SOLUTION_KEYS } from "./solutions";

/**
 * The home page's only door to the department pages. It exists so the header's
 * "Giải pháp" entry can point at something on this page rather than at one of
 * the two departments, which would be a choice the visitor has not made yet.
 */
export function SolutionsTeaser() {
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
      id={ANCHORS.solutions}
      aria-labelledby="landing-solutions-title"
      className="scroll-mt-16 bg-surface py-20 sm:scroll-mt-18 sm:py-28"
    >
      <Container ref={body}>
        <div className="max-w-3xl">
          <SectionTitle className="mt-0">
            <span id="landing-solutions-title">{t("landing.solutions.teaserTitle")}</span>
          </SectionTitle>
          <p className="mt-4 max-w-prose text-title-sm text-pretty text-muted-foreground">{t("landing.solutions.teaserSub")}</p>
        </div>

        <ul className="mt-12 grid gap-6 lg:grid-cols-2">
          {SOLUTION_KEYS.map((key) => (
            <li key={key}>
              <Link
                href={SOLUTIONS[key].href}
                className="group flex h-full flex-col rounded-lg border border-border bg-background p-6 transition-colors hover:border-brand sm:p-8"
              >
                <h3 className="font-heading text-title font-bold">{t(`${SOLUTIONS[key].ns}.name`)}</h3>
                <p className="mt-3 max-w-prose flex-1 text-body-lg leading-relaxed text-muted-foreground">
                  {t(`${SOLUTIONS[key].ns}.sub`)}
                </p>
                <span className="mt-6 inline-flex items-center gap-1.5 text-body font-medium text-brand">
                  {t("landing.solutions.cardCta")}
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-1 motion-reduce:transition-none" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
