"use client";
import { ArrowRight, ChevronDown, Gauge } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { Logo } from "@uniwork/ui/brand";
import { ANCHORS } from "./anchors";
import { gsap, useGSAP } from "./animation/register-gsap";
import { revealFrom, withMotionPreference } from "./animation/reveal";
import { Container, SectionTitle } from "./layout-primitives";
import "./landing-pricing.css";

/**
 * One plan, because one plan exists.
 *
 * `starter` is the only row in the plans table (migration 069) and its limits
 * are deliberately NULL: the tiers are an open question the product owner has
 * not closed (docs/roadmap/OPEN_QUESTIONS.md, B1). A three-column pricing
 * table with invented numbers is the single most damaging thing this page
 * could print, so the section says what is true and links to setup guidance.
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
      className="pricing-section scroll-mt-16 sm:scroll-mt-18"
    >
      <Container ref={body}>
        <div className="pricing-intro">
          <SectionTitle className="mt-0">
            <span id="landing-pricing-title">{t("landing.pricing.title")}</span>
          </SectionTitle>
          <p>{t("landing.pricing.sub")}</p>
        </div>

        <div className="pricing-offer">
          <div className="starter-summary">
            <div className="starter-identity">
              <Logo variant="mark" size={40} decorative />
              <div><h3>{t("landing.pricing.planName")}</h3><p>{t("landing.pricing.planDesc")}</p></div>
            </div>
            <p className="starter-price">{t("landing.pricing.planPrice")}</p>
            <Link
              href={paths.register()}
              className={cn(buttonVariants({ variant: "brand", size: "lg" }), "starter-action")}
            >
              {t("landing.cta.start")}<ArrowRight aria-hidden />
            </Link>
          </div>
          <p className="pricing-status">{t("landing.pricing.status")}</p>
          <details className="pricing-details">
            <summary><Gauge aria-hidden /><span>{t("landing.pricing.quotasLabel")}</span><ChevronDown aria-hidden /></summary>
            <div className="pricing-quotas">
              <ul>{QUOTAS.map((key) => <li key={key}>{t(`landing.pricing.${key}`)}</li>)}</ul>
              <p className="pricing-meter-note">{t("landing.revision.pricingNote")}</p>
              <div className="pricing-next"><h4>{t("landing.revision.pricingNext")}</h4><p>{t("landing.revision.pricingSetup")}</p><Link className="revision-text-link" href={`${paths.learn()}#setup`}>{t("landing.revision.readiness.cta")}<ArrowRight aria-hidden /></Link></div>
            </div>
          </details>
        </div>
      </Container>
    </section>
  );
}
