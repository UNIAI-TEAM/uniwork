"use client";
import { ArrowRight, ChevronDown, CircleAlert, Download, ExternalLink, Info, RotateCcw, Smartphone } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { DESKTOP_INSTALLER_KINDS, type DesktopOS, type OfficeInstallerOption } from "@uniwork/core/office";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { MarketingLink as Link } from "../../../platform/marketing-link";
import { AppIcon } from "./app-icon";
import { APP_CATALOG, DESKTOP_ORDER, otherPhone, PHONE_ORDER, type AppEntry, type PhoneOS } from "./catalog";
import { useAppInstallers, useStoreLinks, type StoreLink } from "./installers";

const COLUMNS = [...DESKTOP_ORDER, ...PHONE_ORDER] as const;
const INSTALLABLE = APP_CATALOG.filter((app) => app.installers);

/** "Apple Silicon · .dmg" reads as the variant beside its file type. */
function Variant({ installer }: { installer: OfficeInstallerOption }) {
  const { t } = useTranslation();
  const [name, ext] = t(`office.desktop.install.fmt.${DESKTOP_INSTALLER_KINDS[installer.platform].format}`).split(" · ");
  return <a className="hub-cell-link" href={installer.url} download><Download aria-hidden />{name}{ext && <small>{ext}</small>}</a>;
}

function StoreCell({ link }: { link: StoreLink }) {
  const { t } = useTranslation();
  return <span className="hub-cell">
    <a className="hub-cell-link" href={link.href} data-unichat-store={link.os}>{t(`landing.apps.store.${link.label}`)}</a>
    {link.pilot && <em className="app-tag is-pilot">{t("landing.apps.status.pilot")}</em>}
  </span>;
}

function Empty() {
  const { t } = useTranslation();
  return <><span className="hub-none" aria-hidden>—</span><span className="sr-only">{t("landing.apps.hub.matrix.none")}</span></>;
}

function MatrixRow({ app, own, stores }: { app: AppEntry; own: DesktopOS | null; stores: Partial<Record<PhoneOS, StoreLink>> }) {
  const { t } = useTranslation();
  const { status, groups } = useAppInstallers(app.installers);
  const cell = (os: (typeof COLUMNS)[number]) => {
    if (status !== "ready") return <span className="hub-skeleton" aria-hidden />;
    if (os === "ios" || os === "android") return app.stores && stores[os] ? <StoreCell link={stores[os]} /> : <Empty />;
    const group = groups.find((item) => item.os === os);
    return group ? <span className="hub-cell">{group.installers.map((installer) => <Variant key={installer.platform} installer={installer} />)}</span> : <Empty />;
  };
  return <tr data-app={app.key}>
    <th scope="row"><span className="hub-row-h"><AppIcon app={app.key} size={32} />{t(`landing.apps.catalog.${app.key}.name`)}</span></th>
    {COLUMNS.map((os) => <td key={os} className={cn(os === own && "is-own")}>{cell(os)}</td>)}
    <td><span className="hub-inweb">{t(app.key === "office" ? "landing.apps.hub.matrix.officeWeb" : "landing.apps.hub.matrix.chatWeb")}</span></td>
  </tr>;
}

/** Takes the parent's retry: a fresh observer mounting here would refetch on its own and hide the failure. */
function LoadError({ retry, retrying }: { retry: () => void; retrying: boolean }) {
  const { t } = useTranslation();
  return <div className="app-dl-message hub-error" role="alert">
    <span className="app-dl-message-icon is-error" aria-hidden><CircleAlert /></span>
    <p>{t("landing.apps.download.error")}</p>
    <Button type="button" variant="outline" size="lg" aria-disabled={retrying} onClick={() => { if (!retrying) retry(); }}><RotateCcw aria-hidden />{t("landing.apps.download.retry")}</Button>
  </div>;
}

function PilotNote({ stores }: { stores: Partial<Record<PhoneOS, StoreLink>> }) {
  const { t } = useTranslation();
  if (!Object.values(stores).some((link) => link.pilot)) return null;
  return <p className="hub-note"><Smartphone aria-hidden /><span>{t("landing.apps.hub.pilotNote")}</span></p>;
}

