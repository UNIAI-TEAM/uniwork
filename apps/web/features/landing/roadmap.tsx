"use client";
import { CircleDashed, Hammer, Server } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { ANCHORS } from "./anchors";
import { gsap, useGSAP } from "./animation/register-gsap";
import { revealFrom, withMotionPreference } from "./animation/reveal";
import { Container, SectionTitle } from "./layout-primitives";

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
    tint: "bg-brand/5",
    count: 6,
  },
  {
    key: "next",
    icon: CircleDashed,
    ink: "text-brand-accent",
    tint: "bg-brand-accent/5",
    count: 6,
  },
  {
    key: "ent",
    icon: Server,
    ink: "text-info",
    tint: "bg-muted",
    count: 4,
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
      className="scroll-mt-16 border-t border-border bg-background py-24 sm:scroll-mt-18 sm:py-32"
    >
      <Container ref={body}>
        <div className="max-w-3xl">
          <SectionTitle className="mt-0">
            <span id="landing-roadmap-title">{t("landing.roadmap.title")}</span>
          </SectionTitle>
          <p className="mt-4 max-w-prose text-title-sm leading-relaxed text-pretty text-muted-foreground">{t("landing.roadmap.sub")}</p>
        </div>

        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {PHASES.map((phase) => (
            <section key={phase.key} className={cn("rounded-xl p-6 sm:p-8", phase.tint)}>
              <phase.icon className={cn("size-6", phase.ink)} />
              <h3 className="mt-5 font-heading text-title font-bold">{t(`landing.roadmap.${phase.key}Name`)}</h3>
              <p className="mt-1.5 max-w-prose text-body-lg text-muted-foreground">{t(`landing.roadmap.${phase.key}Desc`)}</p>
              <ul className="mt-6 grid gap-3">
                {Array.from({ length: phase.count }, (_, i) => i + 1).map((n) => (
                  <li key={n} className="flex gap-3 text-body-lg leading-relaxed">
                    <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-current opacity-40" />
                    {t(`landing.roadmap.${phase.key}${n}`)}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <p className="mt-8 max-w-prose text-body-lg text-muted-foreground">{t("landing.roadmap.note")}</p>
      </Container>
    </section>
  );
}
