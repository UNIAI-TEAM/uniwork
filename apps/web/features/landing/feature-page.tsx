"use client";
import { ArrowRight, ChevronRight, Play } from "lucide-react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { PRODUCT_FEATURES, PRODUCT_GROUPS } from "./showcase";
import { type FeaturePageKey } from "./feature-page-catalog";
import { hasPlayback, ProductPlayback } from "./product-playback";
import { LovableReference } from "./lovable-reference";
import { MarketingShell } from "./marketing-shell";
import { FeatureIllustration } from "./feature-illustration";

export function FeaturePage({ featureKey }: { featureKey: FeaturePageKey }) {
  const { t } = useTranslation();
  const feature = PRODUCT_FEATURES.find(item => item.key === featureKey)!;
  const prefix = `landing.productPages.features.${featureKey}`;
  const related = PRODUCT_FEATURES.filter(item => item.group === feature.group && item.key !== featureKey);
  const companions = (related.length ? related : PRODUCT_FEATURES.filter(item => ["documents", "ask", "tasks"].includes(item.key))).slice(0, 3);
  return <MarketingShell>
    <div className="feature-world" data-feature-group={feature.group}>
    <section className="feature-page-hero">
      <div className="feature-page-copy">
        <nav className="marketing-breadcrumb" aria-label={t("landing.productPages.breadcrumb")}><Link href={paths.features()}>{t("landing.productPages.product")}</Link><ChevronRight aria-hidden /><span>{t(feature.label)}</span></nav>
        <h1>{t(`${prefix}.title`)}</h1>
        <p>{t(`${prefix}.description`)}</p>
        <div className="marketing-actions"><Link href={paths.register()} className={buttonVariants({ variant: "brand", size: "lg" })}>{t("landing.cta.start")}<ArrowRight aria-hidden /></Link><Link href={`/#${feature.anchor}`} className={buttonVariants({ variant: "outline", size: "lg" })}><Play aria-hidden />{t("landing.productPages.watchDemo")}</Link></div>
        <p className="marketing-scope">{t(feature.availability)}</p>
      </div>
      <div className="feature-page-art"><FeatureIllustration featureKey={featureKey} /><div className="feature-art-caption"><feature.icon aria-hidden /><strong>{t(feature.label)}</strong><span>{t("landing.featureVisuals.sample")}</span></div></div>
    </section>
    <section className="feature-page-details" aria-labelledby="feature-details-title">
      <div className="feature-example-heading"><h2 id="feature-details-title">{t(`${prefix}.detailTitle`)}</h2><p>{t("landing.featureVisuals.examples")}</p></div>
      <ul>{([1, 2, 3] as const).map(index => <li key={index}><FeatureIllustration featureKey={featureKey} index={index} /><p>{t(`${prefix}.points.${index - 1}`)}</p></li>)}</ul>
    </section>
    <section className="feature-demo" aria-labelledby="feature-demo-title"><div className="feature-demo-heading"><h2 id="feature-demo-title">{t("landing.featureVisuals.preview", { feature: t(feature.label) })}</h2><p>{t(feature.availability)}</p></div><div className="feature-page-visual">{hasPlayback(featureKey) ? <ProductPlayback featureKey={featureKey} /> : <LovableReference feature={featureKey} />}</div></section>
    <section className="feature-page-related"><h2>{t("landing.productPages.connected")}</h2><div>{companions.map(item => <Link key={item.key} href={paths.feature(item.key)}><item.icon aria-hidden /><span><strong>{t(item.label)}</strong><small>{t(item.description)}</small></span><ArrowRight aria-hidden /></Link>)}</div></section>
    </div>
  </MarketingShell>;
}

export function FeaturesPage() {
  const { t } = useTranslation();
  return <MarketingShell>
    <section className="marketing-intro"><h1>{t("landing.productPages.directoryTitle")}</h1><p>{t("landing.productPages.directoryDescription")}</p><div className="marketing-actions"><Link href="/#platform" className={cn(buttonVariants({ variant: "brand", size: "lg" }))}><Play aria-hidden />{t("landing.productPages.watchDemo")}</Link></div><p className="feature-directory-disclosure">{t("landing.featureVisuals.directoryDisclosure")}</p></section>
    <div className="feature-directory feature-directory-visual">{PRODUCT_GROUPS.map(group => <section key={group.key} data-feature-group={group.key}><h2><group.icon aria-hidden />{t(`landing.catalog.groups.${group.key}`)}</h2><div>{PRODUCT_FEATURES.filter(item => item.group === group.key).map(feature => <Link href={paths.feature(feature.key)} key={feature.key}><FeatureIllustration featureKey={feature.key} decorative /><div className="feature-directory-caption"><feature.icon aria-hidden /><span><h3>{t(feature.label)}</h3><p>{t(`landing.productPages.features.${feature.key}.description`)}</p></span><ArrowRight aria-hidden /></div></Link>)}</div></section>)}</div>
  </MarketingShell>;
}
