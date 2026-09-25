"use client";
import { ArrowRight, ChevronDown, Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { LocaleMenu, ThemeMenu } from "@uniwork/views/layout/preference-menus";
import { Logo } from "@uniwork/ui/brand";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { ScrollTrigger, useGSAP } from "./animation/register-gsap";
import { Container } from "./layout-primitives";
import { HeaderDirectory, type HeaderDirectoryKey } from "./header-directory";
import "./landing-opening.css";
import "./header-directory.css";

const GROUPS = [
  { key: "products", label: "landing.productPages.product" },
  { key: "solutions", label: "landing.nav.solutions" },
  { key: "learn", label: "landing.productPages.learn" },
] as const;
const LINKS = [
  { label: "landing.workforce.badge", to: paths.feature("agents") },
  { label: "landing.footer.pricing", to: paths.pricing() },
  { label: "landing.productPages.enterprise", to: paths.enterprise() },
] as const;

export function SiteHeader() {
  const { t } = useTranslation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [directory, setDirectory] = useState<HeaderDirectoryKey | null>(null);
  const header = useRef<HTMLElement>(null);
  const mobileButton = useRef<HTMLButtonElement>(null);
  const groupButtons = useRef<Partial<Record<HeaderDirectoryKey, HTMLButtonElement | null>>>({});
  const close = () => { setMobileOpen(false); setDirectory(null); };
  useEffect(() => {
    if (!mobileOpen && !directory) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (directory) { groupButtons.current[directory]?.focus(); setDirectory(null); }
      else { mobileButton.current?.focus(); setMobileOpen(false); }
    };
    const outside = (event: PointerEvent) => {
      if (!header.current?.contains(event.target as Node)) { setMobileOpen(false); setDirectory(null); }
    };
    window.addEventListener("keydown", keydown);
    window.addEventListener("pointerdown", outside);
    return () => { window.removeEventListener("keydown", keydown); window.removeEventListener("pointerdown", outside); };
  }, [mobileOpen, directory]);
  useEffect(() => {
    const desktop = matchMedia("(min-width: 1200px)");
    const dismiss = () => { setMobileOpen(false); setDirectory(null); };
    desktop.addEventListener("change", dismiss);
    return () => desktop.removeEventListener("change", dismiss);
  }, []);
  useGSAP(() => {
    if (header.current) ScrollTrigger.create({ start: 24, end: () => ScrollTrigger.maxScroll(window) + innerHeight, toggleClass: { targets: header.current, className: "is-scrolled" } });
  }, { scope: header });
  return <header ref={header} className="site-header fixed inset-x-0 top-0 z-50" onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) close(); }}>
    <Container className="header-shell">
      <Link href={paths.root()} className="header-logo" aria-label="UniWork"><Logo variant="lockup" size={26} /></Link>
      <nav className="header-navigation" aria-label={t("landing.nav.main")}>
        {GROUPS.map(item => <div className="header-nav-item" key={item.key}><button ref={node => { groupButtons.current[item.key] = node; }} className="header-nav-link header-directory-toggle" type="button" aria-expanded={directory === item.key} aria-controls={`header-directory-${item.key}`} onClick={() => setDirectory(current => current === item.key ? null : item.key)} onKeyDown={event => {
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          setDirectory(item.key);
          requestAnimationFrame(() => header.current?.querySelector<HTMLAnchorElement>(`#header-directory-${item.key} a`)?.focus());
        }}>{t(item.label)}<ChevronDown aria-hidden /></button></div>)}
        {LINKS.map(item => <Link key={item.to} className="header-nav-link" href={item.to} onClick={close}>{t(item.label)}</Link>)}
      </nav>
      <div className="header-actions">
        <div className="header-preferences"><ThemeMenu size="icon-lg" /><LocaleMenu size="icon-lg" /></div>
        <Link href={paths.login()} className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "header-login")}>{t("landing.nav.login")}</Link>
        <Link href={paths.register()} className={cn(buttonVariants({ variant: "brand", size: "lg" }), "header-start")}>{t("landing.cta.start")}<ArrowRight aria-hidden /></Link>
        <Button ref={mobileButton} className="header-mobile-toggle" variant="ghost" size="icon-lg" aria-label={t(mobileOpen ? "landing.nav.closeMenu" : "landing.nav.openMenu")} aria-expanded={mobileOpen} aria-controls="landing-mobile-menu" onClick={() => setMobileOpen(current => !current)}>{mobileOpen ? <X aria-hidden /> : <Menu aria-hidden />}</Button>
      </div>
    </Container>
    {directory && <div id={`header-directory-${directory}`} className="header-directory"><HeaderDirectory kind={directory} onNavigate={close} /></div>}
    {mobileOpen && <nav id="landing-mobile-menu" className="header-mobile-menu" aria-label={t("landing.nav.main")}>
      {GROUPS.map(group => <details key={group.key}><summary>{t(group.label)}<ChevronDown aria-hidden /></summary><HeaderDirectory kind={group.key} onNavigate={close} /></details>)}
      {LINKS.map(item => <Link className="mobile-route-link" key={item.to} href={item.to} onClick={close}>{t(item.label)}<ArrowRight aria-hidden /></Link>)}
      <Link className="mobile-route-link" href={paths.login()} onClick={close}>{t("landing.nav.login")}</Link>
      <Link href={paths.register()} onClick={close} className={cn(buttonVariants({ variant: "brand", size: "lg" }), "mobile-start")}>{t("landing.cta.start")}</Link>
    </nav>}
  </header>;
}
