"use client";
import { CircleAlert, Download, ExternalLink, Info, Monitor, RotateCcw, Smartphone } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { DESKTOP_INSTALLER_KINDS, type DesktopOS, type OfficeInstallerOption } from "@uniwork/core/office";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { MarketingLink as Link } from "../../../platform/marketing-link";
import { APP_CATALOG, otherPhone, PHONE_ORDER, type PhoneOS } from "./catalog";
import { useAppInstallers, useStoreLinks, type AppOsGroup, type StoreLink } from "./installers";
import { useVisitorDevice } from "./visitor-device";

type DownloadApp = "office" | "unichat";
/** The app's landing namespace: `installersError`, `retry`, `download.*` and, for UniChat, `mobile.*`. */
type DownloadCopy = "landing.office" | "landing.unichat";

type Featured =
  | { kind: "desktop"; group: AppOsGroup; own: boolean }
  | { kind: "phone"; link: StoreLink; own: boolean }
  | { kind: "missing"; os: DesktopOS | PhoneOS };

function osName(t: (key: string) => string, os: DesktopOS | PhoneOS): string {
  return os === "ios" || os === "android" ? t(`landing.apps.platform.${os}`) : t(`office.desktop.install.os.${os}`);
}

/** The visitor's platform leads; another platform leads only when the visitor's is unknown. */
function pickFeatured(groups: AppOsGroup[], phones: StoreLink[], phone: PhoneOS | null, desktop: DesktopOS | null): Featured | null {
  if (phone) {
    const link = phones.find((item) => item.os === phone);
    return link ? { kind: "phone", link, own: true } : { kind: "missing", os: phone };
  }
  if (desktop) {
    const group = groups.find((item) => item.os === desktop);
    return group ? { kind: "desktop", group, own: true } : { kind: "missing", os: desktop };
  }
  if (groups[0]) return { kind: "desktop", group: groups[0], own: false };
  return phones[0] ? { kind: "phone", link: phones[0], own: false } : null;
}

function Shell({ children, busy = false }: { children: ReactNode; busy?: boolean }) {
  return <div className="app-dl" aria-busy={busy || undefined}>{children}</div>;
}

function StoreButton({ link, primary }: { link: StoreLink; primary: boolean }) {
  const { t } = useTranslation();
  const store = t(`landing.apps.store.${link.label}`);
  return <a className={cn(buttonVariants({ variant: primary ? "brand" : "outline", size: "lg" }), "app-dl-button")} href={link.href} data-unichat-store={link.os}>
    {t("landing.apps.download.open", { store })}<ExternalLink aria-hidden />
  </a>;
}

function VariantButton({ installer, primary }: { installer: OfficeInstallerOption; primary: boolean }) {
  const { t } = useTranslation();
  return <a className={cn(buttonVariants({ variant: primary ? "brand" : "outline", size: "lg" }), "app-dl-button")} href={installer.url} download>
    <Download aria-hidden />{t(`office.desktop.install.fmt.${DESKTOP_INSTALLER_KINDS[installer.platform].format}`)}
  </a>;
}

function FeaturedCard({ featured, app, copy, version, certain, guessed }: { featured: Featured; app: DownloadApp; copy: DownloadCopy; version: string | undefined; certain: boolean; guessed: string | null }) {
  const { t } = useTranslation();
  const name = t(`landing.apps.catalog.${app}.name`);
  const own = featured.kind === "missing" || featured.own;
  const os = featured.kind === "desktop" ? featured.group.os : featured.kind === "phone" ? featured.link.os : featured.os;
  const phone = os === "ios" || os === "android";
  const Glyph = phone ? Smartphone : Monitor;
  let title = t("landing.apps.download.title", { app: name, os: osName(t, os) });
  let sub: string;
  let actions: ReactNode;
  let help: ReactNode = null;
  if (featured.kind === "desktop") {
    // A proven chip goes first; an unproven Mac keeps the published order and gets the hint.
    const installers = [...featured.group.installers].sort((a, b) => Number(certain && b.platform === guessed) - Number(certain && a.platform === guessed));
    const first = installers[0]!;
    const requirement = first.requirements ?? t(`office.desktop.install.req.${DESKTOP_INSTALLER_KINDS[first.platform].requirement}`);
    sub = [version ? t(`${copy}.download.version`, { version }) : null, t(`${copy}.download.requirements`, { value: requirement })].filter(Boolean).join(" · ");
    actions = installers.map((installer, index) => <VariantButton key={installer.platform} installer={installer} primary={index === 0} />);
    if (featured.group.os === "macos" && installers.length > 1 && !certain) help = <p className="app-dl-help">{t("landing.apps.download.macHelp")}</p>;
  } else if (featured.kind === "phone") {
    sub = t(featured.link.pilot ? "landing.apps.download.pilotSub" : "landing.apps.download.storeSub");
    actions = <StoreButton link={featured.link} primary />;
  } else {
    title = t("landing.apps.download.noBuild", { app: name, os: osName(t, os) });
    sub = phone && app === "office" ? t("landing.apps.catalog.office.phoneSub") : phone ? t(`${copy}.mobile.unavailable`) : t("landing.apps.download.webInstead");
    actions = <Link className={cn(buttonVariants({ variant: "outline", size: "lg" }), "app-dl-button")} href={paths.login()}>{t("landing.apps.download.openWeb")}</Link>;
  }
  return <section className={cn("app-dl-featured", featured.kind === "missing" && "is-missing")} aria-label={title} data-featured={os}>
    <div className="app-dl-featured-copy">
      <span className="app-dl-os" aria-hidden><Glyph /></span>
      <div>
        {own && <p className="app-dl-own">{t("landing.apps.download.device")}</p>}
        <h3>{title}</h3>
        <p className="app-dl-sub">{sub}</p>
      </div>
    </div>
    <div className="app-dl-actions"><div className="app-dl-buttons">{actions}</div>{help}</div>
  </section>;
}

