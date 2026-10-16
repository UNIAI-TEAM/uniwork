"use client";
import { Bot, Check, FileText, ShieldCheck, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { featureCopyPrefix } from "./feature-page-catalog";
import { LovablePageHeading } from "./lovable-frame";
import { DEMO_FEATURES as PRODUCT_FEATURES, type ProductFeature } from "./showcase";
import { DEMO_MEMBERS } from "./product-demo-data";

/** An explained reference, not an invented working screen for unverified actions. */
export function LovableIntelligence({ feature }: { feature: ProductFeature }) {
  const { t } = useTranslation();
  const item = PRODUCT_FEATURES.find(entry => entry.key === feature)!;
  const prefix = featureCopyPrefix(feature);
  const copy = (key: string) => t(`landing.revision.intelligence.${key}`);
  if (feature === "agents") return <div className="lovable-page"><LovablePageHeading title="AI Workforce" subtitle={t(`${prefix}.description`)} /><div className="lovable-view-tabs">{["people", "assignments", "contracts", "skills", "workspaces"].map((key, index) => <span key={key} data-active={index === 0}>{copy(key)}</span>)}</div><div className="lovable-workforce-grid">{["ATLAS", "SAGE", "ECHO", "DEX", "MIRA", "GUARD"].map((name, index) => <section className="lovable-card" key={name}><header><Bot /><strong>{name}</strong></header><h3>{copy(`roles.${index}`)}</h3><p>{t("landing.revision.groups.ai.action")}</p><footer><span>{copy("workspaces")}</span><strong>General</strong></footer></section>)}</div><p className="lovable-intelligence-notice">{t("landing.revision.referenceScope")}</p></div>;
  if (feature === "ai-brain" || feature === "decisions") return <div className="lovable-page"><LovablePageHeading title={t(item.label)} subtitle={t(`${prefix}.description`)} /><div className="lovable-agent-safety"><ShieldCheck />{copy("permission")}</div><div className="lovable-view-tabs">{["pending", "approved", "activity"].map((key, index) => <span key={key} data-active={index === 0}>{copy(key)}</span>)}</div><section className="lovable-card lovable-proposal"><header><Sparkles /><h3>{t("landing.revision.journey.steps.1.result")}</h3><span className="lovable-tag">pending</span></header><p>{t("landing.revision.journey.steps.1.description")}</p><dl><div><dt>{copy("source")}</dt><dd><FileText />{t("landing.revision.journey.steps.0.result")}</dd></div><div><dt>{t("landing.revision.journey.owner")}</dt><dd>Khánh Vy</dd></div></dl><footer><ShieldCheck />{copy("review")}</footer></section><p className="lovable-intelligence-notice">{copy("noRealAction")}</p></div>;
  return <div className="lovable-page">
    <LovablePageHeading title={t(item.label)} subtitle={t(`${prefix}.description`)} />
    <div className="lovable-library-list">{[FileText, ShieldCheck, Check].map((Icon, index) => <div key={index}><span className="lovable-file-icon"><Icon /></span><div><h3>{t(`landing.productDemo.concepts.${feature}.${index}`)}</h3><p>{DEMO_MEMBERS[index + 1]!.name} · Demo Studio</p></div><span className="lovable-tag">{feature === "decision-history" ? "approved" : "draft"}</span><span>16/10/2026</span></div>)}</div>
    <div className="lovable-intelligence-notice"><strong>{copy("overview")}</strong><p>{t("landing.revision.referenceScope")}</p></div>
  </div>;
}
