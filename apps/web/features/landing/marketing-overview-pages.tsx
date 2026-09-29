"use client";
import { ArrowDown, ArrowRight, CircleCheck, MessageSquare, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { MarketingShell } from "./marketing-shell";
import { ChapterHeading, ChapterHero, ChapterLink, ChapterScene } from "./marketing-chapters";
import { FeatureIllustration } from "./feature-illustration";
import { Pricing } from "./pricing";
import { Faq } from "./faq";
import { PRODUCT_FEATURES } from "./showcase";
import { SOLUTIONS, SOLUTION_KEYS } from "./solutions";

const LEARNING_PHASES = [{ feature: "organization", index: 2 }, { feature: "tasks", index: 2 }, { feature: "ask", index: 0 }] as const;
const LEARNING_ROUTES = ["tasks", "chat", "meetings", "ask"] as const;
const GOVERNANCE = [{ feature: "organization", index: 2 }, { feature: "audit", index: 3 }, { feature: "ask", index: 3 }] as const;

/** Each existing chapter organizes the product truth around its own decision. */
export function SolutionsPage() {
  const { t } = useTranslation();
  return <MarketingShell closingTitle="landing.chapters.solutions.closing"><div className="chapter-world">
    <ChapterHero titleKey="landing.productPages.solutionsTitle" descriptionKey="landing.productPages.solutionsDescription" visual={<ChapterScene featureKey="projects" index={1} />}>
      <div className="marketing-actions"><a href="#team-comparison" className={buttonVariants({ variant: "brand", size: "lg" })}>{t("landing.chapters.solutions.choose")}<ArrowDown aria-hidden /></a><Link href={paths.features()} className="chapter-link">{t("landing.productPages.allFeatures")}<ArrowRight aria-hidden /></Link></div>
    </ChapterHero>
    <section id="team-comparison" className="chapter-section chapter-soft"><div className="chapter-width"><ChapterHeading titleKey="landing.chapters.solutions.compareTitle" descriptionKey="landing.chapters.solutions.compareDescription" />
      <table className="chapter-table"><caption className="sr-only">{t("landing.chapters.solutions.compareTitle")}</caption><thead><tr><th scope="col">{t("landing.chapters.table.subject")}</th>{SOLUTION_KEYS.map(key => <th scope="col" key={key}><Link href={SOLUTIONS[key].href}>{t(`${SOLUTIONS[key].ns}.name`)}<ArrowRight aria-hidden /></Link></th>)}</tr></thead>
        <tbody>{["focus", "routine", "context"].map(criterion => <tr key={criterion}><th scope="row">{t(`landing.chapters.solutions.criteria.${criterion}`)}</th>{SOLUTION_KEYS.map(key => <td key={key}>{t(`landing.chapters.solutions.${key}.${criterion}`)}</td>)}</tr>)}</tbody>
      </table>
    </div></section>
    <div className="chapter-width chapter-section">{SOLUTION_KEYS.map((key, index) => <section key={key} className="chapter-row">
      <div className="chapter-row-copy">{index === 0 ? <MessageSquare aria-hidden /> : <ShieldCheck aria-hidden />}<h2>{t(`${SOLUTIONS[key].ns}.name`)}</h2><p>{t(`${SOLUTIONS[key].ns}.sub`)}</p><ChapterLink href={SOLUTIONS[key].href} labelKey="landing.productPages.solutionExplore" /></div><ChapterScene featureKey={index === 0 ? "meetings" : "audit"} index={index === 0 ? 0 : 3} />
    </section>)}</div>
  </div></MarketingShell>;
}

export function LearnPage() {
  const { t } = useTranslation();
  return <MarketingShell closingTitle="landing.chapters.learn.closing" closingDemoHref={`${paths.feature("tasks")}#feature-preview`}><div className="chapter-world">
    <ChapterHero titleKey="landing.productPages.learnTitle" descriptionKey="landing.productPages.learnDescription" visual={<ChapterScene featureKey="tasks" index={2} />}>
      <div className="marketing-actions"><a href="#learn-workspace" className={buttonVariants({ variant: "brand", size: "lg" })}>{t("landing.chapters.learn.start")}<ArrowDown aria-hidden /></a><Link href={paths.register()} className="chapter-link">{t("landing.cta.start")}<ArrowRight aria-hidden /></Link></div>
    </ChapterHero>
    <nav className="chapter-jumps chapter-width" aria-labelledby="learn-navigation-title"><span className="chapter-jumps-title" id="learn-navigation-title">{t("landing.chapters.learn.navigation")}</span><div className="chapter-jump-links">{["workspace", "task", "sources"].map((key, index) => <a href={`#learn-${key}`} key={key}><strong>{t(`landing.chapters.learn.phases.${index}`)}</strong><ArrowDown aria-hidden /></a>)}</div></nav>
    <ol className="chapter-learning-path chapter-width chapter-section">{LEARNING_PHASES.map(({ feature, index }, n) => <li className="chapter-row" id={`learn-${["workspace", "task", "sources"][n]}`} key={feature}>
      <div className="chapter-row-copy"><span className="chapter-step-number" aria-hidden>{n + 1}</span><h2>{t(`landing.productPages.learnSteps.${n}.title`)}</h2><p>{t(`landing.productPages.learnSteps.${n}.description`)}</p><ul>{[0, 1].map(point => <li key={point}>{t(`landing.chapters.learn.points.${n}.${point}`)}</li>)}</ul><ChapterLink href={paths.feature(feature)} labelKey="landing.productPages.learnCta" /></div><ChapterScene featureKey={feature} index={index} />
    </li>)}</ol>
    <section className="chapter-section chapter-soft"><div className="chapter-width"><ChapterHeading titleKey="landing.chapters.learn.libraryTitle" descriptionKey="landing.chapters.learn.libraryDescription" />
      <div className="chapter-routes">{LEARNING_ROUTES.map(key => { const feature = PRODUCT_FEATURES.find(item => item.key === key)!; return <Link className="chapter-route" href={paths.feature(key)} data-feature-group={feature.group} key={key}>
        <div className="chapter-route-media"><FeatureIllustration featureKey={key} index={key === "tasks" ? 2 : 0} decorative /></div><div className="chapter-route-copy"><feature.icon aria-hidden /><span><strong>{t(feature.label)}</strong><small>{t(`landing.chapters.learn.guides.${key}`)}</small></span><ArrowRight aria-hidden /></div>
      </Link>; })}</div>
    </div></section>
    <div id="questions" className="marketing-questions"><Faq namespace="landing.faq" count={10} initialCount={5} title="landing.productPages.faqTitle" /></div>
  </div></MarketingShell>;
}

export function PricingPage() {
  const { t } = useTranslation();
  return <MarketingShell closingTitle="landing.chapters.pricing.closing" closingDemoHref={`${paths.feature("tasks")}#feature-preview`}><div className="chapter-world">
    <ChapterHero titleKey="landing.productPages.pricingTitle" descriptionKey="landing.productPages.pricingDescription" visual={<ChapterScene featureKey="tasks" index={1} />}>
      <div className="marketing-actions"><Link href={paths.register()} className={buttonVariants({ variant: "brand", size: "lg" })}>{t("landing.cta.start")}<ArrowRight aria-hidden /></Link><a href="#plan-offer" className="chapter-link">{t("landing.chapters.pricing.viewPlan")}<ArrowDown aria-hidden /></a></div><p className="marketing-scope">{t("landing.pricing.status")}</p>
    </ChapterHero>
    <div id="plan-offer" className="marketing-pricing"><Pricing /></div>
    <section className="chapter-section chapter-soft"><div className="chapter-width"><ChapterHeading titleKey="landing.chapters.pricing.checkTitle" descriptionKey="landing.chapters.pricing.checkDescription" /><ScopeTable namespace="pricing" /><ChapterLink href={paths.enterprise()} labelKey="landing.chapters.pricing.enterpriseLink" /></div></section>
  </div></MarketingShell>;
}

export function EnterprisePage() {
  const { t } = useTranslation();
  return <MarketingShell closingTitle="landing.chapters.enterprise.closing" closingDemoHref={`${paths.feature("organization")}#feature-preview`}><div className="chapter-world">
    <ChapterHero titleKey="landing.productPages.enterpriseTitle" descriptionKey="landing.productPages.enterpriseDescription" visual={<ChapterScene featureKey="organization" index={2} />}>
      <div className="marketing-actions"><Link href={paths.feature("organization")} className={buttonVariants({ variant: "brand", size: "lg" })}>{t("landing.productPages.enterpriseCta")}<ArrowRight aria-hidden /></Link><a href="#governance" className="chapter-link">{t("landing.chapters.enterprise.explore")}<ArrowDown aria-hidden /></a></div><p className="marketing-scope">{t("landing.productPages.enterpriseStatus")}</p>
    </ChapterHero>
    <section id="governance" className="chapter-section chapter-soft"><div className="chapter-width"><ChapterHeading titleKey="landing.productPages.enterpriseDetails" descriptionKey="landing.chapters.enterprise.structure" /><ScopeTable namespace="enterprise" /></div></section>
    <div className="chapter-width chapter-section">{GOVERNANCE.map(({ feature, index }, n) => <section className="chapter-row" key={feature}>
      <div className="chapter-row-copy"><CircleCheck aria-hidden /><h2>{t(`landing.chapters.enterprise.examples.${n}`)}</h2><p>{t(`landing.productPages.enterprisePoints.${n}`)}</p><p>{t(`landing.chapters.enterprise.exampleDescriptions.${n}`)}</p><ChapterLink href={paths.feature(feature)} labelKey="landing.productPages.solutionExplore" /></div><ChapterScene featureKey={feature} index={index} />
    </section>)}</div>
  </div></MarketingShell>;
}

function ScopeTable({ namespace }: { namespace: "pricing" | "enterprise" }) {
  const { t } = useTranslation();
  return <table className="chapter-table"><caption className="sr-only">{t(`landing.chapters.${namespace}.${namespace === "pricing" ? "checkTitle" : "structure"}`)}</caption><thead><tr>{["subject", "current", "confirm"].map(key => <th key={key} scope="col">{t(`landing.chapters.table.${key}`)}</th>)}</tr></thead>
    <tbody>{[0, 1, 2].map(index => <tr key={index}>{["subject", "current", "confirm"].map(key => key === "subject" ? <th scope="row" key={key}>{t(`landing.chapters.${namespace}.rows.${index}.${key}`)}</th> : <td key={key}>{t(`landing.chapters.${namespace}.rows.${index}.${key}`)}</td>)}</tr>)}</tbody>
  </table>;
}