/** Every app against every system, the visitor's column tinted; links come from the public config only. */
export function DownloadMatrix({ own }: { own: DesktopOS | null }) {
  const { t } = useTranslation();
  const { status, retry, retrying } = useAppInstallers(INSTALLABLE[0]!.installers);
  const stores = useStoreLinks(true);
  if (status === "error") return <LoadError retry={retry} retrying={retrying} />;
  return <>
    <div className="hub-table-box" aria-busy={status === "loading" || undefined}>
      <table className="hub-table">
        <caption className="sr-only">{t("landing.apps.hub.matrix.caption")}</caption>
        <thead><tr>
          <th scope="col">{t("landing.apps.hub.matrix.app")}</th>
          {COLUMNS.map((os) => <th key={os} scope="col" className={cn(os === own && "is-own")}>{t(`landing.apps.platform.${os}`)}</th>)}
          <th scope="col">{t("landing.apps.hub.matrix.web")}</th>
        </tr></thead>
        <tbody>
          <tr data-app="web">
            <th scope="row"><span className="hub-row-h"><AppIcon app="web" size={32} />{t("landing.apps.catalog.web.short")}</span></th>
            <td colSpan={COLUMNS.length}><span className="hub-span">{t("landing.apps.hub.matrix.webOnly")}</span></td>
            <td><Link className="hub-cell-link" href={paths.login()}>{t("landing.apps.catalog.web.open")}<ArrowRight aria-hidden /></Link></td>
          </tr>
          {INSTALLABLE.map((app) => <MatrixRow key={app.key} app={app} own={own} stores={stores} />)}
        </tbody>
      </table>
    </div>
    <div className="hub-notes">
      <p className="hub-note"><Info aria-hidden /><span>{t("landing.apps.hub.note")}</span></p>
      <PilotNote stores={stores} />
    </div>
  </>;
}

function DesktopGroup({ app, phone, stores }: { app: AppEntry; phone: PhoneOS; stores: Partial<Record<PhoneOS, StoreLink>> }) {
  const { t } = useTranslation();
  const { groups } = useAppInstallers(app.installers);
  const other = app.stores ? stores[otherPhone(phone)] : undefined;
  if (groups.length === 0 && !other) return null;
  return <div className="hub-desk-group">
    <b>{t(`landing.apps.catalog.${app.key}.name`)}</b>
    <ul>
      {groups.flatMap(({ os, installers }) => installers.map((installer) => <li key={installer.platform}><a href={installer.url} download data-office-os={os}>{t(`landing.apps.platform.${os}`)}<small>{t(`office.desktop.install.fmt.${DESKTOP_INSTALLER_KINDS[installer.platform].format}`)}</small></a></li>))}
      {other && <li><a href={other.href} data-unichat-store={other.os}>{t(`landing.apps.platform.${other.os}`)}<small>{t(`landing.apps.store.${other.label}`)}</small></a></li>}
    </ul>
  </div>;
}

/**
 * On a phone the table gives way to what installs here: UniChat from its
 * store, UniWork in the browser, Office's answer for phones; the desktop
 * builds stay one tap away.
 */
export function PhoneDownloads({ phone }: { phone: PhoneOS }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const list = useId();
  const { status, retry, retrying } = useAppInstallers(INSTALLABLE[0]!.installers);
  const stores = useStoreLinks(true);
  if (status === "error") return <LoadError retry={retry} retrying={retrying} />;
  const link = stores[phone];
  return <div className="hub-phone" aria-busy={status === "loading" || undefined}>
    <div className="hub-phone-row">
      <div className="hub-phone-head"><AppIcon app="unichat" size={40} /><div><b>{t("landing.apps.catalog.unichat.name")}{link?.pilot && <em className="app-tag is-pilot">{t("landing.apps.status.pilot")}</em>}</b>
        <span>{status !== "ready" ? <span className="hub-skeleton" aria-hidden /> : link ? t(link.pilot ? "landing.apps.download.pilotSub" : "landing.apps.download.storeSub") : t("landing.apps.download.phoneUnavailable")}</span></div></div>
      {link && <a className={cn(buttonVariants({ variant: "brand", size: "lg" }), "hub-phone-cta")} href={link.href} data-unichat-store={link.os}>{t("landing.apps.download.open", { store: t(`landing.apps.store.${link.label}`) })}<ExternalLink aria-hidden /></a>}
    </div>
    <div className="hub-phone-row">
      <div className="hub-phone-head"><AppIcon app="web" size={40} /><div><b>{t("landing.apps.catalog.web.short")}</b><span>{t("landing.apps.hub.phone.webSub")}</span></div></div>
      <Link className={cn(buttonVariants({ variant: "outline", size: "lg" }), "hub-phone-cta")} href={paths.login()}>{t("landing.apps.download.openWeb")}</Link>
    </div>
    <div className="hub-phone-row is-off" data-app="office">
      <div className="hub-phone-head"><AppIcon app="office" size={40} muted /><div><b>{t("landing.apps.catalog.office.name")}</b><span>{t("landing.apps.catalog.office.phoneSub")}</span></div></div>
    </div>
    <button type="button" className="hub-disc" aria-expanded={open} aria-controls={list} onClick={() => setOpen((value) => !value)}>{t("landing.apps.hub.phone.desktop")}<ChevronDown aria-hidden /></button>
    {open && <div id={list} className="hub-desk">{[...INSTALLABLE].sort((a, b) => Number(b.stores) - Number(a.stores)).map((app) => <DesktopGroup key={app.key} app={app} phone={phone} stores={stores} />)}</div>}
    <PilotNote stores={stores} />
  </div>;
}
