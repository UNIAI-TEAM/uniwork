"use client";
import { Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DESKTOP_INSTALLER_KINDS, DESKTOP_PLATFORMS, selectOfficeInstallerChannel,
  type DesktopOS, type OfficeInstallerOption,
} from "@uniwork/core/office";
import { usePublicConfig } from "@uniwork/core/feature-flags";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { OSGlyph } from "@uniwork/views/office/os-glyphs";

interface OfficeOsGroup { os: DesktopOS; installers: OfficeInstallerOption[] }

const OS_ORDER: readonly DesktopOS[] = ["macos", "windows", "linux"];

/** Installers of one channel grouped by OS; an OS with no published variant is left out. */
function groupOfficeInstallers(installers: readonly OfficeInstallerOption[]): OfficeOsGroup[] {
  return OS_ORDER.flatMap((os) => {
    const rows = DESKTOP_PLATFORMS.flatMap((platform) => {
      const row = DESKTOP_INSTALLER_KINDS[platform].os === os ? installers.find((item) => item.platform === platform) : undefined;
      return row ? [row] : [];
    });
    return rows.length > 0 ? [{ os, installers: rows }] : [];
  });
}

/**
 * The installers the web already offers: the public config's channel catalogue,
 * on the most stable channel that publishes one. Nothing is hard-coded, and a
 * variant that is not published is simply absent.
 */
export function useOfficeInstallers(): { status: "loading" | "ready"; groups: OfficeOsGroup[]; version: string | undefined } {
  const query = usePublicConfig();
  // The catalogue is read in the browser only, so the server's HTML and the first client render agree.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const config = query.data;
  const published = useMemo(() => {
    const channel = selectOfficeInstallerChannel(config?.office_installers);
    const installers = channel ? config?.office_installers?.[channel] ?? [] : [];
    const versions = installers.flatMap((row) => (row.version ? [row.version] : []));
    return { groups: groupOfficeInstallers(installers), version: versions[0] };
  }, [config]);
  return { status: mounted && !query.isPending ? "ready" : "loading", ...published };
}

function VariantLabel({ installer }: { installer: OfficeInstallerOption }) {
  const { t } = useTranslation();
  return <>{t(`office.desktop.install.fmt.${DESKTOP_INSTALLER_KINDS[installer.platform].format}`)}</>;
}

/** Hero buttons: one primary button per OS, the other variants as links beneath it. */
export function OfficeHeroDownloads() {
  const { t } = useTranslation();
  const { status, groups } = useOfficeInstallers();
  if (status === "loading") return <div className="office-hero-downloads" aria-busy />;
  if (groups.length === 0) return <p className="office-unavailable" role="status">{t("landing.office.hero.unavailable")}</p>;
  return <div className="office-hero-downloads">{groups.map(({ os, installers }) => {
    const osName = t(`office.desktop.install.os.${os}`);
    return <div className="office-os" key={os} data-office-os={os}>
      <a className={cn(buttonVariants({ variant: os === "macos" ? "brand" : "outline", size: "lg" }), "office-os-button")} href={installers[0]?.url} download>
        <OSGlyph os={os} />{t("landing.office.hero.downloadFor", { os: osName })}
      </a>
      <ul className="office-os-variants" aria-label={t("landing.office.hero.variants", { os: osName })}>
        {installers.map((installer) => <li key={installer.platform}><a href={installer.url} download><VariantLabel installer={installer} /></a></li>)}
      </ul>
    </div>;
  })}</div>;
}

/** Download block: per OS, the requirement line and every published variant. */
export function OfficeDownloadColumns() {
  const { t } = useTranslation();
  const { status, groups } = useOfficeInstallers();
  if (status === "loading") return <div className="office-download-columns" aria-busy />;
  if (groups.length === 0) return <p className="office-unavailable" role="status">{t("landing.office.download.unavailable")}</p>;
  return <div className="office-download-columns">{groups.map(({ os, installers }) => {
    const first = installers[0];
    const requirement = first?.requirements ?? (first ? t(`office.desktop.install.req.${DESKTOP_INSTALLER_KINDS[first.platform].requirement}`) : "");
    return <section className="office-download-column" key={os} data-office-os={os} aria-label={t(`office.desktop.install.os.${os}`)}>
      <h3><OSGlyph os={os} />{t(`office.desktop.install.os.${os}`)}</h3>
      <p>{t("landing.office.download.requirements", { value: requirement })}</p>
      <ul>{installers.map((installer) => <li key={installer.platform}>
        <a className={buttonVariants({ variant: "outline", size: "lg" })} href={installer.url} download><Download aria-hidden /><VariantLabel installer={installer} /></a>
      </li>)}</ul>
      {installers.some((installer) => installer.unsigned) && <small>{t("landing.office.download.unsigned")}</small>}
    </section>;
  })}</div>;
}
