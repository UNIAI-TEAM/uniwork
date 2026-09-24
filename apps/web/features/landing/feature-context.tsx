"use client";
import { ArrowRight, ChevronDown, FileText } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { featureCopyPrefix } from "./feature-page-catalog";
import { PRODUCT_FEATURES, type ProductFeature } from "./showcase";

const query = "(max-width: 767px)";
function subscribe(notify: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
}
export function useCompactPreview() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

/** A readable explanation, deliberately not a fake native mobile screen. */
export function MobileFeatureStory({ feature }: { feature: ProductFeature }) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const item = PRODUCT_FEATURES.find(entry => entry.key === feature)!;
  const prefix = featureCopyPrefix(feature);
  return <div className="mobile-feature-story" data-mobile-feature={feature}>
    <header><item.icon aria-hidden /><div><small>{t("landing.revision.mobileLabel")}</small><strong>{t(item.label)}</strong></div></header>
    <p>{t(`${prefix}.description`)}</p>
    <div className="mobile-story-steps" aria-label={t("landing.revision.mobileSteps")}>{[0, 1, 2].map(index => <button key={index} type="button" aria-pressed={step === index} aria-label={`${t("landing.revision.mobileSteps")} ${index + 1}`} onClick={() => setStep(index)}>{index + 1}</button>)}</div>
    <div className="mobile-story-detail" aria-live="polite"><FileText aria-hidden /><p>{t(`${prefix}.points.${step}`)}</p></div>
    <small>{t("landing.revision.mobileNote")}</small>
  </div>;
}

export function FeatureContext({ feature }: { feature: ProductFeature }) {
  const { t } = useTranslation();
  const group = PRODUCT_FEATURES.find(item => item.key === feature)!.group;
  const prefix = `landing.revision.groups.${group}`;
  return <div className="feature-context">
    <section className="feature-workflow" aria-labelledby="feature-workflow-title"><h2 id="feature-workflow-title">{t("landing.revision.workflowTitle")}</h2><ol>{["input", "action", "output"].map((key, index) => <li key={key}><span>{index + 1}</span><p>{t(`${prefix}.${key}`)}</p>{index !== 2 && <ArrowRight aria-hidden />}</li>)}</ol></section>
    <section className="feature-questions"><h2>{t("landing.revision.questionTitle")}</h2>{[[`${prefix}.question`, `${prefix}.answer`], ["landing.revision.scopeQuestion", "landing.revision.scopeAnswer"]].map(([question, answer]) => <details key={question}><summary>{t(question!)}<ChevronDown aria-hidden /></summary><p>{t(answer!)}</p></details>)}</section>
  </div>;
}
