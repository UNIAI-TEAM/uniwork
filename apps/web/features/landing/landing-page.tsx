"use client";
import { MarketingAnchor } from "../../platform/marketing-link";
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
import "./product-demo.css";
import "./product-task-board.css";
import "./product-meeting.css";
import "./product-email.css";
import "./product-current-screens.css";
import "./landing-decisions.css";
import "./landing-ai-stage.css";
import trustStyles from "./landing-trust.module.css";
import "./hero-nexus.css";

/**
 * THESIS: One shared product stage uses the current app shell and task cards.
 * The product menu opens automatic demos directly; retained concept scenes remain
 * available alongside the sandbox's task, chat, mail and document actions.
 * OWN-WORLD: Bright studio, cobalt ink, Be Vietnam Pro; large framed scenes
 * with clear gutters, spacious type and dark trust/closing passages.
 * STORY: Watch a short action sequence or explore the shared workspace, meet UNI,
 * then inspect governance and planned work before creating an account.
 * REFERENCE: Current product screenshots and the shipped task card/status
 * components. The five action storyboards use local sample data.
 * FIRST VIEWPORT: A floating navigation dock above a centered, two-line
 * headline and one CTA. Real product screens connect four concise context labels.
 * Feature disclosure opens a compact directory; mobile keeps a native link menu.
 * FORM: The supplied hero comp guides the opening; the ClickUp/Motion canon
 * guides the product story. User chose an AI horse illustration
 * with 2.5D motion over a 360-degree mesh, based on their supplied reference.
 * MOTION: Five source-backed local storyboards demonstrate explicit actions;
 * assignment never completes work, and planned entries never autoplay.
 * Frames expand on entry; copy arrives once and stays readable. UNI wears the
 * shared mark and waves only its foreleg over the approved original image. Playback pauses
 * offscreen and in hidden documents; reduced motion is still until explicit play.
 */
export function LandingPage() {
  const { t } = useTranslation();
  return (
    <div data-design-contract="277f981e" className={`landing-site ${landingFont.variable} min-h-dvh bg-background text-foreground`}>
      <LandingMotion />
      <MarketingAnchor className="landing-skip" href="#landing-main">{t("landing.studio.skip")}</MarketingAnchor>
      <SiteHeader />
      <main id="landing-main">
        <Hero />
        <div className="landing-product-story">
          <Capabilities />
          <BusinessOs />
          <SolutionsTeaser />
          <AiWorkforce />
        </div>
        <div className={`landing-trust-story dark text-foreground ${trustStyles.chapter}`}>
          <Security />
          <TrustBand />
          <MarketGapTeaser />
        </div>
        <div className="landing-future-story">
          <Roadmap />
        </div>
        <div className="landing-conversion-story">
          <Pricing />
          <Faq namespace="landing.faq" count={10} initialCount={5} title="landing.faq.title" className="landing-faq studio-section" />
          <FinalCta />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
