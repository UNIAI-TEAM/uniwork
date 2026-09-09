"use client";
import { CornerDownRight } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { gsap, useGSAP } from "./animation/register-gsap";
import { revealFrom, withMotionPreference } from "./animation/reveal";
import { Container, Eyebrow, SectionTitle } from "./layout-primitives";

/**
 * Named pains, not statistics. The page has no research of its own to cite and
 * a borrowed number would be the one unverifiable thing on it, so each item
 * states the problem and then the single sentence of product that answers it.
 * If a claim here ever stops matching a shipped module, delete the item rather
 * than soften the wording.
 */
const PAINS = [
  { title: "landing.problem.pain1Title", desc: "landing.problem.pain1Desc", answer: "landing.problem.pain1Answer" },
  { title: "landing.problem.pain2Title", desc: "landing.problem.pain2Desc", answer: "landing.problem.pain2Answer" },
  { title: "landing.problem.pain3Title", desc: "landing.problem.pain3Desc", answer: "landing.problem.pain3Answer" },
] as const;

export function Problem() {
  const { t } = useTranslation();
  const root = useRef<HTMLElement>(null);
  const intro = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useGSAP(
    () =>
      withMotionPreference(root.current, (motion) => {
        const lines = intro.current ? Array.from(intro.current.children) : [];
        const cells = list.current ? Array.from(list.current.children) : [];
        if (!motion || !root.current) {
          gsap.set([...lines, ...cells], { clearProps: "all" });
          return;
        }
        revealFrom([...lines, ...cells], root.current, 0.06);
      }),
    { scope: root },
  );

  return (
    <section ref={root} aria-labelledby="landing-problem-title" className="bg-background py-20 sm:py-28">
      <Container>
        <div ref={intro} className="max-w-3xl">
          <Eyebrow className="text-brand-accent">{t("landing.problem.eyebrow")}</Eyebrow>
          <SectionTitle>
            <span id="landing-problem-title">{t("landing.problem.title")}</span>
          </SectionTitle>
          <p className="mt-4 text-title-sm leading-relaxed text-muted-foreground">{t("landing.problem.sub")}</p>
        </div>

        <ul ref={list} className="mt-12 grid gap-8 lg:grid-cols-3 lg:gap-10">
          {PAINS.map((pain) => (
            <li key={pain.title}>
              <h3 className="font-heading text-title font-bold leading-snug">{t(pain.title)}</h3>
              <p className="mt-3 text-body leading-relaxed text-muted-foreground">{t(pain.desc)}</p>
              {/* The answer sits inside the same cell as the pain on purpose:
                  a separate "solution" column would let the two drift apart as
                  the product changes. */}
              <p className="mt-4 flex gap-2 border-t border-border pt-4 text-body font-medium">
                <CornerDownRight className="mt-0.5 size-4 shrink-0 text-brand" />
                {t(pain.answer)}
              </p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
