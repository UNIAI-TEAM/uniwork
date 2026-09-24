"use client";
import { ArrowRight, Check, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { MarketingShell } from "./marketing-shell";
import { LovableReference } from "./lovable-reference";
import { Pricing } from "./pricing";
import { Faq } from "./faq";
import { SOLUTIONS, SOLUTION_KEYS } from "./solutions";

export function SolutionsPage() {
  const { t } = useTranslation();
  return <MarketingShell>
    <section className="marketing-intro"><h1>{t("landing.productPages.solutionsTitle")}</h1><p>{t("landing.productPages.solutionsDescription")}</p></section>
    <div className="marketing-solutions">{SOLUTION_KEYS.map((key, index) => <section key={key}>
      <div><h2>{t(`${SOLUTIONS[key].ns}.name`)}</h2><p>{t(`${SOLUTIONS[key].ns}.sub`)}</p><Link href={SOLUTIONS[key].href}>{t("landing.productPages.solutionExplore")}<ArrowRight aria-hidden /></Link></div>
      <div className="marketing-preview"><LovableReference feature={index === 0 ? "projects" : "today"} /></div>
    </section>)}</div>
  </MarketingShell>;
}

export function LearnPage() {
  const { t } = useTranslation();
  const destinations = [paths.feature("organization"), paths.feature("tasks"), paths.feature("approvals")];
  return <MarketingShell>
    <section className="marketing-intro"><h1>{t("landing.productPages.learnTitle")}</h1><p>{t("landing.productPages.learnDescription")}</p><div className="marketing-actions"><Link href={paths.register()} className={buttonVariants({ variant: "brand", size: "lg" })}>{t("landing.cta.start")}<ArrowRight aria-hidden /></Link></div></section>
    <p className="learning-prerequisite">{t("landing.revision.learn.prerequisite")}</p>
    <ol className="marketing-learning-path">{destinations.map((to, index) => <li key={to}><span className="learning-step" aria-hidden>{index + 1}</span><div><h2>{t(`landing.productPages.learnSteps.${index}.title`)}</h2><ol className="learning-instructions">{[0, 1].map(step => <li key={step}>{t(`landing.revision.learn.steps.${index}.instructions.${step}`)}</li>)}</ol><p className="learning-outcome">{t(`landing.revision.learn.steps.${index}.outcome`)}</p><Link href={to}>{t("landing.productPages.learnCta")}<ChevronRight aria-hidden /></Link><Link className="learning-sample-link" href={`/#${["to-chuc", "du-an", "phe-duyet"][index]}`}>{t("landing.revision.learn.try")}<ArrowRight aria-hidden /></Link></div></li>)}</ol>
    <section id="setup" className="learning-setup"><h2>{t("landing.revision.learn.setupTitle")}</h2><p>{t("landing.revision.learn.setupDescription")}</p><small>{t("landing.revision.contactPending")}</small></section>
    <div id="questions" className="marketing-questions"><Faq namespace="landing.faq" count={10} initialCount={5} title="landing.productPages.faqTitle" /></div>
  </MarketingShell>;
}

export function PricingPage() {
  const { t } = useTranslation();
  return <MarketingShell><section className="marketing-intro marketing-intro-compact"><h1>{t("landing.productPages.pricingTitle")}</h1><p>{t("landing.productPages.pricingDescription")}</p></section><div className="marketing-pricing"><Pricing /></div></MarketingShell>;
}

export function EnterprisePage() {
  const { t } = useTranslation();
  return <MarketingShell>
    <section className="feature-page-hero">
      <div className="feature-page-copy"><h1>{t("landing.productPages.enterpriseTitle")}</h1><p>{t("landing.productPages.enterpriseDescription")}</p><div className="marketing-actions"><Link href={paths.feature("organization")} className={buttonVariants({ variant: "brand", size: "lg" })}>{t("landing.productPages.enterpriseCta")}<ArrowRight aria-hidden /></Link></div><p className="marketing-scope">{t("landing.productPages.enterpriseStatus")}</p></div>
      <div className="feature-page-visual"><LovableReference feature="organization" /></div>
    </section>
    <section className="feature-page-details"><div><h2>{t("landing.productPages.enterpriseDetails")}</h2><Link href={paths.feature("audit")} className="marketing-text-link">{t("landing.catalog.features.audit.label")}<ArrowRight aria-hidden /></Link></div><ul>{[0,1,2].map(index => <li key={index}><Check aria-hidden /><span>{t(`landing.productPages.enterprisePoints.${index}`)}</span></li>)}</ul></section>
  </MarketingShell>;
}
