"use client";
import { AiWorkforce } from "./ai-workforce";
import { ANCHORS } from "./anchors";
import { Capabilities } from "./capabilities";
import { Faq } from "./faq";
import { FinalCta } from "./final-cta";
import { Hero } from "./hero";
import { MarketGapTeaser } from "./market-gap-teaser";
import { Pricing } from "./pricing";
import { ProductBand } from "./product-band";
import { Problem } from "./problem";
import { Roadmap } from "./roadmap";
import { Security } from "./security";
import { Showcase } from "./showcase";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { SolutionsTeaser } from "./solutions-teaser";
import { TrustBand } from "./trust-band";
import { WorkProducts } from "./work-products";

const MEETING_POINTS = ["landing.meetings.point1", "landing.meetings.point2", "landing.meetings.point3"] as const;

/**
 * Section order is the argument the page makes: what it is (hero), what it can
 * be checked against (trust band), why anyone needs it (problem), why the
 * tools they already bought did not fix it (market gap), what is in it
 * (capabilities), who it is for (solutions), two proofs that ship today
 * (meetings, tasks), one that is still a promise and says so (email), what the
 * whole thing produces (Work Products), what is actually new about it (AI
 * teammates), the objections (FAQ), then the ask.
 *
 * The trust band comes before the argument rather than after it: it is the
 * only block on the page whose every claim maps to a test in this repo, and a
 * visitor who does not believe the hero will not read to the footer to find
 * out.
 *
 * A "Work Graph / organizational memory" section used to sit before the AI
 * block. It was removed rather than reworded: no module implements it, and the
 * whole section was a claim.
 *
 * Work Products is the one exception to the rule that paragraph describes,
 * approved by quangpd on 2026-09-09 (spec
 * docs/superpowers/specs/2026-09-09-landing-work-products-positioning-design.md
 * §9.1). No module implements it yet; it is on the page because it is the
 * clearest answer to what UniWork produces rather than tracks. It carries its
 * own honesty instead: the section prints its phases and says, in
 * timelineNote, that the schedule is a plan and not a release commitment.
 * Delete the section rather than the note.
 *
 * A gallery sat between security and the roadmap, holding the slot a launched
 * product would fill with customer quotes. It went the same way, and for a
 * plainer reason: all five pictures in it were already on the page, in the
 * bands above, under the same alt text. A screen reader heard every caption
 * twice and a scrolling visitor got a rerun. When there are real screens to
 * show, or customers with something to say, that section comes back with
 * something in it.
 *
 * Composition is what keeps sixteen sections from reading as one. No two
 * neighbours share a layout: the three product bands go split, wide, split,
 * because three copy-beside-image sections in a row is the same shape three
 * times; the trust band and the capability grid are deliberately different
 * grids rather than two three-across rows; the security block and the roadmap
 * are both three across but share no cell shape — the security items are set
 * as type with no icon, the roadmap as tinted cards with a list inside; and
 * the three blocks that flip polarity, the meetings band, security and the
 * closing ask, are spaced so the flip reads as punctuation rather than as
 * alternation.
 *
 * The back half of the page answers a different question from the front. Above
 * the AI section a visitor is deciding whether they want this; below it, from
 * the showcase down through security, the roadmap and the plan, they are
 * deciding whether they can commit to it. That is why the roadmap is on the
 * page at all, and why it is printed as a roadmap rather than folded into the
 * capability grid: PRODUCT.md forbids listing what the product cannot back
 * today, and a labelled column of unbuilt work is the honest way to answer the
 * question a buyer will ask anyway.
 *
 * Only three sections open with a small wide-tracked label, and the hero's
 * pill is one of them. That was nine. Every section having one is what makes a
 * long page read as a template rather than as an argument, and a headline that
 * needs a label above it to be understood is the wrong headline.
 */
export function LandingPage() {
  return (
    <div className="min-h-dvh overflow-x-hidden bg-background text-foreground">
      <SiteHeader />
      <main>
        <Hero />
        <TrustBand />
        <Problem />
        <MarketGapTeaser />
        <Capabilities />
        <SolutionsTeaser />
        <ProductBand
          id={ANCHORS.meetings}
          emphasis
          title="landing.meetings.title"
          description="landing.meetings.desc"
          image="meetings"
          imageAlt="landing.meetings.imageAlt"
          points={MEETING_POINTS}
        />
        <ProductBand
          id={ANCHORS.projects}
          wide
          title="landing.projects.title"
          description="landing.projects.desc"
          image="projects-tasks"
          imageAlt="landing.projects.imageAlt"
          companion="chat-tasks"
          companionAlt="landing.projects.companionAlt"
          action={{ label: "landing.projects.cta", href: "/register" }}
        />
        <ProductBand
          id={ANCHORS.email}
          reverse
          title="landing.email.title"
          description="landing.email.desc"
          image="email-hub"
          imageAlt="landing.email.imageAlt"
          soon="landing.email.soon"
        />
        <WorkProducts />
        <AiWorkforce />
        <Showcase />
        <Security />
        <Roadmap />
        <Pricing />
        <Faq
          namespace="landing.faq"
          count={10}
          title="landing.faq.title"
          // Pricing above sits on the surface plane, so the questions take the
          // page ground; the closing band flips polarity right after.
          className="border-t border-border bg-background py-24 sm:py-32"
        />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}
