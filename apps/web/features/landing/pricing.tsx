"use client";
import { Check, Gauge } from "lucide-react";
import { MarketingLink as Link } from "../../platform/marketing-link";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { ANCHORS } from "./anchors";
import { gsap, useGSAP } from "./animation/register-gsap";
import { revealFrom, withMotionPreference } from "./animation/reveal";
import { Container, SectionTitle } from "./layout-primitives";

/** Neutral keys — plan codes live in the billing catalog, not in marketing copy. */
const PLAN_KEYS = ["p1", "p2", "p3"] as const;

/**
 * Public tier copy is hand-maintained from migration `9991790921000000_billing_tiers_b1`.
 * When the catalog changes, update `landing.pricing` in i18n and this comment together.
 */
const QUOTAS = ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"] as const;

export function Pricing({ showIntroduction = true }: { showIntroduction?: boolean }) {
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
      aria-labelledby={showIntroduction ? "landing-pricing-title" : undefined}
      aria-label={showIntroduction ? undefined : t("landing.pricing.title")}
      className="pricing-section scroll-mt-16 bg-surface py-24 sm:scroll-mt-18 sm:py-32"
    >
      <Container ref={body}>
        {showIntroduction && (
          <div className="pricing-introduction max-w-3xl">
            <SectionTitle className="mt-0">
              <span id="landing-pricing-title">{t("landing.pricing.title")}</span>
            </SectionTitle>
            <p className="mt-4 max-w-prose text-title-sm leading-relaxed text-pretty text-muted-foreground">
              {t("landing.pricing.sub")}
            </p>
          </div>
        )}

        <div className={cn("pricing-offer mt-12 grid gap-6 lg:grid-cols-3", !showIntroduction && "mt-0")}>
          {PLAN_KEYS.map((key) => (
            <div key={key} className="pricing-plan flex flex-col rounded-xl border border-border bg-card p-8">
              <h3 className="font-heading text-title font-bold">{t(`landing.pricing.${key}.name`)}</h3>
              <p className="mt-4 font-heading text-hero-sm font-bold text-brand">{t(`landing.pricing.${key}.price`)}</p>
              <p className="mt-3 flex-1 text-body-lg leading-relaxed text-muted-foreground">
                {t(`landing.pricing.${key}.desc`)}
              </p>
              <Link
                href={paths.register()}
                className={cn(buttonVariants({ variant: key === "p1" ? "brand" : "outline", size: "lg" }), "mt-7 h-12 w-full text-body-lg")}
              >
                {t("landing.cta.start")}
              </Link>
            </div>
          ))}
        </div>

        <div className="pricing-quotas mt-10 rounded-xl border border-border p-8">
          <h3 className="pricing-quota-heading flex items-center gap-2 text-body font-semibold">
            <Gauge aria-hidden className="size-5" />
            {t("landing.pricing.quotasLabel")}
          </h3>
          <ul className="mt-6 grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {QUOTAS.map((key) => (
              <li key={key} className="flex items-center gap-2.5 text-body-lg">
                <span className="pricing-check text-brand" aria-hidden>
                  <Check className="size-4" />
                </span>
                {t(`landing.pricing.${key}`)}
              </li>
            ))}
          </ul>
          <p className="mt-8 max-w-prose border-t border-border pt-6 text-body-lg leading-relaxed text-muted-foreground">
            {t("landing.pricing.status")}
          </p>
        </div>
      </Container>
    </section>
  );
}
