"use client";
import { ArrowRight, BellRing, Download, FolderKanban, Phone, Smartphone, SquareCheckBig } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { usePublicConfig } from "@uniwork/core/feature-flags";
import { paths } from "@uniwork/core/paths";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { MarketingAnchor, MarketingLink as Link } from "../../platform/marketing-link";
import { AppDownloadColumns, useAppInstallers } from "./app-downloads";
import { Faq } from "./faq";
import { MarketingShell } from "./marketing-shell";
import "./marketing-chapters.css";
import "./office.css";
import "./unichat.css";

const POINTS = [{ key: "task", icon: SquareCheckBig }, { key: "project", icon: FolderKanban }, { key: "followUp", icon: BellRing }, { key: "call", icon: Phone }] as const;

type PhoneOS = "ios" | "android";
// The public store page wins; the pilot link is offered only while there is none.
const STORE_LINKS = {
  ios: [{ key: "ios", label: "appStore" }, { key: "testflight", label: "testflight" }],
  android: [{ key: "android", label: "googlePlay" }, { key: "play_internal", label: "playInternal" }],
} as const;

/** The phone's own store, or null off a phone. iPadOS that reports a Mac stays null. */
function phoneOf(userAgent: string): PhoneOS | null {
  return /\b(?:iphone|ipad|ipod)\b/i.test(userAgent) ? "ios" : /\bandroid\b/i.test(userAgent) ? "android" : null;
}
const noSubscription = () => () => {};
/** Read after hydration only: the server renders the desktop-first order. */
function useVisitorPhone(): PhoneOS | null {
  return useSyncExternalStore(noSubscription, () => phoneOf(navigator.userAgent), () => null);
}

/** Mobile store columns from the public config; nothing configured reads "not released". */
function StoreColumns({ phone }: { phone: PhoneOS | null }) {
  const { t } = useTranslation();
  const config = usePublicConfig().data;
  // Loading and errors are shown once, by the desktop block on the same query.
  if (!config) return null;
  const stores = config.unichat_stores;
  const columns = (phone === "android" ? ["android", "ios"] as const : ["ios", "android"] as const).flatMap((os) => {
    const link = STORE_LINKS[os].find(({ key }) => stores?.[key]);
    return link && stores ? [{ os, href: stores[link.key], label: link.label, pilot: link.key !== os }] : [];
  });
  if (columns.length === 0) return <div className="office-download-columns"><p className="office-unavailable" role="status">{t("landing.unichat.mobile.unavailable")}</p></div>;
  return <div className="office-download-columns">{columns.map(({ os, href, label, pilot }) => <section className="office-download-column" key={os} data-unichat-store={os} aria-label={t(`landing.unichat.mobile.${os}`)}>
    <h3><Smartphone aria-hidden />{t(`landing.unichat.mobile.${os}`)}</h3>
    <ul><li><a className={buttonVariants({ variant: "outline", size: "lg" })} href={href}>{t(`landing.unichat.mobile.${label}`)}</a></li></ul>
    {pilot && <small>{t("landing.unichat.mobile.pilot")}</small>}
  </section>)}</div>;
}

/**
 * THESIS: UniChat is the UniWork workspace chat in its own desktop and phone app.
 * STORY: what chat does for the work, then the published downloads, then the questions.
 * No product imagery: there are no real screenshots of the apps yet; the chat page shows the real UI.
 */
export function UniChatPage() {
  const { t } = useTranslation();
  const { status, version } = useAppInstallers("unichat_installers");
  const phone = useVisitorPhone();
  const desktop = <AppDownloadColumns key="desktop" catalogue="unichat_installers" copy="landing.unichat" visitorFirst />;
  const mobile = <StoreColumns key="mobile" phone={phone} />;
  return <MarketingShell className="office-site" closingTitle="landing.unichat.closing" closingAction={{ href: `${paths.unichat()}#unichat-download`, labelKey: "landing.unichat.hero.download", icon: "arrow" }}><div className="chapter-world office-world">
    <section className="office-hero chapter-width" aria-labelledby="unichat-title">
      <div className="office-hero-copy">
        <h1 id="unichat-title">{t("landing.unichat.hero.title")}</h1>
        <p className="office-sub">{t("landing.unichat.hero.sub")}</p>
        <div className="office-hero-actions">
          <MarketingAnchor href="#unichat-download" className={buttonVariants({ variant: "brand", size: "lg" })}><Download aria-hidden />{t("landing.unichat.hero.download")}</MarketingAnchor>
          <Link href={paths.requestDemo()} className={`${buttonVariants({ variant: "outline", size: "lg" })} office-explore-action`}>{t("landing.demo.cta")}<ArrowRight aria-hidden /></Link>
        </div>
      </div>
    </section>

    <section className="office-section chapter-width" aria-labelledby="unichat-points-title">
      <div className="office-heading"><h2 id="unichat-points-title">{t("landing.unichat.points.title")}</h2><p>{t("landing.unichat.points.sub")}</p></div>
      <div className="office-works unichat-points">{POINTS.map(({ key, icon: Icon }) => <article key={key}><Icon aria-hidden /><h3>{t(`landing.unichat.points.${key}.title`)}</h3><p>{t(`landing.unichat.points.${key}.description`)}</p></article>)}</div>
      <div className="unichat-links">
        <Link className="chapter-link" href={paths.feature("chat")}>{t("landing.unichat.points.preview")}<ArrowRight aria-hidden /></Link>
        <Link className="chapter-link" href={paths.security()}>{t("landing.unichat.security")}<ArrowRight aria-hidden /></Link>
      </div>
    </section>

    <section id="unichat-download" className="office-section chapter-soft" aria-labelledby="unichat-download-title"><div className="chapter-width">
      <div className="office-heading"><h2 id="unichat-download-title">{t("landing.unichat.download.title")}</h2>{status === "ready" && version && <p>{t("landing.unichat.download.version", { version })}</p>}</div>
      {phone ? [mobile, desktop] : [desktop, mobile]}
    </div></section>

    <div className="office-faq"><Faq namespace="landing.unichat.faq" count={4} title="landing.unichat.faq.title" className="bg-surface office-faq-section" /></div>
  </div></MarketingShell>;
}
