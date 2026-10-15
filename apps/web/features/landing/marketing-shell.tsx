"use client";
import { MarketingAnchor } from "../../platform/marketing-link";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { landingFont } from "../../platform/landing-font";
import { SiteHeader } from "./site-header";
import { SiteFooter } from "./site-footer";
import { FinalCta, type ClosingAction } from "./final-cta";
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
import "./marketing-preview.css";

/**
 * THESIS: Understand a feature before entering its demo.
 * OWN-WORLD: Existing UniWork studio, Be Vietnam Pro, cobalt actions and native previews.
 * STORY: Choose a product area, understand its workflow, then explore or register.
 * FIRST VIEWPORT: Feature pages pair a concise promise and CTA with an authored illustrative
 * hero, then three workflow explanations sharing one example stage and the full reference
 * preview with its controls.
 * Other marketing surfaces retain their own composition and grouped route navigation.
 * FORM: User-pinned ClickUp product-page canon; established-world extension, code-led.
 * FINISH: The scoped implementation, evidence and review disposition are recorded in
 * docs/landing-feature-pages.md; the established global design system remains authoritative.
 */
export function MarketingShell({ children, closingTitle, closingDescription, closingDemoHref, closingAction, showClosing = true, className = "" }: {
  children: ReactNode;
  closingTitle?: string;
  closingDescription?: string;
  closingDemoHref?: string;
  closingAction?: ClosingAction;
  showClosing?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  return <div className={`landing-site marketing-site ${landingFont.variable} ${className}`} data-design-contract="uniwork-product-pages">
    <MarketingAnchor className="landing-skip" href="#marketing-main">{t("landing.studio.skip")}</MarketingAnchor>
    <SiteHeader />
    <main id="marketing-main">{children}{showClosing && <FinalCta compact titleKey={closingTitle} descriptionKey={closingDescription} demoHref={closingDemoHref} secondaryAction={closingAction} />}</main>
    <SiteFooter />
  </div>;
}
