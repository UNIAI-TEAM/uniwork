"use client";
import { ArrowRight, Play } from "lucide-react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { Faq } from "./faq";
import { ChapterHeading, ChapterHero, ChapterLink, ChapterScene } from "./marketing-chapters";
import { MarketingShell } from "./marketing-shell";
import { SOLUTIONS, type SolutionKey } from "./solutions";

const EXAMPLES = {
  product: [{ feature: "meetings", index: 0 }, { feature: "tasks", index: 2 }, { feature: "ask", index: 0 }],
  operations: [{ feature: "organization", index: 2 }, { feature: "audit", index: 3 }, { feature: "ask", index: 3 }],
} as const;

/** Department chapters demonstrate their routine without claiming autonomous execution. */
export function SolutionPage({ solution }: { solution: SolutionKey }) {
  const { t } = useTranslation();
  const { ns } = SOLUTIONS[solution];
  return <MarketingShell closingTitle={`${ns}.finalTitle`} closingDemoHref={`${paths.feature(solution === "product" ? "tasks" : "organization")}#feature-preview`}><div className="chapter-world" data-solution={solution}>
    <ChapterHero titleKey={`${ns}.title`} descriptionKey={`${ns}.sub`} visual={<ChapterScene featureKey={solution === "product" ? "projects" : "organization"} index={solution === "product" ? 1 : 2} />}>
      <div className="marketing-actions"><Link href={paths.register()} className={buttonVariants({ variant: "brand", size: "lg" })}>{t("landing.cta.start")}<ArrowRight aria-hidden /></Link><a href="#solution-scenarios" className="chapter-link"><Play aria-hidden />{t("landing.chapters.solutions.examples")}</a></div><ChapterLink href={paths.solutions.root()} labelKey="landing.productPages.allSolutions" />
    </ChapterHero>
    <section id="solution-scenarios" className="chapter-width chapter-section"><ChapterHeading titleKey="landing.solutions.scenarios" descriptionKey={`landing.chapters.solutions.${solution}.scenarioDescription`} />
      {EXAMPLES[solution].map(({ feature, index }, n) => <article className="chapter-row" key={feature}><div className="chapter-row-copy"><h2>{t(`${ns}.s${n + 1}Title`)}</h2><p>{t(`${ns}.s${n + 1}Desc`)}</p><ChapterLink href={paths.feature(feature)} labelKey="landing.productPages.solutionExplore" /></div><ChapterScene featureKey={feature} index={index} /></article>)}
    </section>
    <section className="chapter-soft chapter-section"><div className="chapter-width"><ChapterHeading titleKey="landing.solutions.why" descriptionKey="landing.chapters.solutions.reasonsDescription" /><div className="chapter-evidence">{[1, 2, 3].map(n => <article key={n}><h3>{t(`landing.chapters.solutions.${solution}.reasonLabels.${n - 1}`)}</h3><p>{t(`${ns}.w${n}`)}</p></article>)}</div></div></section>
    <div className="marketing-questions"><Faq namespace={ns} count={3} title="landing.solutions.faqTitle" /></div>
  </div></MarketingShell>;
}
