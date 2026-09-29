"use client";
import { ArrowDown, ArrowRight, BookOpen, ExternalLink, FileText, GitBranch, MessageSquare, Play, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { Logo } from "@uniwork/ui/brand";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { FeatureIllustration } from "./feature-illustration";
import { MarketingShell } from "./marketing-shell";
import { PLATFORM_KEYS, PLATFORMS, type PlatformKey } from "./platforms";
import "./why-page.css";

const PLATFORM_MEDIA = {
  ms365: { image: "microsoft.ico", source: "https://www.microsoft.com/en-us/microsoft-365/business", aiSource: "https://www.microsoft.com/en-us/microsoft-365/business" },
  notion: { image: "notion.png", source: "https://www.notion.com/product", aiSource: "https://www.notion.com/product/enterprise-search" },
  clickup: { image: "clickup.png", source: "https://clickup.com/features", aiSource: "https://help.clickup.com/hc/en-us/articles/40048639275287-How-can-Brain-help-my-team" },
  coda: { image: "coda.png", source: "https://coda.io/product", aiSource: "https://coda.io/product/packs" },
} as const;
const CRITERIA = ["work", "knowledge", "communication", "ai", "evaluate"] as const;
const PROOFS = [
  { key: "work", feature: "tasks", index: 2, icon: GitBranch },
  { key: "ai", feature: "ask", index: 0, icon: Sparkles },
  { key: "output", feature: "outputs", index: 3, icon: FileText },
] as const;

/**
 * THESIS: Compare the shape of the work, then inspect it in a connected project.
 * OWN-WORLD: Bright Studio, official identity, Be Vietnam Pro and authored sample UI.
 * FIRST VIEWPORT: A concise invitation beside a task/conversation composition; no vendor fault wall.
 * STORY: One project -> five comparable criteria -> three concrete workflow examples -> demo.
 * FORM: Existing public marketing surface, code-led; factual descriptions with sources, no scores.
 */
export function WhyPage() {
  const { t } = useTranslation();
  return <MarketingShell closingTitle="landing.why.redesign.closingTitle" closingDemoHref={paths.feature("tasks")}>
    <div className="why-page">
      <section className="why-hero why-width" aria-labelledby="why-title">
        <div className="why-hero-copy">
          <Logo variant="lockup" size={28} />
          <h1 id="why-title">{t("landing.why.redesign.title")}</h1>
          <p>{t("landing.why.redesign.description")}</p>
          <div className="marketing-actions">
            <Link href={paths.register()} className={buttonVariants({ variant: "brand", size: "lg" })}>{t("landing.cta.start")}<ArrowRight aria-hidden /></Link>
            <a href="#comparison" className="why-compare-link">{t("landing.why.redesign.compareAction")}<ArrowDown aria-hidden /></a>
          </div>
        </div>
        <figure className="why-workspace">
          <div className="why-workspace-header"><Logo variant="mark" size={28} decorative /><strong>{t("landing.featureVisuals.launch")}</strong><span>ML · HA · TN</span></div>
          <div className="why-workspace-scenes">
            <div className="why-board"><FeatureIllustration featureKey="tasks" decorative /></div>
            <div className="why-chat"><FeatureIllustration featureKey="chat" decorative /></div>
          </div>
          <div className="why-context" aria-hidden="true"><span><GitBranch />{t("nav.tasks")}</span><span><MessageSquare />{t("nav.chat")}</span><span><BookOpen />{t("landing.catalog.features.documents.label")}</span></div>
          <figcaption>{t("landing.featureVisuals.sample")} · {t("landing.why.redesign.sceneCaption")}</figcaption>
        </figure>
      </section>
      <Comparison />
      <section className="why-proof why-width" aria-labelledby="why-proof-title">
        <div className="why-section-heading"><h2 id="why-proof-title">{t("landing.why.redesign.proofTitle")}</h2><p>{t("landing.why.redesign.proofDescription")}</p></div>
        {PROOFS.map(({ key, feature, index, icon: Icon }) => <article key={key} className={`why-proof-row why-proof-${key}`}>
          <div className="why-proof-copy"><Icon aria-hidden /><h3>{t(`landing.why.redesign.proofs.${key}.title`)}</h3><p>{t(`landing.why.redesign.proofs.${key}.description`)}</p>
            <ul>{[0, 1].map(n => <li key={n}>{t(`landing.why.redesign.proofs.${key}.points.${n}`)}</li>)}</ul>
            {key === "output" && <p className="why-availability">{t("landing.why.redesign.proofs.output.status")}</p>}
            <Link href={paths.feature(feature)}>{t("landing.productPages.solutionExplore")}<ArrowRight aria-hidden /></Link>
          </div>
          <figure className="why-proof-figure"><FeatureIllustration featureKey={feature} index={index} /><figcaption>{t("landing.featureVisuals.sample")}</figcaption></figure>
        </article>)}
      </section>
      <section className="why-decision why-width" aria-labelledby="why-decision-title">
        <Logo variant="mark" size={48} decorative />
        <div><h2 id="why-decision-title">{t("landing.why.redesign.decisionTitle")}</h2><p>{t("landing.why.redesign.decisionDescription")}</p></div>
        <Link href={paths.feature("tasks")} className={buttonVariants({ variant: "outline", size: "lg" })}><Play aria-hidden />{t("landing.why.redesign.tryAction")}</Link>
      </section>
    </div>
  </MarketingShell>;
}

function PlatformIdentity({ platform }: { platform: PlatformKey }) {
  const { t } = useTranslation();
  return <span className="why-platform-identity">
    {/* Original vendor marks identify the compared products; they are not endorsement badges. */}
    {/* eslint-disable-next-line @next/next/no-img-element -- Local original marks are tiny, fixed-size comparison identities. */}
    <img src={`/landing/comparison/${PLATFORM_MEDIA[platform].image}`} width={32} height={32} alt="" />
    <span>{t(`${PLATFORMS[platform].ns}.name`)}</span>
  </span>;
}

function Comparison() {
  const { t } = useTranslation();
  const [platform, setPlatform] = useState<PlatformKey>("ms365");
  const ns = "landing.why.redesign";
  return <section id="comparison" className="why-comparison" aria-labelledby="why-comparison-title">
    <div className="why-width">
      <div className="why-section-heading"><h2 id="why-comparison-title">{t(`${ns}.comparisonTitle`)}</h2><p>{t(`${ns}.comparisonDescription`)}</p></div>
      <div className="why-platform-picker" role="group" aria-label={t(`${ns}.choosePlatform`)}>
        {PLATFORM_KEYS.map(key => <Button key={key} variant="ghost" type="button" aria-pressed={platform === key} aria-controls="why-comparison-table" onClick={() => setPlatform(key)}><PlatformIdentity platform={key} /></Button>)}
      </div>
      <p className="why-platform-summary" aria-live="polite">{t(`${ns}.platforms.${platform}.summary`)}</p>
      <table id="why-comparison-table" className="why-table">
        <caption className="sr-only">{t(`${ns}.tableCaption`, { platform: t(`${PLATFORMS[platform].ns}.name`) })}</caption>
        <thead><tr><th scope="col">{t(`${ns}.criteriaLabel`)}</th><th scope="col"><PlatformIdentity platform={platform} /></th><th scope="col"><Logo variant="lockup" size={24} /></th></tr></thead>
        <tbody>{CRITERIA.map(key => <tr key={key}>
          <th scope="row">{t(`${ns}.criteria.${key}`)}</th>
          <td>{t(`${ns}.platforms.${platform}.${key}`)}</td>
          <td className="why-uniwork-cell">{key !== "evaluate" && <span className="why-cell-status">{t(`${ns}.uniwork.${key}Status`)}</span>}{t(`${ns}.uniwork.${key}`)}</td>
        </tr>)}</tbody>
      </table>
      <div className="why-methodology"><p>{t(`${ns}.methodology`)}</p><p>{t(`${ns}.verifiedDate`)} <time dateTime="2026-09-29">29/09/2026</time></p>
        <div className="why-sources"><a href={PLATFORM_MEDIA[platform].source} target="_blank" rel="noreferrer">{t(`${ns}.productSource`)}<ExternalLink aria-hidden /></a><a href={PLATFORM_MEDIA[platform].aiSource} target="_blank" rel="noreferrer">{t(`${ns}.contextSource`)}<ExternalLink aria-hidden /></a></div>
      </div>
    </div>
  </section>;
}
