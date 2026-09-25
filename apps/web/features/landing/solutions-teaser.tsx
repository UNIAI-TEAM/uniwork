"use client";

import { useState } from "react";
import { ArrowUpRight, BriefcaseBusiness, Check, ChevronRight, Code2, MessageSquareText, Workflow } from "lucide-react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { Logo } from "@uniwork/ui/brand";
import { ANCHORS } from "./anchors";
import { Container } from "./layout-primitives";
import { SOLUTIONS } from "./solutions";

type Audience = "leaders" | "product" | "operations";

const AUDIENCES = [
  { key: "leaders", icon: BriefcaseBusiness, title: "landing.studio.leadTitle", description: "landing.studio.leadDesc", cta: "landing.studio.leadCta", href: `#${ANCHORS.platform}` },
  { key: "product", icon: Code2, title: "landing.solutions.product.name", description: "landing.explorer.productSolution", cta: "landing.solutions.cardCta", href: SOLUTIONS.product.href },
  { key: "operations", icon: Workflow, title: "landing.solutions.operations.name", description: "landing.explorer.operationsSolution", cta: "landing.solutions.cardCta", href: SOLUTIONS.operations.href },
] as const;

function AudiencePreview({ audience }: { audience: Audience }) {
  const { t } = useTranslation();
  return <div className="solution-screen" role="img" aria-label={`${t("landing.studio.demoWorkspace")}: ${t(AUDIENCES.find(item => item.key === audience)!.title)}`}>
    <div className="solution-screen-bar"><Logo variant="lockup" size={22} decorative /><span>{t("landing.studio.demoWorkspace")}</span><span className="solution-screen-dots" aria-hidden><i /><i /><i /></span></div>
    {audience === "leaders" && <div className="solution-screen-content solution-screen-leaders">
      <div className="solution-screen-heading"><span>{t("landing.studio.overview")}</span><strong>{t("landing.studio.launchProject")}</strong></div>
      <div className="solution-screen-metrics"><div><span>{t("landing.reference.total")}</span><strong>04</strong></div><div><span>{t("landing.reference.progress")}</span><strong>02</strong></div><div><span>{t("landing.reference.completed")}</span><strong>01</strong></div></div>
      <div className="solution-screen-row"><span className="solution-screen-status" /><span>{t("landing.studio.task_design")}</span><b>HA</b></div>
      <div className="solution-screen-row"><span className="solution-screen-status" /><span>{t("landing.studio.task_review")}</span><b>TN</b></div>
      <div className="solution-screen-connector"><Check aria-hidden />{t("landing.studio.selectionHint")}</div>
    </div>}
    {audience === "product" && <div className="solution-screen-content solution-screen-product">
      <div className="solution-screen-heading"><span>{t("landing.studio.productTeam")}</span><strong>{t("landing.studio.launchProject")}</strong></div>
      <div className="solution-screen-product-body"><div className="solution-screen-task"><span className="solution-screen-tag">UW-102 · {t("landing.studio.design")}</span><strong>{t("landing.studio.task_design")}</strong><span className="solution-screen-person"><b>HA</b> Hoàng Anh</span></div><div className="solution-screen-thread"><MessageSquareText aria-hidden /><strong>{t("landing.studio.contextAttached")}</strong><p>{t("landing.studio.message1")}</p><span>{t("landing.studio.sharedWithTeam")}</span></div></div>
      <div className="solution-screen-connector"><Check aria-hidden />{t("landing.studio.selectionHint")}</div>
    </div>}
    {audience === "operations" && <div className="solution-screen-content solution-screen-operations">
      <div className="solution-screen-heading"><span>{t("landing.studio.demoWorkspace")}</span><strong>{t("landing.studio.solutionsOpsTag")}</strong></div>
      <div className="solution-screen-flow"><div><span><Check aria-hidden /></span><strong>{t("landing.studio.flow1")}</strong><small>{t("landing.studio.flow1Desc")}</small></div><div><span><Check aria-hidden /></span><strong>{t("landing.studio.flow2")}</strong><small>{t("landing.studio.flow2Desc")}</small></div><div><span><Workflow aria-hidden /></span><strong>{t("landing.studio.flow3")}</strong><small>{t("landing.studio.flow3Desc")}</small></div></div>
      <div className="solution-screen-connector"><Check aria-hidden />{t("landing.studio.contextAttached")}</div>
    </div>}
  </div>;
}

export function SolutionsTeaser() {
  const { t } = useTranslation();
  const [active, setActive] = useState<Audience>("product");
  return <section id={ANCHORS.solutions} className="studio-section solutions-section" aria-labelledby="solutions-title">
    <Container className="solution-container">
      <div className="studio-heading-row"><h2 id="solutions-title" className="studio-title">{t("landing.studio.solutionsTitle")}</h2><p className="studio-description">{t("landing.studio.solutionsSub")}</p></div>
      <div className="solution-showcase">
        <div className="solution-cards" aria-label={t("landing.studio.solutionsTitle")}>
          {AUDIENCES.map(({ key, icon: Icon, title, description, cta, href }) => <article className="solution-card" data-active={active === key} key={key}>
            <button type="button" className="solution-select" aria-pressed={active === key} aria-controls="solution-preview" onClick={() => setActive(key)}>
              <span className="solution-icon"><Icon aria-hidden /></span><span className="solution-select-copy"><strong>{t(title)}</strong><small>{t(description)}</small></span><ChevronRight aria-hidden className="solution-chevron" />
            </button>
            <Link href={href} className="solution-link" aria-label={`${t(title)} · ${t(cta)}`}>{t(cta)}<ArrowUpRight aria-hidden /></Link>
          </article>)}
        </div>
        <div className="solution-preview" id="solution-preview" data-audience={active} aria-live="polite"><AudiencePreview key={active} audience={active} /></div>
      </div>
    </Container>
  </section>;
}