/**
 * One download block for every app (UNI-1913): the visitor's own platform
 * leads as a card, every other published build follows as a chip, and each
 * state says truthfully what is and is not released. Links, versions and
 * requirements come from the public config only.
 */
export function AppDownload({ app, copy }: { app: DownloadApp; copy: DownloadCopy }) {
  const { t } = useTranslation();
  const entry = APP_CATALOG.find((item) => item.key === app)!;
  const device = useVisitorDevice();
  const { status, groups, version, guess, retry, retrying } = useAppInstallers(entry.installers);
  const stores = useStoreLinks(entry.stores);
  if (status === "loading") {
    return <Shell busy><div className="app-dl-featured is-skeleton" aria-hidden /><div className="app-dl-chips" aria-hidden>{[0, 1, 2, 3].map((n) => <span key={n} className="app-dl-chip is-skeleton" />)}</div></Shell>;
  }
  if (status === "error") {
    return <Shell><div className="app-dl-message" role="alert">
      <span className="app-dl-message-icon is-error" aria-hidden><CircleAlert /></span>
      <p>{t(`${copy}.installersError`)}</p>
      <Button type="button" variant="outline" size="lg" aria-disabled={retrying} onClick={() => { if (!retrying) retry(); }}><RotateCcw aria-hidden />{t(`${copy}.retry`)}</Button>
    </div></Shell>;
  }
  const phones = (device.phone ? [device.phone, otherPhone(device.phone)] : PHONE_ORDER).flatMap((os) => (stores[os] ? [stores[os]] : []));
  if (groups.length === 0 && phones.length === 0) {
    return <Shell><div className="app-dl-message" role="status">
      <span className="app-dl-message-icon" aria-hidden><Info /></span>
      <p>{t(`${copy}.download.unavailable`)}</p>
      {entry.stores && <p>{t(`${copy}.mobile.unavailable`)}</p>}
      <Link className={cn(buttonVariants({ variant: "outline", size: "lg" }), "app-dl-button")} href={paths.login()}>{t(app === "unichat" ? "landing.unichat.hero.web" : "landing.apps.download.openWeb")}</Link>
    </div></Shell>;
  }
  const featured = pickFeatured(groups, phones, device.phone, device.desktop);
  const desktopChips = groups.filter((group) => !(featured?.kind === "desktop" && featured.group === group));
  const phoneChips = phones.filter((link) => !(featured?.kind === "phone" && featured.link === link));
  const desktopChipNodes = desktopChips.flatMap(({ os, installers }) => installers.map((installer) => <a key={installer.platform} className="app-dl-chip" href={installer.url} download data-office-os={os}>
    <Monitor aria-hidden /><strong>{osName(t, os)}</strong><span>{t(`office.desktop.install.fmt.${DESKTOP_INSTALLER_KINDS[installer.platform].format}`)}</span>
  </a>));
  const phoneChipNodes = phoneChips.map((link) => <a key={link.os} className="app-dl-chip" href={link.href} data-unichat-store={link.os}>
    <Smartphone aria-hidden /><strong>{osName(t, link.os)}</strong><span>{t(`landing.apps.store.${link.label}`)}</span>{link.pilot && <em className="app-tag is-pilot">{t("landing.apps.status.pilot")}</em>}
  </a>);
  const unsigned = groups.some((group) => group.installers.some((installer) => installer.unsigned));
  const pilot = phones.some((link) => link.pilot);
  const chips = device.phone ? [...phoneChipNodes, ...desktopChipNodes] : [...desktopChipNodes, ...phoneChipNodes];
  return <Shell>
    {featured && <FeaturedCard featured={featured} app={app} copy={copy} version={version} certain={guess.confidence === "certain"} guessed={guess.platform} />}
    {chips.length > 0 && <div className="app-dl-chips" role="group" aria-label={t("landing.apps.download.others")}>{chips}</div>}
    {(unsigned || pilot) && <div className="app-dl-notes">
      {unsigned && <p className="app-dl-note"><Info aria-hidden /><span>{t(`${copy}.download.unsigned`)}</span></p>}
      {pilot && <p className="app-dl-note"><Smartphone aria-hidden /><span>{t("landing.apps.download.phonePilot")}</span></p>}
    </div>}
  </Shell>;
}
