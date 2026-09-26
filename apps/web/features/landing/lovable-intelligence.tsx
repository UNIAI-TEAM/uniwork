"use client";
import { Bot, Check, FileText, ShieldCheck, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { featureCopyPrefix } from "./feature-page-catalog";
import { LovablePageHeading } from "./lovable-frame";
import { DEMO_FEATURES as PRODUCT_FEATURES, type ProductFeature } from "./showcase";

/** An explained reference, not an invented working screen for unverified actions. */
export function LovableIntelligence({ feature }: { feature: ProductFeature }) {
  const { t } = useTranslation();
  const item = PRODUCT_FEATURES.find(entry => entry.key === feature)!;
  const prefix = featureCopyPrefix(feature);
  const copy = (key: string) => t(`landing.revision.intelligence.${key}`);
  if (feature === "agents") return <div className="lovable-page"><LovablePageHeading title="AI Workforce" subtitle={t(`${prefix}.description`)} /><div className="lovable-view-tabs">{["people", "assignments", "contracts", "skills", "workspaces"].map((key, index) => <span key={key} data-active={index === 0}>{copy(key)}</span>)}</div><div className="lovable-workforce-grid">{["ATLAS", "SAGE", "ECHO", "DEX", "MIRA", "GUARD"].map((name, index) => <section className="lovable-card" key={name}><header><Bot /><strong>{name}</strong></header><h3>{copy(`roles.${index}`)}</h3><p>{t("landing.revision.groups.ai.action")}</p><footer><span>{copy("workspaces")}</span><strong>General</strong></footer></section>)}</div><p className="lovable-intelligence-notice">{t("landing.revision.referenceScope")}</p></div>;
  if (feature === "ai-brain" || feature === "decisions") return <div className="lovable-page"><LovablePageHeading title={t(item.label)} subtitle={t(`${prefix}.description`)} /><div className="lovable-agent-safety"><ShieldCheck />{copy("permission")}</div><div className="lovable-view-tabs">{["pending", "approved", "activity"].map((key, index) => <span key={key} data-active={index === 0}>{copy(key)}</span>)}</div><section className="lovable-card lovable-proposal"><header><Sparkles /><h3>{t("landing.revision.journey.steps.1.result")}</h3><span className="lovable-tag">pending</span></header><p>{t("landing.revision.journey.steps.1.description")}</p><dl><div><dt>{copy("source")}</dt><dd><FileText />{t("landing.revision.journey.steps.0.result")}</dd></div><div><dt>{t("landing.revision.journey.owner")}</dt><dd>Hoàng Anh</dd></div></dl><footer><ShieldCheck />{copy("review")}</footer></section><p className="lovable-intelligence-notice">{copy("noRealAction")}</p></div>;
  return <div className="lovable-page">
    <LovablePageHeading title={t(item.label)} subtitle={t(`${prefix}.description`)} />
    <div className="lovable-intelligence-grid">{[FileText, ShieldCheck, Check].map((Icon, index) => <section className="lovable-card" key={index}><h3><Icon />{t(`landing.revision.journey.${["source", "owner", "output"][index]}`)}</h3><p>{t(`${prefix}.points.${index}`)}</p></section>)}</div>
    <div className="lovable-intelligence-notice"><strong>{copy("overview")}</strong><p>{t("landing.revision.referenceScope")}</p></div>
  </div>;
}
