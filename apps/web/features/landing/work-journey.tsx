"use client";
import { ArrowRight, Check, FileText, Sparkles, UserRound, Video } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { Container } from "./layout-primitives";

const STEPS = [{ icon: Video, feature: "meetings" }, { icon: Sparkles, feature: "ai-brain" }, { icon: UserRound, feature: "tasks" }, { icon: Check, feature: "approvals" }] as const;

/** Local walkthrough, not a claim of autonomous end-to-end execution. */
export function WorkJourney() {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const prefix = "landing.revision.journey";
  const selected = STEPS[step]!;
  return <section className="work-journey" aria-labelledby="work-journey-title"><Container>
    <header><div><span className="journey-eyebrow">{t(`${prefix}.eyebrow`)}</span><h2 id="work-journey-title">{t(`${prefix}.title`)}</h2></div><p>{t(`${prefix}.description`)}</p></header>
    <div className="journey-steps" aria-label={t(`${prefix}.title`)}>{STEPS.map(({ icon: Icon }, index) => <button key={index} type="button" aria-pressed={step === index} aria-controls="journey-detail" onClick={() => setStep(index)}><span>{index + 1}</span><Icon aria-hidden /><strong>{t(`${prefix}.steps.${index}.label`)}</strong></button>)}</div>
    <div id="journey-detail" className="journey-detail">
      <div aria-live="polite"><h3>{t(`${prefix}.steps.${step}.title`)}</h3><p>{t(`${prefix}.steps.${step}.description`)}</p><Link href={paths.feature(selected.feature)}>{t(`${prefix}.open`)}<ArrowRight aria-hidden /></Link></div>
      <div className="journey-result" key={step}><span><selected.icon aria-hidden />{t(`${prefix}.steps.${step}.status`)}</span><strong><FileText aria-hidden />{t(`${prefix}.steps.${step}.result`)}</strong><small>{t(`${prefix}.sample`)}</small></div>
    </div>
  </Container></section>;
}
