"use client";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { landingFont } from "../../platform/landing-font";
import { SiteHeader } from "./site-header";
import { SiteFooter } from "./site-footer";
import { FinalCta } from "./final-cta";
import "./landing.css";
import "./landing-motion.css";
import "./landing-explorer.css";
import "./landing-products.css";
import "./landing-meetings.css";
import "./landing-workspace.css";
import "./landing-playback.css";
import "./landing-reference.css";
import "./landing-action-motion.css";
import "./landing-lovable.css";
import "./landing-focus.css";
import "./landing-decisions.css";
import "./marketing-pages.css";
import "./feature-visuals.css";

/**
 * THESIS: Understand a feature before entering its demo.
 * OWN-WORLD: Existing UniWork studio, Be Vietnam Pro, cobalt actions and native previews.
 * STORY: Choose a product area, understand its workflow, then explore or register.
 * FIRST VIEWPORT: Feature pages pair a concise promise and CTA with an authored illustrative
 * hero, then three workflow examples and the full reference preview with its controls.
 * Other marketing surfaces retain their own composition and grouped route navigation.
 * FORM: User-pinned ClickUp product-page canon; established-world extension, code-led.
 * FINISH: The scoped implementation, evidence and review disposition are recorded in
 * docs/landing-feature-pages.md; the established global design system remains authoritative.
 */
export function MarketingShell({ children, closingTitle, closingDemoHref }: {
  children: ReactNode;
  closingTitle?: string;
  closingDemoHref?: string;
}) {
  const { t } = useTranslation();
  return <div className={`landing-site marketing-site ${landingFont.variable}`} data-design-contract="uniwork-product-pages">
    <a className="landing-skip" href="#marketing-main">{t("landing.studio.skip")}</a>
    <SiteHeader />
    <main id="marketing-main">{children}<FinalCta compact titleKey={closingTitle} demoHref={closingDemoHref} /></main>
    <SiteFooter />
  </div>;
}
