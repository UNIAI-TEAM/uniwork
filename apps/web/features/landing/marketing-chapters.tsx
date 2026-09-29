"use client";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Logo } from "@uniwork/ui/brand";
import { FeatureIllustration } from "./feature-illustration";
import type { FeaturePageKey } from "./feature-page-catalog";
import { PRODUCT_FEATURES } from "./showcase";
import "./marketing-chapters.css";
import "./marketing-light.css";

/**
 * THESIS: Show the subject at work, then organize the decision around real criteria.
 * OWN-WORLD: Inherited Bright Studio, official UniWork identity and authored sample UI.
 * FIRST VIEWPORT: A branded offer beside the chapter's own scene and useful actions.
 * STORY: Read the purpose, inspect examples and scope, then follow a real feature route.
 * FORM: User-pinned existing product-page canon, code-led local content extension.
 */
export function ChapterHero({ titleKey, descriptionKey, children, visual }: {
  titleKey: string; descriptionKey: string; children?: ReactNode; visual: ReactNode;
}) {
  const { t } = useTranslation();
  return <section className="chapter-hero chapter-width" aria-labelledby="chapter-title">
    <div className="chapter-hero-copy"><Logo variant="lockup" size={26} /><h1 id="chapter-title">{t(titleKey)}</h1><p>{t(descriptionKey)}</p>{children}</div>
    <div className="chapter-hero-media">{visual}</div>
  </section>;
}

export function ChapterScene({ featureKey, index = 0 }: { featureKey: FeaturePageKey; index?: 0 | 1 | 2 | 3 }) {
  const { t } = useTranslation();
  const feature = PRODUCT_FEATURES.find(item => item.key === featureKey)!;
  return <figure className="chapter-scene" data-feature-group={feature.group}>
    <div className="chapter-scene-media"><FeatureIllustration featureKey={featureKey} index={index} /></div>
    <figcaption><feature.icon aria-hidden /><strong>{t(feature.label)}</strong><span>{t("landing.featureVisuals.sample")}</span></figcaption>
  </figure>;
}

export function ChapterHeading({ titleKey, descriptionKey }: { titleKey: string; descriptionKey?: string }) {
  const { t } = useTranslation();
  return <div className="chapter-heading"><h2>{t(titleKey)}</h2>{descriptionKey && <p>{t(descriptionKey)}</p>}</div>;
}

export function ChapterLink({ href, labelKey }: { href: string; labelKey: string }) {
  const { t } = useTranslation();
  return <Link className="chapter-link" href={href}>{t(labelKey)}<ArrowRight aria-hidden /></Link>;
}
