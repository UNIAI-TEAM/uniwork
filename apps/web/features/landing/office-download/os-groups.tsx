"use client";
import { Download, RefreshCw } from "lucide-react";
import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { DesktopOS } from "@uniwork/core/office";
import { paths } from "@uniwork/core/paths";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { MarketingLink as Link } from "../../../platform/marketing-link";
import { OsMark } from "../apps/os-marks";
import type { VisitorDevice } from "../apps/visitor-device";
import { megabytes, OS_ORDER, type DlFile, type FileId } from "./manifest";

/** A size only where the visitor must choose between two files (Linux); never for the rest. */
function useSize(): (file: DlFile) => string | null {
  const { t, i18n } = useTranslation();
  const format = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  return (file) => (file.os === "linux" && file.size ? t("office.desktop.install.size_mb", { value: format.format(Number(megabytes(file.size))) }) : null);
}

/** A small format hint only where an OS has two builds the visitor must tell apart (macOS chips, Linux formats). */
const HINT: Partial<Record<FileId, string>> = {
  mac_arm: "office.desktop.install.fmt.mac_arm_hint",
  mac_intel: "office.desktop.install.fmt.mac_intel_hint",
  deb: "office.desktop.install.fmt.deb_hint",
  appimage: "office.desktop.install.fmt.appimage_hint",
};

/** The Mac chip a certain browser proves; an unproven Mac keeps the published order and gets the help line. */
function provenChip(device: VisitorDevice): FileId | null {
  if (device.guess.confidence !== "certain") return null;
  return device.guess.platform === "darwin-arm64" ? "mac_arm" : device.guess.platform === "darwin-x64" ? "mac_intel" : null;
}

/** One build as one button: "Tải cho macOS chip Apple", with its hint (and on Linux its size) under the label. */
function BuildButton({ file, primary }: { file: DlFile; primary: boolean }) {
  const { t } = useTranslation();
  const size = useSize();
  const hint = HINT[file.id];
  const caption = [hint ? t(hint) : null, size(file)].filter(Boolean).join(" · ");
  return <a className={cn(buttonVariants({ variant: primary ? "brand" : "outline", size: "lg" }), "app-dl-button office-dl-build", caption && "has-caption")} href={file.url} download data-file={file.id}>
    <Download aria-hidden />
    <span className="office-dl-build-text"><span>{t("landing.office.download.cta", { label: t(`landing.office.download.chip.${file.id}`) })}</span>{caption && <small>{caption}</small>}</span>
  </a>;
}

interface GroupMeta { version?: string; date?: string }

/**
 * One operating system: its logo and name, the version and date once, one
 * button per build and, on Linux, the apt block (`extra`). The visitor's own
 * group is marked "Máy của bạn" and carries the one brand button of the page.
 */
function OsGroup({ os, files, own, chip, meta, extra }: { os: DesktopOS; files: readonly DlFile[]; own: boolean; chip: FileId | null; meta: GroupMeta; extra?: ReactNode }) {
  const { t } = useTranslation();
  const titleId = useId();
  // The proven Mac chip leads; otherwise the published order stands.
  const builds = [...files].sort((a, b) => Number(b.id === chip) - Number(a.id === chip));
  const sub = meta.version ? (meta.date ? t("landing.office.download.released", { version: meta.version, date: meta.date }) : t("landing.office.download.version", { version: meta.version })) : null;
  const macHelp = own && os === "macos" && !chip && builds.length > 1;
  return <section className={cn("office-dl-group", own && "is-own", extra && "has-extra")} aria-labelledby={titleId} data-os={os} data-own={own || undefined}>
    <div className="office-dl-group-body">
      <header className="office-dl-group-head">
        <span className="app-dl-os" aria-hidden><OsMark os={os} /></span>
        <div className="office-dl-group-name">
          <div className="office-dl-group-title">
            <h3 id={titleId}>{t(`office.desktop.install.os.${os}`)}</h3>
            {own && <span className="office-dl-own">{t("landing.apps.download.device")}</span>}
          </div>
          {sub && <p className="app-dl-sub">{sub}</p>}
        </div>
      </header>
      <div className="office-dl-builds">{builds.map((file, index) => <BuildButton key={file.id} file={file} primary={own && index === 0} />)}</div>
      {macHelp && <p className="app-dl-help">{t("landing.apps.download.macHelp")}</p>}
    </div>
    {extra}
  </section>;
}

/** A phone has no build: one slim note and the way to the web app, above the groups. */
function PhoneNote({ device }: { device: VisitorDevice }) {
  const { t } = useTranslation();
  const name = t("landing.apps.catalog.office.name");
  const os = device.phone ? t(`landing.apps.platform.${device.phone}`) : "";
  return <div className="office-dl-phone" role="note">
    <div><p><strong>{t("landing.apps.download.noBuild", { app: name, os })}</strong></p><p className="office-dl-muted">{t("landing.apps.catalog.office.phoneSub")}</p></div>
    <Link className={buttonVariants({ variant: "outline", size: "lg" })} href={paths.login()}>{t("landing.apps.download.openWeb")}</Link>
  </div>;
}

/**
 * The Download section's builds, grouped by operating system (UNI-2098 r3):
 * Windows, macOS and Linux side by side at desktop width, stacked on a phone.
 * The order is fixed so the page never reshuffles; the visitor's group is
 * marked and, once stacked, moved first by CSS. `apt` is the Linux group's
 * install block. Every build of the manifest and of `office_installers` fits.
 */
export function OsGroups({ files, meta, device, apt }: { files: readonly DlFile[]; meta: GroupMeta; device: VisitorDevice; apt?: ReactNode }) {
  const { t } = useTranslation();
  const chip = provenChip(device);
  return <>
    {device.phone && <PhoneNote device={device} />}
    <div className="office-dl-groups" role="group" aria-label={t("office.desktop.install.os_group")} data-count={OS_ORDER.filter((os) => files.some((file) => file.os === os)).length}>
      {OS_ORDER.map((os) => {
        const mine = files.filter((file) => file.os === os);
        if (mine.length === 0) return null;
        return <OsGroup key={os} os={os} files={mine} own={!device.phone && device.desktop === os} chip={chip} meta={meta} extra={os === "linux" ? apt : undefined} />;
      })}
    </div>
    <p className="office-dl-quiet"><RefreshCw aria-hidden /><span>{t("landing.office.download.autoUpdate")}</span></p>
  </>;
}
