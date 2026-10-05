"use client";
import { ArrowRight, ChevronRight, Play } from "lucide-react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { Logo } from "@uniwork/ui/brand";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { PRODUCT_FEATURES, PRODUCT_GROUPS } from "./showcase";
import { type FeaturePageKey } from "./feature-page-catalog";
import { hasPlayback, ProductPlayback } from "./product-playback";
import { LovableReference } from "./lovable-reference";
import { MarketingShell } from "./marketing-shell";
import { FeatureIllustration } from "./feature-illustration";
import { ChapterHero, ChapterScene } from "./marketing-chapters";

export function FeaturePage({ featureKey }: { featureKey: FeaturePageKey }) {
  const { t } = useTranslation();
  const feature = PRODUCT_FEATURES.find(item => item.key === featureKey)!;
  const prefix = `landing.productPages.features.${featureKey}`;
  const related = PRODUCT_FEATURES.filter(item => item.group === feature.group && item.key !== featureKey);
  const companions = (related.length ? related : PRODUCT_FEATURES.filter(item => ["documents", "ask", "tasks"].includes(item.key))).slice(0, 3);
  return <MarketingShell closingDemoHref="#feature-preview">
    <div className="feature-world chapter-world" data-feature-group={feature.group}>
    <section className="feature-page-hero">
      <div className="feature-page-copy">
        <div className="feature-page-brand"><Logo variant="lockup" size={24} /></div>
        <nav className="marketing-breadcrumb" aria-label={t("landing.productPages.breadcrumb")}><Link href={paths.features()}>{t("landing.productPages.product")}</Link><ChevronRight aria-hidden /><span>{t(feature.label)}</span></nav>
        <h1>{t(`${prefix}.title`)}</h1>
        <p>{t(`${prefix}.description`)}</p>
        <div className="marketing-actions"><Link href={paths.register()} className={buttonVariants({ variant: "brand", size: "lg" })}>{t("landing.cta.start")}<ArrowRight aria-hidden /></Link><Link href={`/#${feature.anchor}`} className={buttonVariants({ variant: "outline", size: "lg" })}><Play aria-hidden />{t("landing.productPages.watchDemo")}</Link></div>
        <p className="marketing-scope">{t(feature.availability)}</p>
      </div>
      <div className="feature-page-art"><FeatureIllustration featureKey={featureKey} /><div className="feature-art-caption"><feature.icon aria-hidden /><strong>{t(feature.label)}</strong><span>{t("landing.featureVisuals.sample")}</span></div></div>
    </section>
    <section className="feature-page-details feature-examples" aria-labelledby="feature-details-title">
      <div className="feature-example-heading"><h2 id="feature-details-title">{t(`${prefix}.detailTitle`)}</h2><p>{t("landing.featureVisuals.examples")}</p></div>
      <ul>{([1, 2, 3] as const).map(index => <li key={index}><div className="feature-example-copy"><h3>{t(`landing.chapters.featureExamples.${featureKey}.${index - 1}`)}</h3><p>{t(`${prefix}.points.${index - 1}`)}</p>{index === 3 && <p className="marketing-scope">{t(feature.availability)}</p>}</div><FeatureIllustration featureKey={featureKey} index={index} /></li>)}</ul>
    </section>
    <section id="feature-preview" className="feature-demo" aria-labelledby="feature-demo-title"><div className="feature-demo-heading"><h2 id="feature-demo-title">{t("landing.featureVisuals.preview", { feature: t(feature.label) })}</h2><p>{t(feature.availability)}</p></div><div className="feature-page-visual">{hasPlayback(featureKey) ? <ProductPlayback featureKey={featureKey} /> : <LovableReference feature={featureKey} />}</div></section>
    <section className="feature-page-related" aria-labelledby="feature-related-title">
      <div className="feature-related-heading"><h2 id="feature-related-title">{t("landing.productPages.connected")}</h2><p>{t("landing.featureVisuals.sample")}</p></div>
      <div className="feature-related-grid">{companions.map(item => <Link key={item.key} href={paths.feature(item.key)}>
        <div className="feature-related-preview"><FeatureIllustration featureKey={item.key} index={item.key === "projects" ? 1 : 0} decorative /></div>
        <div className="feature-related-caption"><item.icon aria-hidden /><span><strong>{t(item.label)}</strong><small>{t(item.description)}</small></span><ArrowRight aria-hidden /></div>
      </Link>)}</div>
    </section>
    </div>
  </MarketingShell>;
}

export function FeaturesPage() {
  const { t } = useTranslation();
  return <MarketingShell closingTitle="landing.chapters.features.closing"><div className="chapter-world">
    <ChapterHero titleKey="landing.productPages.directoryTitle" descriptionKey="landing.productPages.directoryDescription" visual={<ChapterScene featureKey="projects" index={1} />}>
      <div className="marketing-actions"><a href="#family-work" className={cn(buttonVariants({ variant: "brand", size: "lg" }))}>{t("landing.chapters.features.browse")}<ArrowRight aria-hidden /></a><Link href="/#platform" className="chapter-link"><Play aria-hidden />{t("landing.productPages.watchDemo")}</Link></div><p className="marketing-scope">{t("landing.featureVisuals.directoryDisclosure")}</p>
    </ChapterHero>
    <nav className="feature-family-nav chapter-width" aria-label={t("landing.chapters.features.navigation")}>{PRODUCT_GROUPS.map(group => <a href={`#family-${group.key}`} key={group.key}><group.icon aria-hidden /><strong>{t(`landing.catalog.groups.${group.key}`)}</strong><small>{PRODUCT_FEATURES.filter(item => item.group === group.key).length}</small></a>)}</nav>
    <div className="feature-directory feature-directory-visual">{PRODUCT_GROUPS.map(group => <section key={group.key} id={`family-${group.key}`} data-feature-group={group.key}>
      <div className="feature-directory-group-copy"><h2><group.icon aria-hidden />{t(`landing.catalog.groups.${group.key}`)}</h2><p>{t(`landing.chapters.features.groups.${group.key}`)}</p></div>
      <div>{PRODUCT_FEATURES.filter(item => item.group === group.key).map(feature => <Link href={paths.feature(feature.key)} key={feature.key}><FeatureIllustration featureKey={feature.key} decorative /><div className="feature-directory-caption"><feature.icon aria-hidden /><span><h3>{t(feature.label)}</h3><p>{t(`landing.productPages.features.${feature.key}.description`)}</p><span className="feature-directory-status">{t(`landing.chapters.features.status.${feature.status}`)}</span></span><ArrowRight aria-hidden /></div></Link>)}</div>
    </section>)}</div>
  </div></MarketingShell>;
}
