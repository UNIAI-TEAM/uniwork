"use client";
import { useTranslation } from "react-i18next";
import { landingFont } from "../../platform/landing-font";
import { AiWorkforce } from "./ai-workforce";
import { BusinessOs } from "./business-os";
import { Capabilities } from "./capabilities";
import { Faq } from "./faq";
import { FinalCta } from "./final-cta";
import { Hero } from "./hero";
import { MarketGapTeaser } from "./market-gap-teaser";
import { Pricing } from "./pricing";
import { Roadmap } from "./roadmap";
import { Security } from "./security";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { SolutionsTeaser } from "./solutions-teaser";
import { TrustBand } from "./trust-band";
import { LandingMotion } from "./animation/landing-motion";
import { CinematicWorld } from "./cinematic-world";
import "./landing.css";
import "./landing-motion.css";
import "./landing-explorer.css";
import "./landing-stages.css";
import "./landing-products.css";
import "./landing-meetings.css";
import "./landing-workspace.css";
import "./landing-playback.css";
import "./landing-reference.css";
import "./landing-highlight.css";
import "./landing-focus.css";
import "./landing-dual-navigation.css";
import "./landing-action-motion.css";
import "./landing-lovable.css";
import "./landing-decisions.css";
import "./landing-ai-stage.css";
import trustStyles from "./landing-trust.module.css";
import "./hero-nexus.css";
import "./cinematic-world.css";

/**
 * THESIS: UNI inhabits one dimensional studio throughout native page scroll.
 * OWN-WORLD: Pearl atrium, thick arches, cobalt ramp, soft contact shadows;
 * product content stays on readable foreground surfaces.
 * STORY: Enter, follow UNI running and jumping, explore the product, then sign up.
 * FIRST VIEWPORT: Copy and one CTA on the left; UNI and architecture on the right.
 * FORM: Architectural studio, confirmed choice 02; record UNI-1334-studio-02.
 * Scroll samples pose and camera; the direction is recorded from the user choice.
 * MOTION: Articulated limbs, anticipation, jump, landing and a curved spatial route.
 * Pausing freezes the scene; reduced motion opens on a still, deliberate frame.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
 */
export function LandingPage() {
  const { t } = useTranslation();
  return (
    <div data-design-contract="UNI-1334-studio-02" className={`landing-site landing-cinematic ${landingFont.variable} min-h-dvh bg-background text-foreground`}>
      <LandingMotion />
      <CinematicWorld />
      <a className="landing-skip" href="#landing-main">{t("landing.studio.skip")}</a>
      <SiteHeader />
      <main id="landing-main">
        <Hero />
        <div className="landing-product-story">
          <Capabilities />
          <BusinessOs />
          <div className="studio-world-passage" aria-hidden="true" />
          <SolutionsTeaser />
          <AiWorkforce />
        </div>
        <div className={`landing-trust-story dark text-foreground ${trustStyles.chapter}`}>
          <Security />
          <TrustBand />
          <MarketGapTeaser />
        </div>
        <div className="studio-world-passage" aria-hidden="true" />
        <div className="landing-future-story">
          <Roadmap />
        </div>
        <div className="landing-conversion-story">
          <Pricing />
          <Faq namespace="landing.faq" count={10} initialCount={5} title="landing.faq.title" className="landing-faq studio-section" />
          <div className="studio-world-passage studio-world-close" aria-hidden="true" />
          <FinalCta />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
