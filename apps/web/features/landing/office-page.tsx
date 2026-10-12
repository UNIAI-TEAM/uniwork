"use client";
import { ArrowDown, ArrowRight, FolderOpen, KeyRound, MessageSquare, RotateCcwClock, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { Faq } from "./faq";
import { MarketingShell } from "./marketing-shell";
import { OFFICE_EDITOR_ANCHOR, OFFICE_EDITOR_ICONS, OFFICE_TASKS, type OfficeEditorKey } from "./office-data";
import { OfficeDownloadColumns, OfficeHeroDownloads, useOfficeInstallers } from "./office-downloads";
import { OfficeEditorBlocks, OfficeEditorTabs, OfficeShot } from "./office-editors";
import "./marketing-chapters.css";
import "./office.css";

const TRUST = ["trustAccount", "trustAi", "trustOffline"] as const;
const WORKS = [{ key: "open", icon: FolderOpen }, { key: "version", icon: RotateCcwClock }, { key: "share", icon: MessageSquare }] as const;

/**
 * THESIS: UniWork Office is the desktop office app of the UniWork Work OS.
 * STORY: Download it, see the six editors, see what a task becomes, learn that AI and files follow
 * the UniWork account, read the answers, download again, then see how it works with UniWork.
 * FORM: Section order and arrangement follow the reference product page; every word and
 * every image is UniWork's own.
 */
export function OfficePage() {
  const { t } = useTranslation();
  const [active, setActive] = useState<OfficeEditorKey>("docs");
  const { status, version } = useOfficeInstallers();
  const openEditor = (editor: OfficeEditorKey) => {
    setActive(editor);
    document.getElementById(OFFICE_EDITOR_ANCHOR)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  return <MarketingShell closingTitle="landing.office.closing" closingDemoHref={`${paths.office()}#${OFFICE_EDITOR_ANCHOR}`}><div className="chapter-world office-world">
    <section className="office-hero chapter-width" aria-labelledby="office-title">
      <p className="office-kicker">{t("landing.office.hero.kicker")}</p>
      <h1 id="office-title">{t("landing.office.hero.title")}</h1>
      <p className="office-sub">{t("landing.office.hero.sub")}</p>
      <OfficeHeroDownloads />
      <a href={`#${OFFICE_EDITOR_ANCHOR}`} className="chapter-link">{t("landing.office.hero.demo")}<ArrowDown aria-hidden /></a>
      <ul className="office-trust">{TRUST.map((key) => <li key={key}><ShieldCheck aria-hidden />{t(`landing.office.hero.${key}`)}</li>)}</ul>
      <OfficeShot editor="docs" priority />
    </section>

    <section id={OFFICE_EDITOR_ANCHOR} className="office-section chapter-width" aria-labelledby="office-editors-title">
      <div className="office-heading"><h2 id="office-editors-title">{t("landing.office.editors.title")}</h2><p>{t("landing.office.editors.formats")}</p></div>
      <OfficeEditorTabs active={active} onActiveChange={setActive} />
      <OfficeEditorBlocks />
    </section>

    <section className="office-section chapter-soft" aria-labelledby="office-tasks-title"><div className="chapter-width">
      <div className="office-heading"><h2 id="office-tasks-title">{t("landing.office.tasks.title")}</h2><p>{t("landing.office.tasks.sub")}</p></div>
      <ol className="office-tasks">{OFFICE_TASKS.map(({ key, editor }, index) => {
        const Icon = OFFICE_EDITOR_ICONS[editor];
        return <li key={key} className="office-task">
          <span className="office-task-head"><Icon aria-hidden /><span className="office-task-number" aria-hidden>{String(index + 1).padStart(2, "0")}</span></span>
          <h3>{t(`landing.office.tasks.${key}.title`)}</h3>
          <p>{t(`landing.office.tasks.${key}.description`)}</p>
          <button type="button" className="chapter-link office-task-link" onClick={() => openEditor(editor)}>{t("landing.office.tasks.open", { editor: t(`landing.office.editors.${editor}.name`) })}<ArrowRight aria-hidden /></button>
        </li>;
      })}</ol>
    </div></section>

    <section className="office-section chapter-width" aria-labelledby="office-ai-title">
      <div className="office-heading"><h2 id="office-ai-title">{t("landing.office.ai.title")}</h2><p>{t("landing.office.ai.sub")}</p></div>
      <div className="office-ai-points">{(["account", "files"] as const).map((key, index) => <article key={key}>
        {index === 0 ? <KeyRound aria-hidden /> : <FolderOpen aria-hidden />}
        <h3>{t(`landing.office.ai.${key}.title`)}</h3><p>{t(`landing.office.ai.${key}.description`)}</p>
      </article>)}</div>
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
      <div className="marketing-actions"><Link href={paths.register()} className={buttonVariants({ variant: "brand", size: "lg" })}>{t("landing.cta.start")}<ArrowRight aria-hidden /></Link></div>
    </section>
  </div></MarketingShell>;
}
