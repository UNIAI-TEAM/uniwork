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
import { megabytes, OS_ORDER, type DlFile, type FileId, type ReleaseChannel } from "./manifest";
import { ProductShot } from "./product-shot";

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

/** The proven Mac chip leads; otherwise the published order stands. */
const ordered = (files: readonly DlFile[], chip: FileId | null): DlFile[] => [...files].sort((a, b) => Number(b.id === chip) - Number(a.id === chip));

/** One build as one button: "Tải cho macOS chip Apple", with its hint (and on Linux its size) under the label. */
function BuildButton({ file, primary, hero = false }: { file: DlFile; primary: boolean; hero?: boolean }) {
  const { t } = useTranslation();
  const size = useSize();
  const hint = HINT[file.id];
  const caption = [hint ? t(hint) : null, size(file)].filter(Boolean).join(" · ");
  return <a className={cn(buttonVariants({ variant: primary ? "brand" : "outline", size: "lg" }), "app-dl-button office-dl-build", caption && "has-caption", hero && "is-hero")} href={file.url} download data-file={file.id}>
    <Download aria-hidden />
    <span className="office-dl-build-text"><span>{t("landing.office.download.cta", { label: t(`landing.office.download.chip.${file.id}`) })}</span>{caption && <small>{caption}</small>}</span>
  </a>;
}

export interface GroupMeta { version?: string; date?: string; channel?: ReleaseChannel }

function useSub(meta: GroupMeta): string | null {
  const { t } = useTranslation();
  if (!meta.version) return null;
  return meta.date ? t("landing.office.download.released", { version: meta.version, date: meta.date }) : t("landing.office.download.version", { version: meta.version });
}

/**
 * One operating system as a card: its logo and name, the version and date once,
 * one outline button per build and, on Linux, the apt block (`extra`). The
 * visitor's own system is never a card: it is the spotlight.
 */
function OsGroup({ os, files, chip, meta, extra }: { os: DesktopOS; files: readonly DlFile[]; chip: FileId | null; meta: GroupMeta; extra?: ReactNode }) {
  const { t } = useTranslation();
  const titleId = useId();
  const builds = ordered(files, chip);
  const sub = useSub(meta);
  return <section className={cn("office-dl-group", extra && "has-extra")} aria-labelledby={titleId} data-os={os}>
    <div className="office-dl-group-body">
      <header className="office-dl-group-head">
        <span className="office-dl-os" aria-hidden><OsMark os={os} /></span>
        <div className="office-dl-group-name">
          <h3 id={titleId}>{t(`office.desktop.install.os.${os}`)}</h3>
          {sub && <p className="office-dl-sub">{sub}</p>}
        </div>
      </header>
      <div className="office-dl-builds">{builds.map((file) => <BuildButton key={file.id} file={file} primary={false} />)}</div>
    </div>
    {extra}
  </section>;
}

/**
 * The visitor's own system as the hero of the section. Copy and one
 * large brand button on the left, the real editor on the right; on Linux the apt
 * block runs under both. Rendered only once the system is known, so it never
 * swaps in after paint.
 */
function Spotlight({ os, files, chip, meta, extra }: { os: DesktopOS; files: readonly DlFile[]; chip: FileId | null; meta: GroupMeta; extra?: ReactNode }) {
  const { t } = useTranslation();
  const titleId = useId();
  const builds = ordered(files, chip);
  const sub = useSub(meta);
  const macHelp = os === "macos" && !chip && builds.length > 1;
  return <section className={cn("office-dl-spot", extra && "has-extra")} aria-labelledby={titleId} data-os={os} data-own>
    <div className="office-dl-spot-copy">
      <p className="office-dl-spot-eyebrow"><span className="office-dl-spot-mark" aria-hidden><OsMark os={os} /></span>{t("landing.apps.download.device")}</p>
      <h3 id={titleId}>{t("landing.apps.download.title", { app: t("landing.apps.catalog.office.name"), os: t(`office.desktop.install.os.${os}`) })}</h3>
      {sub && <p className="office-dl-spot-meta">{sub}{meta.channel && <span className="office-dl-spot-channel">{t(`landing.office.download.channel.${meta.channel}`)}</span>}</p>}
      <div className="office-dl-spot-builds">{builds.map((file, index) => <BuildButton key={file.id} file={file} primary={index === 0} hero={index === 0} />)}</div>
      {macHelp && <p className="app-dl-help">{t("landing.apps.download.macHelp")}</p>}
      <p className="office-dl-spot-auto"><RefreshCw aria-hidden /><span>{t("landing.office.download.autoUpdate")}</span></p>
    </div>
    <ProductShot className="office-dl-spot-media" />
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
 * The Download section's builds, grouped by operating system (UNI-2098 r4). When
 * the visitor's system is known it leads as the spotlight and the other systems
 * follow as two cards; otherwise the three systems sit side by side in a fixed
 * order. `apt` is the Linux install block, always placed with Linux.
 */
export function OsGroups({ files, meta, device, apt }: { files: readonly DlFile[]; meta: GroupMeta; device: VisitorDevice; apt?: ReactNode }) {
  const { t } = useTranslation();
  const chip = provenChip(device);
  const present = OS_ORDER.filter((os) => files.some((file) => file.os === os));
  const own = !device.phone && device.desktop && present.includes(device.desktop) ? device.desktop : null;
  const of = (os: DesktopOS) => files.filter((file) => file.os === os);
  const extraFor = (os: DesktopOS) => (os === "linux" ? apt : undefined);
  const others = own ? present.filter((os) => os !== own) : present;
  return <>
    {device.phone && <PhoneNote device={device} />}
    {own && <Spotlight os={own} files={of(own)} chip={chip} meta={meta} extra={extraFor(own)} />}
    {others.length > 0 && <div className={cn("office-dl-others", own && "is-secondary")}>
      {own && <h3 className="office-dl-others-title">{t("landing.apps.download.others")}</h3>}
      <div className="office-dl-groups" role="group" aria-label={t("office.desktop.install.os_group")} data-count={others.length}>
        {others.map((os) => <OsGroup key={os} os={os} files={of(os)} chip={chip} meta={meta} extra={extraFor(os)} />)}
      </div>
    </div>}
    {!own && <p className="office-dl-quiet"><RefreshCw aria-hidden /><span>{t("landing.office.download.autoUpdate")}</span></p>}
  </>;
}
