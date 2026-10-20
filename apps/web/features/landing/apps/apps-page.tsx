"use client";
import { ArrowRight, Check, Database, Download, LayoutDashboard, Lock, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { MarketingAnchor, MarketingLink as Link } from "../../../platform/marketing-link";
import { Container } from "../layout-primitives";
import { MarketingShell } from "../marketing-shell";
import { AppIcon } from "./app-icon";
import { AppClosing, AppFaq, AppPill } from "./app-sections";
import { APP_CATALOG, PHONE_ORDER, type AppEntry } from "./catalog";
import { DownloadMatrix, PhoneDownloads } from "./hub-downloads";
import { useStoreLinks } from "./installers";
import { useVisitorDevice, type VisitorDevice } from "./visitor-device";
import "./apps.css";
import "./hub.css";

const DOWNLOAD = "#apps-download";
const BASE = [[Lock, "account"], [LayoutDashboard, "workspace"], [ShieldCheck, "permissions"], [Database, "data"]] as const;

function AppCard({ app, device, pilot }: { app: AppEntry; device: VisitorDevice; pilot: boolean }) {
  const { t } = useTranslation();
  const k = (key: string) => t(`landing.apps.catalog.${app.key}.${key}`);
  const own = device.phone ?? device.desktop;
  const download = own ? t("landing.apps.downloadFor", { os: t(`landing.apps.platform.${own}`) }) : t("landing.apps.bar.download");
  const button = (variant: "brand" | "outline") => cn(buttonVariants({ variant }), "hub-card-action");
  // Office does not install on a phone: there the card explains it and opens the web instead.
  const actions = app.key === "web"
    ? [<Link key="open" className={button("outline")} href={paths.login()}>{k("open")}</Link>, <Link key="more" className={button("outline")} href={paths.features()}>{k("more")}</Link>]
    : app.key === "office" && device.phone
      ? [<Link key="learn" className={button("brand")} href={app.href}>{t("landing.apps.learn")}</Link>, <Link key="web" className={button("outline")} href={paths.login()}>{t("landing.apps.download.openWeb")}</Link>]
      : [<Link key="get" className={button("brand")} href={`${app.href}#${app.key}-download`}>{download}</Link>, <Link key="learn" className={button("outline")} href={app.href}>{t("landing.apps.learn")}</Link>];
  const platforms = app.installers ? [...app.desktops, ...(app.stores ? PHONE_ORDER : [])] : (["web"] as const);
  return <article className="hub-card" aria-labelledby={`hub-${app.key}`} data-app={app.key}>
    <div className="hub-card-top"><AppIcon app={app.key} size={56} /><span className="hub-kicker">{k("kicker")}</span></div>
    <div className="hub-card-copy"><h3 id={`hub-${app.key}`}>{k("name")}</h3><p>{k("tagline")}</p></div>
    <ul className="hub-points">{["point1", "point2"].map((point) => <li key={point}><Check aria-hidden /><span>{k(point)}</span></li>)}</ul>
    <ul className="hub-platforms">{platforms.map((os) => <li key={os}>{t(`landing.apps.platform.${os}`)}</li>)}</ul>
    {app.key === "office" && <p className="hub-card-note"><em className="app-tag is-dev">{t("landing.apps.status.development")}</em>{t("landing.apps.catalog.personal.name")}</p>}
    {app.key === "unichat" && pilot && <p className="hub-card-note"><em className="app-tag is-pilot">{t("landing.apps.status.pilot")}</em>{k("pilot")}</p>}
    <div className="hub-card-actions">{actions}</div>
  </article>;
}

/**
 * THESIS: one UniWork account, every place a team works.
 * STORY: the apps side by side on the shared base, then every build in one
 * table (a phone sees what installs on it), then the questions (UNI-1913;
 * the approved canvas is the reference). Builds come from the public config only.
 */
export function AppsPage() {
  const { t } = useTranslation();
  const device = useVisitorDevice();
  const stores = Object.values(useStoreLinks(true));
  const pilot = stores.length > 0 && stores.every((link) => link.pilot);
  const own = device.phone ?? device.desktop;
  const os = own ? t(`landing.apps.platform.${own}`) : null;
  return <MarketingShell className="apps-site hub-site" showClosing={false}>
    <section className="hub-hero" aria-labelledby="apps-title">
      <Container className="hub-hero-inner">
        <div className="hub-trio" aria-hidden>{APP_CATALOG.map((app) => <AppIcon key={app.key} app={app.key} size={72} />)}</div>
        <AppPill>{t("landing.apps.hub.eyebrow")}</AppPill>
        <h1 id="apps-title" className="hub-title">{t("landing.apps.hub.title1")}<br />{t("landing.apps.hub.title2")}</h1>
        <p className="app-lead">{t("landing.apps.hub.sub")}</p>
        <div className="app-actions">
          <MarketingAnchor className={cn(buttonVariants({ variant: "brand", size: "lg" }))} href={DOWNLOAD}><Download aria-hidden />{os ? t("landing.apps.hub.cta", { os }) : t("landing.apps.hub.ctaAny")}</MarketingAnchor>
          <Link className={cn(buttonVariants({ variant: "outline", size: "lg" }))} href={paths.login()}>{t("landing.apps.hub.web")}<ArrowRight aria-hidden /></Link>
        </div>
      </Container>
    </section>
    <section className="app-section" aria-labelledby="hub-cards-title">
      <Container>
        <div className="app-section-head"><AppPill>{`01 · ${t("landing.apps.hub.cardsEyebrow")}`}</AppPill><h2 id="hub-cards-title" className="app-h2">{t("landing.apps.hub.cardsTitle")}</h2></div>
        <div className="hub-cards">{APP_CATALOG.map((app) => <AppCard key={app.key} app={app} device={device} pilot={pilot} />)}</div>
        <div className="hub-wires" aria-hidden>{APP_CATALOG.map((app) => <span key={app.key} />)}</div>
        <div className="hub-base">
          <div className="hub-base-title"><b>{t("landing.apps.base.title")}</b><span>{t("landing.apps.base.sub")}</span></div>
          <ul className="hub-base-items">{BASE.map(([Icon, key]) => <li key={key}><Icon aria-hidden />{t(`landing.apps.base.${key}`)}</li>)}</ul>
        </div>
      </Container>
    </section>
    <section id="apps-download" className="app-section app-download-band" aria-labelledby="apps-download-title">
      <Container>
        <div className="app-download-head">
          <div className="app-section-head"><AppPill>{`02 · ${t("landing.apps.hub.downloadEyebrow")}`}</AppPill><h2 id="apps-download-title" className="app-h2">{device.phone && os ? t("landing.apps.hub.phoneTitle", { os }) : t("landing.apps.hub.downloadTitle")}</h2></div>
          {os && <span className="hub-me"><Check aria-hidden />{t("landing.apps.hub.device", { os })}</span>}
        </div>
        {device.phone ? <PhoneDownloads phone={device.phone} /> : <DownloadMatrix own={device.desktop} />}
      </Container>
    </section>
    <AppFaq id="apps-faq" namespace="landing.apps.hub.faq" count={4} eyebrow={`03 · ${t("landing.apps.hub.faq.eyebrow")}`} title={t("landing.apps.hub.faq.title")} />
    <AppClosing line1={t("landing.apps.hub.closing1")} line2={t("landing.apps.hub.closing2")}
      primary={{ href: paths.login(), label: t("landing.apps.hub.open") }} secondary={{ href: DOWNLOAD, label: t("landing.apps.hub.downloads") }} />
  </MarketingShell>;
}
