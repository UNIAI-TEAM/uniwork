"use client";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { gsap, ScrollTrigger, useGSAP } from "./animation/register-gsap";
import { DURATION, EASE, RISE, START, withMotionPreference } from "./animation/reveal";
import { Container, EmphasisSection, SectionTitle } from "./layout-primitives";

/**
 * The band a buyer reads last and decides on. Every item names a mechanism a
 * reviewer can follow: the REVOKE plus trigger on the audit table (ADR 0012),
 * the correlation id that reaches the audit row and the access log, the
 * proposal path the agent runtime cannot go around (ADR 0010), the single
 * membership gate, the eight metered entitlements (F-02), and the deployment's
 * residency. If one of these stops being true, delete the item; do not soften
 * the wording.
 *
 * On the emphasis plane because it is the page's second argument, not a
 * continuation of the first: the sections above say what UniWork does, this
 * one says what it will not let anyone do. It is set as type for the same
 * reason — see the note on the list below.
 */
const ITEMS = [
  { title: "landing.security.i1Title", desc: "landing.security.i1Desc" },
  { title: "landing.security.i2Title", desc: "landing.security.i2Desc" },
  { title: "landing.security.i3Title", desc: "landing.security.i3Desc" },
  { title: "landing.security.i4Title", desc: "landing.security.i4Desc" },
  { title: "landing.security.i5Title", desc: "landing.security.i5Desc" },
  { title: "landing.security.i6Title", desc: "landing.security.i6Desc" },
] as const;

export function Security() {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLUListElement>(null);

  useGSAP(
    () =>
      withMotionPreference(root.current, (motion) => {
        const cells = grid.current ? Array.from(grid.current.children) : [];
        if (!motion) {
          gsap.set(cells, { clearProps: "all" });
          return;
        }
        gsap.set(cells, { opacity: 0, y: RISE });
        ScrollTrigger.batch(cells, {
          start: START,
          once: true,
          onEnter: (batch) =>
            gsap.to(batch, {
              opacity: 1,
              y: 0,
              duration: DURATION,
              ease: EASE,
              stagger: { each: 0.05, grid: "auto", from: "start" },
              overwrite: true,
            }),
        });
      }),
    { scope: root },
  );

  return (
    <EmphasisSection>
      <Container ref={root} className="py-24 sm:py-32">
        <div className="max-w-3xl">
          <SectionTitle className="mt-0">{t("landing.security.title")}</SectionTitle>
          <p className="mt-4 max-w-prose text-title-sm leading-relaxed text-pretty text-muted-foreground">{t("landing.security.sub")}</p>
        </div>

        {/* Set as type, with nothing but a rule above each item.
            Three other blocks on this page are an icon over a bold line over a
            grey paragraph, and by the sixth the reader stops reading the cell
            and starts recognising the shape. This is also the block where a
            picture helps least: the claims are mechanisms, and a padlock glyph
            beside "the database revokes UPDATE" adds decoration to a sentence
            that is already the evidence.

            The 01–06 numerals went with the icons. Nothing here is ordered, so
            they numbered a list that has no sequence.

            No border between cells either: --border sits at 1.04 against this
            ground. The rule is --foreground at low alpha, which reads on both. */}
        <ul ref={grid} className="mt-14 grid gap-x-12 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {ITEMS.map((item) => (
            <li key={item.title} className="border-t border-foreground/15 pt-5">
              <h3 className="font-heading text-title-lg font-bold leading-snug">{t(item.title)}</h3>
              <p className="mt-2.5 max-w-prose text-body-lg leading-relaxed text-muted-foreground">
                {t(item.desc)}
              </p>
            </li>
          ))}
        </ul>
      </Container>
    </EmphasisSection>
  );
}
