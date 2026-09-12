"use client";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { gsap, useGSAP } from "./animation/register-gsap";
import { revealFrom, withMotionPreference } from "./animation/reveal";
import { Container, SectionTitle } from "./layout-primitives";
import { PLATFORM_KEYS, PLATFORMS } from "./platforms";

/**
 * The sentence that follows Problem: yes, you already bought tools, and the
 * work is still in four places.
 *
 * Shape matters more than usual here. Problem above is a three-column grid of
 * text; four columns of text underneath it would be the same figure twice in a
 * row, which is exactly what the note at the top of landing-page.tsx rules out.
 * So this is one wide statement with the four names set as a plain typographic
 * row — no cards, no icons, no borders — and the argument itself lives on
 * /why-uniwork rather than here.
 */
export function MarketGapTeaser() {
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
    <section ref={root} aria-labelledby="landing-market-gap-title" className="bg-surface py-16 sm:py-20">
      <Container>
        <div ref={body} className="max-w-3xl">
          <SectionTitle className="mt-0">
            <span id="landing-market-gap-title">{t("landing.marketGap.title")}</span>
          </SectionTitle>
          <p className="mt-4 max-w-prose text-title-sm leading-relaxed text-pretty text-muted-foreground">
            {t("landing.marketGap.sub")}
          </p>
          <ul className="mt-8 flex flex-wrap gap-x-8 gap-y-3">
            {PLATFORM_KEYS.map((key) => (
              <li key={key} className="font-heading text-body-lg font-bold text-muted-foreground">
                {t(`${PLATFORMS[key].ns}.name`)}
              </li>
            ))}
          </ul>
          <p className="mt-8 max-w-prose text-body-lg leading-relaxed text-muted-foreground">
            {t("landing.marketGap.body")}
          </p>
          <Link
            href={paths.whyUniwork()}
            className="mt-6 inline-flex items-center gap-1.5 text-body-lg font-medium text-brand transition-colors hover:text-brand-accent pointer-coarse:min-h-11"
          >
            {t("landing.marketGap.cta")}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </Container>
    </section>
  );
}
