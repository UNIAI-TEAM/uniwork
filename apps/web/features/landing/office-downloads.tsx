"use client";
import { Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DESKTOP_INSTALLER_KINDS, DESKTOP_PLATFORMS, selectOfficeInstallerChannel,
  type DesktopOS, type DesktopPlatformGuess, type OfficeInstallerOption,
} from "@uniwork/core/office";
import { usePublicConfig } from "@uniwork/core/feature-flags";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { OSGlyph } from "@uniwork/views/office/os-glyphs";
import { readBrowserPlatformGuess, UNKNOWN_PLATFORM } from "./office-platform-hint";

interface OfficeOsGroup { os: DesktopOS; installers: OfficeInstallerOption[] }
interface OfficeInstallers {
  status: "loading" | "ready" | "error";
  groups: OfficeOsGroup[];
  version: string | undefined;
  guess: DesktopPlatformGuess;
  retry: () => void;
  retrying: boolean;
}

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
 * variant that is not published is simply absent. The catalogue and the
 * visitor's platform are read in the browser only, so the server's HTML and the
 * first client render agree (both show the loading shell).
 */
export function useOfficeInstallers(): OfficeInstallers {
  const query = usePublicConfig();
  const [guess, setGuess] = useState<DesktopPlatformGuess | undefined>();
  useEffect(() => {
    let live = true;
    void readBrowserPlatformGuess().then((value) => { if (live) setGuess(value); }, () => { if (live) setGuess(UNKNOWN_PLATFORM); });
    return () => { live = false; };
  }, []);
  const config = query.data;
  const published = useMemo(() => {
    const channel = selectOfficeInstallerChannel(config?.office_installers);
    const installers = channel ? config?.office_installers?.[channel] ?? [] : [];
    const versions = installers.flatMap((row) => (row.version ? [row.version] : []));
    return { groups: groupOfficeInstallers(installers), version: versions[0] };
  }, [config]);
  // A failed refetch keeps the catalogue it already had; only "no answer at all" is an error.
  const status = guess === undefined || (query.isPending && !config) ? "loading" : !config && query.isError ? "error" : "ready";
  return { status, ...published, guess: guess ?? UNKNOWN_PLATFORM, retry: () => { void query.refetch(); }, retrying: query.isFetching };
}

function VariantLabel({ installer }: { installer: OfficeInstallerOption }) {
  const { t } = useTranslation();
  return <>{t(`office.desktop.install.fmt.${DESKTOP_INSTALLER_KINDS[installer.platform].format}`)}</>;
}

/** Same classes as the real buttons, so the loading shell has the loaded height. */
function SkeletonButton({ primary = false }: { primary?: boolean }) {
  return <span aria-hidden className={cn(buttonVariants({ variant: primary ? "brand" : "outline", size: "lg" }), "office-os-button office-skeleton")}>&nbsp;</span>;
}

function InstallersError({ retry, retrying }: Pick<OfficeInstallers, "retry" | "retrying">) {
  const { t } = useTranslation();
  return <div className="office-unavailable office-installers-error" role="alert">
    <p>{t("landing.office.installersError")}</p>
    <Button type="button" variant="outline" size="sm" aria-disabled={retrying} onClick={() => { if (!retrying) retry(); }}>{t("landing.office.retry")}</Button>
  </div>;
}

/** Download block: per OS, the requirement line and every published variant. */
export function OfficeDownloadColumns() {
  const { t } = useTranslation();
  const { status, groups, retry, retrying } = useOfficeInstallers();
  if (status === "loading") return <div className="office-download-columns" aria-busy>{OS_ORDER.map((os) => <div className="office-download-column" key={os} aria-hidden>
    <h3 className="office-skeleton">&nbsp;</h3><p className="office-skeleton">&nbsp;</p><ul><li><SkeletonButton /></li><li><SkeletonButton /></li></ul>
  </div>)}</div>;
  if (status === "error") return <div className="office-download-columns"><InstallersError retry={retry} retrying={retrying} /></div>;
  if (groups.length === 0) return <div className="office-download-columns"><p className="office-unavailable" role="status">{t("landing.office.download.unavailable")}</p></div>;
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
