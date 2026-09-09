"use client";
import { AiWorkforce } from "./ai-workforce";
import { ANCHORS } from "./anchors";
import { Capabilities } from "./capabilities";
import { Faq } from "./faq";
import { FinalCta } from "./final-cta";
import { Hero } from "./hero";
import { ProductBand } from "./product-band";
import { Problem } from "./problem";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { SolutionsTeaser } from "./solutions-teaser";
import { TrustBand } from "./trust-band";

const MEETING_POINTS = ["landing.meetings.point1", "landing.meetings.point2", "landing.meetings.point3"] as const;

/**
 * Section order is the argument the page makes: what it is (hero), what it can
 * be checked against (trust band), why anyone needs it (problem), what is in it
 * (capabilities), who it is for (solutions), two proofs that ship today
 * (meetings, tasks), one that is still a promise and says so (email), what is
 * actually new about it (AI teammates), the objections (FAQ), then the ask.
 * Alternating the emphasis plane keeps a long scroll from flattening.
 *
 * The trust band comes before the argument rather than after it: it is the
 * only block on the page whose every claim maps to a test in this repo, and a
 * visitor who does not believe the hero will not read to the footer to find
 * out.
 *
 * A "Work Graph / organizational memory" section used to sit before the AI
 * block. It was removed rather than reworded: no module implements it, and the
 * whole section was a claim.
 */
export function LandingPage() {
  return (
    <div className="min-h-dvh overflow-x-hidden bg-background text-foreground">
      <SiteHeader />
      <main>
        <Hero />
        <TrustBand />
        <Problem />
        <Capabilities />
        <SolutionsTeaser />
        <ProductBand
          id={ANCHORS.meetings}
          emphasis
          eyebrow="landing.meetings.eyebrow"
          title="landing.meetings.title"
          description="landing.meetings.desc"
          image="/landing/meetings.webp"
          imageAlt="landing.meetings.imageAlt"
          points={MEETING_POINTS}
        />
        <ProductBand
          id={ANCHORS.projects}
          reverse
          eyebrow="landing.projects.eyebrow"
          title="landing.projects.title"
          description="landing.projects.desc"
          image="/landing/projects-tasks.webp"
          imageAlt="landing.projects.imageAlt"
          companion="/landing/chat-tasks.webp"
          companionAlt="landing.projects.companionAlt"
          action={{ label: "landing.projects.cta", href: "/register" }}
        />
        <ProductBand
          id={ANCHORS.email}
          eyebrow="landing.email.eyebrow"
          title="landing.email.title"
          description="landing.email.desc"
          image="/landing/email-hub.webp"
          imageAlt="landing.email.imageAlt"
          soon="landing.email.soon"
        />
        <AiWorkforce />
        <Faq
          namespace="landing.faq"
          count={6}
          eyebrow="landing.faq.eyebrow"
          title="landing.faq.title"
          // The three bands and the AI section above are all on the surface
          // plane; a fourth would read as one unbroken block.
          className="border-t border-border bg-background py-20 sm:py-28"
        />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}
