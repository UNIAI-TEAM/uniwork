"use client";
import { FileText } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { featureCopyPrefix } from "./feature-page-catalog";
import { DEMO_FEATURES as PRODUCT_FEATURES, type ProductFeature } from "./showcase";

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
