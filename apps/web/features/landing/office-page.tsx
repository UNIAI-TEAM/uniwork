"use client";
import { MarketingAnchor } from "../../platform/marketing-link";
import { ArrowRight, Download, FolderOpen, MessageSquare, RotateCcwClock } from "lucide-react";
import { MarketingLink as Link } from "../../platform/marketing-link";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { Faq } from "./faq";
import { MarketingShell } from "./marketing-shell";
import { OFFICE_BUSINESS_ANCHOR, OFFICE_EDITOR_ANCHOR, type OfficeEditorKey } from "./office-data";
import { AppBar } from "./apps/app-bar";
import { AppDownload } from "./apps/app-download";
import { OtherApps } from "./apps/app-sections";
import { OfficeEditorTabs } from "./office-editors";
import { OfficeConnection } from "./office-connection";
import "./apps/apps.css";
import "./marketing-chapters.css";
import "./office.css";

const SECTIONS = [
  { id: OFFICE_BUSINESS_ANCHOR, labelKey: "landing.apps.bar.overview" },
  { id: OFFICE_EDITOR_ANCHOR, labelKey: "landing.apps.bar.editors" },
  { id: "office-download", labelKey: "landing.apps.bar.download" },
  { id: "office-faq", labelKey: "landing.apps.bar.faq" },
] as const;
const WORKS = [{ key: "open", icon: FolderOpen }, { key: "version", icon: RotateCcwClock }, { key: "share", icon: MessageSquare }] as const;

/**
 * THESIS: UniWork Office is the desktop office app of the UniWork Work OS.
 * OWN-WORLD: Be Vietnam Pro, neutral ground, restrained cyan/slate stage and real editor media.
 * STORY: Download the published trial, explore six editors and understand connected files and AI.
 * FIRST VIEWPORT: Centered promise and actions above one broad, six-tab product preview.
 * FORM: User-approved B (surface seed 62bbd639, structure 1) supersedes A; the user removes the redundant edition strip.
 */
export function OfficePage() {
  const { t } = useTranslation();
  const [active, setActive] = useState<OfficeEditorKey>("docs");
  return <MarketingShell className="office-site apps-site" closingTitle="landing.office.closing" closingAction={{ href: `${paths.apps.office()}#${OFFICE_EDITOR_ANCHOR}`, labelKey: "landing.office.hero.explore", icon: "arrow" }}>
    <AppBar app="office" sections={SECTIONS} cta={{ href: "#office-download", label: t("landing.office.hero.trial"), short: t("landing.apps.bar.short") }} />
    <div className="chapter-world office-world">
    <section id={OFFICE_BUSINESS_ANCHOR} className="office-hero chapter-width" aria-labelledby="office-title">
      <div className="office-hero-copy">
        <h1 id="office-title">{t("landing.office.hero.title")}</h1>
        <p className="office-sub">{t("landing.office.hero.sub")}</p>
        <div className="office-hero-actions">
          <MarketingAnchor href="#office-download" className={`${buttonVariants({ variant: "brand", size: "lg" })} office-trial-action`}><Download aria-hidden />{t("landing.office.hero.trial")}</MarketingAnchor>
          <Link href={paths.requestDemo()} className={`${buttonVariants({ variant: "outline", size: "lg" })} office-explore-action`}>{t("landing.demo.cta")}<ArrowRight aria-hidden /></Link>
        </div>
      </div>
      <div id={OFFICE_EDITOR_ANCHOR} className="office-hero-preview"><OfficeEditorTabs active={active} onActiveChange={setActive} /></div>
    </section>

    <OfficeConnection />

    <div id="office-faq" className="office-faq"><Faq namespace="landing.office.faq" count={6} title="landing.office.faq.title" className="bg-surface office-faq-section" /></div>

    <section id="office-download" className="office-section chapter-soft" aria-labelledby="office-download-title"><div className="chapter-width">
      <div className="office-heading"><h2 id="office-download-title">{t("landing.office.download.title")}</h2></div>
      <AppDownload app="office" copy="landing.office" />
    </div></section>

    <section className="office-section chapter-width" aria-labelledby="office-works-title">
      <div className="office-heading"><h2 id="office-works-title">{t("landing.office.works.title")}</h2><p>{t("landing.office.works.sub")}</p></div>
      <div className="office-works">{WORKS.map(({ key, icon: Icon }) => <article key={key}><Icon aria-hidden /><h3>{t(`landing.office.works.${key}.title`)}</h3><p>{t(`landing.office.works.${key}.description`)}</p></article>)}</div>
    </section>
    <OtherApps current="office" />
  </div></MarketingShell>;
}
