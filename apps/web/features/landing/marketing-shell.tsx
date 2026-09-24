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
import "./landing-v2.css";

/**
 * THESIS: Understand a feature before entering its demo.
 * OWN-WORLD: Existing UniWork studio, Be Vietnam Pro, cobalt actions and native previews.
 * STORY: Choose a product area, understand its workflow, then explore or register.
 * FIRST VIEWPORT: A concise left-aligned promise and CTA beside a full reference UI;
 * grouped route navigation gives the product a browsable information architecture.
 * FORM: User-pinned ClickUp product-page canon; established-world extension, code-led.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review,
 * the verdict, DESIGN.md, and every shipping raster carrying its provenance
 */
export function MarketingShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return <div className={`landing-site marketing-site ${landingFont.variable}`} data-design-contract="uniwork-product-pages">
    <a className="landing-skip" href="#marketing-main">{t("landing.studio.skip")}</a>
    <SiteHeader />
    <main id="marketing-main">{children}<FinalCta /></main>
    <SiteFooter />
  </div>;
}
