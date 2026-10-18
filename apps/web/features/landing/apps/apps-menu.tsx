"use client";
import { ArrowRight, Download, Globe, Smartphone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { DESKTOP_INSTALLER_KINDS, type DesktopOS } from "@uniwork/core/office";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { MarketingLink as Link } from "../../../platform/marketing-link";
import { AppIcon } from "./app-icon";
import { APP_CATALOG, PHONE_ORDER, type AppEntry } from "./catalog";
import { useAppInstallers, useStoreLinks } from "./installers";
import { useVisitorDevice } from "./visitor-device";

/** "macOS · Windows · Linux · iPhone · Android", or "Browser" for the web app. */
function platforms(t: (key: string) => string, app: AppEntry): string {
  if (!app.installers) return t("landing.apps.platform.web");
  return [...app.desktops, ...(app.stores ? PHONE_ORDER : [])].map((os) => t(`landing.apps.platform.${os}`)).join(" · ");
}

function AppRow({ app, pilot, onNavigate }: { app: AppEntry; pilot: boolean; onNavigate: () => void }) {
  const { t } = useTranslation();
  const name = `landing.apps.catalog.${app.key}`;
  return <li><Link className="header-app" href={app.href} onClick={onNavigate}>
    <AppIcon app={app.key} size={44} />
    <span>
      <strong>{t(`${name}.name`)}{pilot && <em className="app-tag is-pilot">{t("landing.apps.status.phonePilot")}</em>}</strong>
      <small>{t(`${name}.description`)}</small>
      <span className="header-app-platforms">{platforms(t, app)}</span>
    </span>
    <ArrowRight aria-hidden />
  </Link></li>;
}

/** One desktop app's quick row: what it ships for this system, and the way to its downloads. */
function QuickRow({ app, os, onNavigate }: { app: AppEntry; os: DesktopOS | null; onNavigate: () => void }) {
  const { t } = useTranslation();
  const installers = useAppInstallers(app.installers);
  const group = os ? installers.groups.find((item) => item.os === os) : undefined;
  const name = t(`landing.apps.catalog.${app.key}.name`);
  const sub = group ? group.installers.map((row) => t(`office.desktop.install.fmt.${DESKTOP_INSTALLER_KINDS[row.platform].format}`)).join(", ") : t(`landing.apps.catalog.${app.key}.kicker`);
  return <div className="header-quick-row">
    <AppIcon app={app.key} size={36} />
    <span><b>{name}</b><small>{sub}</small></span>
    {/* The app's own download section settles the chip and the format; the menu only points there. */}
    <Link className={cn(buttonVariants({ variant: "brand" }), "header-quick-get")} href={`${app.href}#${app.key}-download`} onClick={onNavigate}>
      <Download aria-hidden />{t("landing.apps.menu.download")}<span className="sr-only"> {name}</span>
    </Link>
  </div>;
}

/**
 * The header's Apps directory (UNI-1913): every app of the catalogue, Office
 * for Personal announced without a link, and the downloads for the system the
 * visitor is on. A phone visitor sees UniChat first, the one app that installs there.
 */
export function AppsMenu({ onNavigate }: { onNavigate: () => void }) {
  const { t } = useTranslation();
  const device = useVisitorDevice();
  const stores = Object.values(useStoreLinks(true));
  // The tag is honest only while every published phone build is a pilot one.
  const pilot = stores.length > 0 && stores.every((link) => link.pilot);
  const apps = device.phone ? [...APP_CATALOG].sort((a, b) => Number(b.key === "unichat") - Number(a.key === "unichat")) : APP_CATALOG;
  const os = device.desktop;
  return <div className="header-apps">
    <div>
      <p className="header-apps-title">{t("landing.apps.menu.title")}</p>
      <ul className="header-apps-list">
        {apps.map((app) => <AppRow key={app.key} app={app} pilot={app.stores && pilot} onNavigate={onNavigate} />)}
        <li><div className="header-app is-dim" data-office-personal>
          <AppIcon app="office" size={44} muted />
          <span><strong>{t("landing.apps.catalog.personal.name")}<em className="app-tag is-dev">{t("landing.apps.status.development")}</em></strong><small>{t("landing.apps.catalog.personal.description")}</small></span>
        </div></li>
      </ul>
      <Link className="header-apps-all" href={paths.apps.root()} onClick={onNavigate}>{t("landing.apps.menu.all")}<ArrowRight aria-hidden /></Link>
    </div>
    <aside className="header-quick" aria-label={t("landing.apps.download.device")}>
      <p className="header-apps-title is-own">{os ? t("landing.apps.menu.device", { os: t(`landing.apps.platform.${os}`) }) : t("landing.apps.download.device")}</p>
      {!device.phone && APP_CATALOG.filter((app) => app.installers).map((app) => <QuickRow key={app.key} app={app} os={os} onNavigate={onNavigate} />)}
      <span className="header-quick-sep" />
      <Link className="header-quick-link" href={`${paths.apps.unichat()}#unichat-download`} onClick={onNavigate}><Smartphone aria-hidden />{t("landing.apps.menu.phones")}</Link>
      <Link className="header-quick-link" href={paths.login()} onClick={onNavigate}><Globe aria-hidden />{t("landing.apps.menu.web")}</Link>
    </aside>
  </div>;
}
