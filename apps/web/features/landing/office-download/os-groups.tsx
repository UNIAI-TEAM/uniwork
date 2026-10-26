"use client";
import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { DesktopOS } from "@uniwork/core/office";
import { paths } from "@uniwork/core/paths";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { MarketingLink as Link } from "../../../platform/marketing-link";
import { OsMark } from "../apps/os-marks";
import type { VisitorDevice } from "../apps/visitor-device";
import { BuildButton, ordered, provenChip } from "./build-meta";
import { OS_ORDER, type DlFile, type FileId, type ReleaseChannel } from "./manifest";
import { OsPicker } from "./os-picker";
import { ProductShot } from "./product-shot";

interface GroupMeta { version?: string; date?: string; channel?: ReleaseChannel }

function useSub(meta: GroupMeta): string | null {
  const { t } = useTranslation();
  if (!meta.version) return null;
  return meta.date ? t("landing.office.download.released", { version: meta.version, date: meta.date }) : t("landing.office.download.version", { version: meta.version });
}

/**
 * One operating system as a card: its logo and name, the version and date once
 * and one outline button per build. Only drawn when the visitor's system is
 * unknown (all three side by side); a known system is the spotlight and the
 * others sit in the picker.
 */
function OsGroup({ os, files, chip, meta }: { os: DesktopOS; files: readonly DlFile[]; chip: FileId | null; meta: GroupMeta }) {
  const { t } = useTranslation();
  const titleId = useId();
  const builds = ordered(files, chip);
  const sub = useSub(meta);
  return <section className="office-dl-group" aria-labelledby={titleId} data-os={os}>
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
 * The Download section's builds (UNI-2098 r5). When the visitor's system is
 * known it leads as the spotlight and "Nền tảng khác" is one closed row that
 * opens an OS picker; otherwise the three systems sit side by side in a fixed
 * order. `apt` is the Linux install block: inside the Linux spotlight, or inside
 * the picker when Linux is the picked "other" system.
 */
export function OsGroups({ files, meta, device, apt }: { files: readonly DlFile[]; meta: GroupMeta; device: VisitorDevice; apt?: ReactNode }) {
  const { t } = useTranslation();
  const chip = provenChip(device);
  const present = OS_ORDER.filter((os) => files.some((file) => file.os === os));
  const own = !device.phone && device.desktop && present.includes(device.desktop) ? device.desktop : null;
  const of = (os: DesktopOS) => files.filter((file) => file.os === os);
  return <>
    {device.phone && <PhoneNote device={device} />}
    {own && <Spotlight os={own} files={of(own)} chip={chip} meta={meta} extra={own === "linux" ? apt : undefined} />}
    {own && present.length > 1 && <OsPicker files={files} meta={{ version: meta.version, channel: meta.channel }} own={own} chip={chip} apt={apt} />}
    {!own && present.length > 0 && <div className="office-dl-others">
      <div className="office-dl-groups" role="group" aria-label={t("office.desktop.install.os_group")} data-count={present.length}>
        {present.map((os) => <OsGroup key={os} os={os} files={of(os)} chip={chip} meta={meta} />)}
      </div>
      {apt}
    </div>}
  </>;
}
