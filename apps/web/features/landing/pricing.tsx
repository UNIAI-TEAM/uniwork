"use client";
import { Check } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { ANCHORS, href } from "./anchors";
import { gsap, useGSAP } from "./animation/register-gsap";
import { revealFrom, withMotionPreference } from "./animation/reveal";
import { Container, SectionTitle } from "./layout-primitives";

/**
 * One plan, because one plan exists.
 *
 * `starter` is the only row in the plans table (migration 069) and its limits
 * are deliberately NULL: the tiers are an open question the product owner has
 * not closed (docs/roadmap/OPEN_QUESTIONS.md, B1). A three-column pricing
 * table with invented numbers is the single most damaging thing this page
 * could print, so the section says what is true and offers a conversation
 * instead.
 *
 * The eight quotas are not a wish list either. They are the feature keys the
 * server already meters and gates on, copied from the same migration. When the
 * tiers land, the numbers go beside these rows and nothing else here changes.
 */
const QUOTAS = ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"] as const;

export function Pricing() {
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
      id={ANCHORS.pricing}
      aria-labelledby="landing-pricing-title"
      className="scroll-mt-16 bg-surface py-24 sm:scroll-mt-18 sm:py-32"
    >
      <Container ref={body}>
        <div className="max-w-3xl">
          <SectionTitle className="mt-0">
            <span id="landing-pricing-title">{t("landing.pricing.title")}</span>
          </SectionTitle>
          <p className="mt-4 max-w-prose text-title-sm leading-relaxed text-pretty text-muted-foreground">{t("landing.pricing.sub")}</p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr] lg:gap-10">
          <div className="rounded-xl bg-brand/5 p-8">
            <h3 className="font-heading text-title font-bold">{t("landing.pricing.planName")}</h3>
            <p className="mt-4 font-heading text-hero-sm font-bold text-brand">{t("landing.pricing.planPrice")}</p>
            <p className="mt-3 text-body-lg leading-relaxed text-muted-foreground">{t("landing.pricing.planDesc")}</p>
            <Link
              href={paths.register()}
              className={cn(buttonVariants({ variant: "brand", size: "lg" }), "mt-7 h-12 w-full text-body-lg")}
            >
              {t("landing.cta.start")}
            </Link>
          </div>

          <div className="rounded-xl border border-border p-8">
            <h3 className="text-body font-semibold">{t("landing.pricing.quotasLabel")}</h3>
            <ul className="mt-6 grid gap-x-8 gap-y-3 sm:grid-cols-2">
              {QUOTAS.map((key) => (
                <li key={key} className="flex items-center gap-2.5 text-body-lg">
                  <Check className="size-4 shrink-0 text-success" />
                  {t(`landing.pricing.${key}`)}
                </li>
              ))}
            </ul>
            <p className="mt-8 max-w-prose border-t border-border pt-6 text-body-lg leading-relaxed text-muted-foreground">
              {t("landing.pricing.status")}
            </p>
            <a
              href={href(ANCHORS.contact)}
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), "mt-5 h-11")}
            >
              {t("landing.pricing.cta")}
            </a>
          </div>
        </div>
      </Container>
    </section>
  );
}
