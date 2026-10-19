"use client";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { MarketingAnchor, MarketingLink as Link } from "../../../platform/marketing-link";
import { Container } from "../layout-primitives";
import { AppIcon } from "./app-icon";

export interface AppBarSection { id: string; labelKey: string }

/** The section the reader is in: the one whose top passed 45% of the viewport most recently; the first at the very top. */
function useActiveSection(ids: readonly string[]): string | undefined {
  const [active, setActive] = useState(ids[0]);
  const key = ids.join(" ");
  useEffect(() => {
    const list = key.split(" ");
    let frame = 0;
    // A scroll check rather than an IntersectionObserver band: the band misses a section that never crosses it.
    const update = () => {
      frame = 0;
      const line = window.innerHeight * 0.45;
      // Geometry, not list order: a page may place its sections in another order than the bar names them.
      let best = { id: list[0], top: -Infinity };
      if (window.scrollY > 8) for (const id of list) {
        const top = document.getElementById(id)?.getBoundingClientRect().top;
        if (top !== undefined && top <= line && top > best.top) best = { id, top };
      }
      setActive(best.id);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule); };
  }, [key]);
  return active;
}

/**
 * The app pages' own bar (UNI-1913): "Apps › {app}", the page's sections and
 * the download action, sticky under the site header so the download is always
 * in reach. On a phone it folds to the app's name, which opens the sections.
 */
export function AppBar({ app, sections, cta }: { app: "office" | "unichat"; sections: readonly AppBarSection[]; cta: { href: string; label: string; short: string } }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const sheet = useId();
  const ids = sections.map((section) => section.id);
  const active = useActiveSection(ids);
  const name = t(`landing.apps.catalog.${app}.name`);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  const links = sections.map((section) => <MarketingAnchor key={section.id} href={`#${section.id}`} aria-current={active === section.id ? "true" : undefined} onClick={() => setOpen(false)}>{t(section.labelKey)}</MarketingAnchor>);
  return <div className="app-bar" data-app-bar={app}>
    <Container className="app-bar-inner">
      <nav className="app-bar-crumb" aria-label={t("landing.apps.bar.apps")}>
        <Link className="app-bar-root" href={paths.apps.root()}>{t("landing.apps.bar.apps")}</Link>
        <ChevronRight aria-hidden className="app-bar-sep" />
        <span className="app-bar-name" aria-current="page"><AppIcon app={app} size={24} />{name}</span>
      </nav>
      <button type="button" className="app-bar-toggle" aria-expanded={open} aria-controls={sheet} onClick={() => setOpen((value) => !value)}>
        <AppIcon app={app} size={24} />{name}<span className="sr-only">{t("landing.apps.bar.sections")}</span><ChevronDown aria-hidden />
      </button>
      <nav className="app-bar-links" aria-label={t("landing.apps.bar.label", { app: name })}>{links}</nav>
      <MarketingAnchor className={cn(buttonVariants({ variant: "brand", size: "lg" }), "app-bar-cta")} href={cta.href}>
        <Download aria-hidden /><span className="app-bar-cta-long">{cta.label}</span><span className="app-bar-cta-short">{cta.short}</span>
      </MarketingAnchor>
    </Container>
    {open && <nav id={sheet} className="app-bar-sheet" aria-label={t("landing.apps.bar.label", { app: name })}>
      <Link href={paths.apps.root()} onClick={() => setOpen(false)}>{t("landing.apps.bar.all")}<ChevronRight aria-hidden /></Link>
      {links}
    </nav>}
  </div>;
}
