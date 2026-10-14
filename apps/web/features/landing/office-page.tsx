"use client";
import { ArrowRight, Download, FolderOpen, KeyRound, MessageSquare, RotateCcwClock, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { Faq } from "./faq";
import { MarketingShell } from "./marketing-shell";
import { OFFICE_BUSINESS_ANCHOR, OFFICE_EDITOR_ANCHOR, OFFICE_EDITOR_ICONS, OFFICE_TASKS, type OfficeEditorKey } from "./office-data";
import { OfficeDownloadColumns, useOfficeInstallers } from "./office-downloads";
import { OfficeEditorSummary, OfficeEditorTabs } from "./office-editors";
import "./marketing-chapters.css";
import "./office.css";

const TRUST = ["trustAccount", "trustAi", "trustOffline"] as const;
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
  const { status, version } = useOfficeInstallers();
  const openEditor = (editor: OfficeEditorKey) => {
    setActive(editor);
    document.getElementById(OFFICE_EDITOR_ANCHOR)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  return <MarketingShell className="office-site" closingTitle="landing.office.closing" closingAction={{ href: `${paths.office()}#${OFFICE_EDITOR_ANCHOR}`, labelKey: "landing.office.hero.explore", icon: "arrow" }}><div className="chapter-world office-world">
    <section id={OFFICE_BUSINESS_ANCHOR} className="office-hero chapter-width" aria-labelledby="office-title">
      <div className="office-hero-copy">
        <h1 id="office-title">{t("landing.office.hero.title")}</h1>
        <p className="office-sub">{t("landing.office.hero.sub")}</p>
        <div className="office-hero-actions">
          <a href="#office-download" className={`${buttonVariants({ variant: "brand", size: "lg" })} office-trial-action`}><Download aria-hidden />{t("landing.office.hero.trial")}</a>
          <Link href={paths.requestDemo()} className={`${buttonVariants({ variant: "outline", size: "lg" })} office-explore-action`}>{t("landing.demo.cta")}<ArrowRight aria-hidden /></Link>
        </div>
      </div>
      <div id={OFFICE_EDITOR_ANCHOR} className="office-hero-preview"><OfficeEditorTabs active={active} onActiveChange={setActive} /></div>
    </section>

    <section id="office-editor-details" className="chapter-width" aria-labelledby="office-editor-summary-title">
      <OfficeEditorSummary editor={active} />
    </section>

    <section className="office-section chapter-soft" aria-labelledby="office-tasks-title"><div className="chapter-width">
      <div className="office-heading"><h2 id="office-tasks-title">{t("landing.office.tasks.title")}</h2><p>{t("landing.office.tasks.sub")}</p></div>
      <ul className="office-tasks">{OFFICE_TASKS.map(({ key, editor }) => {
        const Icon = OFFICE_EDITOR_ICONS[editor];
        return <li key={key} className="office-task">
          <span className="office-task-head"><Icon aria-hidden /></span>
          <h3>{t(`landing.office.tasks.${key}.title`)}</h3>
          <p>{t(`landing.office.tasks.${key}.description`)}</p>
          <button type="button" className="chapter-link office-task-link" onClick={() => openEditor(editor)}>{t("landing.office.tasks.open", { editor: t(`landing.office.editors.${editor}.name`) })}<ArrowRight aria-hidden /></button>
        </li>;
      })}</ul>
    </div></section>

    <section className="office-section chapter-width" aria-labelledby="office-ai-title">
      <div className="office-heading"><h2 id="office-ai-title">{t("landing.office.ai.title")}</h2><p>{t("landing.office.ai.sub")}</p></div>
      <div className="office-ai-points">{(["account", "files"] as const).map((key, index) => <article key={key}>
        {index === 0 ? <KeyRound aria-hidden /> : <FolderOpen aria-hidden />}
        <h3>{t(`landing.office.ai.${key}.title`)}</h3><p>{t(`landing.office.ai.${key}.description`)}</p>
      </article>)}</div>
      <ul className="office-trust">{TRUST.map((key) => <li key={key}><ShieldCheck aria-hidden />{t(`landing.office.hero.${key}`)}</li>)}</ul>
      <Link className="chapter-link" href={paths.enterprise()}>{t("landing.office.ai.link")}<ArrowRight aria-hidden /></Link>
    </section>

    <div className="office-faq"><Faq namespace="landing.office.faq" count={6} title="landing.office.faq.title" className="bg-surface office-faq-section" /></div>

    <section id="office-download" className="office-section chapter-soft" aria-labelledby="office-download-title"><div className="chapter-width">
      <div className="office-heading"><h2 id="office-download-title">{t("landing.office.download.title")}</h2>{status === "ready" && version && <p>{t("landing.office.download.version", { version })}</p>}</div>
      <OfficeDownloadColumns />
    </div></section>

    <section className="office-section chapter-width" aria-labelledby="office-works-title">
      <div className="office-heading"><h2 id="office-works-title">{t("landing.office.works.title")}</h2><p>{t("landing.office.works.sub")}</p></div>
      <div className="office-works">{WORKS.map(({ key, icon: Icon }) => <article key={key}><Icon aria-hidden /><h3>{t(`landing.office.works.${key}.title`)}</h3><p>{t(`landing.office.works.${key}.description`)}</p></article>)}</div>
    </section>
  </div></MarketingShell>;
}
