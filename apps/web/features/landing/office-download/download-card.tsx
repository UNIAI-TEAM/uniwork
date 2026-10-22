"use client";
import { Download, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { MarketingLink as Link } from "../../../platform/marketing-link";
import { OsMark } from "../apps/os-marks";
import type { VisitorDevice } from "../apps/visitor-device";
import { megabytes, orderFor, type DlFile, type FileId, type ReleaseChannel } from "./manifest";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** A size only where the visitor must choose between two files (Linux); never for the rest. */
function useSize(): (file: DlFile) => string | null {
  const { t, i18n } = useTranslation();
  const format = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  return (file) => (file.os === "linux" && file.size ? t("office.desktop.install.size_mb", { value: format.format(Number(megabytes(file.size))) }) : null);
}

/** Every other file as one chip: the system's logo, its plain name (macOS is named by chip), and on Linux the size. */
export function FileChips({ files, labelledBy }: { files: readonly DlFile[]; labelledBy?: string }) {
  const { t } = useTranslation();
  const size = useSize();
  return <div className="app-dl-chips office-dl-chips" role="group" aria-label={labelledBy ? undefined : t("landing.apps.download.others")} aria-labelledby={labelledBy}>
    {files.map((file) => <a key={file.id} className="app-dl-chip office-dl-chip" href={file.url} download data-office-os={file.os} data-file={file.id}>
      <OsMark os={file.os} /><strong>{t(`landing.office.download.chip.${file.id}`)}</strong>{size(file) && <span>{size(file)}</span>}
    </a>)}
  </div>;
}

/** The Mac chip a certain browser proves; an unproven Mac keeps the published order and gets the hint. */
function provenChip(device: VisitorDevice): FileId | null {
  if (device.guess.confidence !== "certain") return null;
  return device.guess.platform === "darwin-arm64" ? "mac_arm" : device.guess.platform === "darwin-x64" ? "mac_intel" : null;
}

function LeadButton({ file, primary, t }: { file: DlFile; primary: boolean; t: Translate }) {
  const size = useSize();
  const hint = file.os === "linux" ? t(`office.desktop.install.fmt.${file.id === "deb" ? "deb" : "appimage"}_hint`) : null;
  const caption = [hint, size(file)].filter(Boolean).join(" · ");
  return <a className={cn(buttonVariants({ variant: primary ? "brand" : "outline", size: "lg" }), "app-dl-button office-dl-lead", caption && "has-caption")} href={file.url} download data-file={file.id}>
    <Download aria-hidden /><span className="office-dl-lead-text"><span>{t("landing.office.download.cta", { label: t(`landing.office.download.chip.${file.id}`) })}</span>{caption && <small>{caption}</small>}</span>
  </a>;
}

/**
 * The visitor's own system as the one clear action: its logo, "UniOffice cho
 * Windows", version and date, and the button. Every other file follows as a
 * chip with its logo. A phone has no build: it is sent to the web app.
 */
export function DownloadCard({ files, version, date, channel, device }: { files: readonly DlFile[]; version?: string; date?: string; channel?: ReleaseChannel; device: VisitorDevice }) {
  const { t } = useTranslation();
  const name = t("landing.apps.catalog.office.name");
  const phone = device.phone;
  const own = !phone && device.desktop && files.some((file) => file.os === device.desktop) ? device.desktop : null;
  const fallbackOs = files[0]?.os ?? "windows";
  const { lead, others } = phone ? { lead: [], others: [...files] } : orderFor(files, own ?? fallbackOs, provenChip(device));
  const os = own ?? fallbackOs;
  const osName = phone ? t(`landing.apps.platform.${phone}`) : t(`office.desktop.install.os.${os}`);
  const missing = Boolean(phone) || lead.length === 0;
  const title = missing ? t("landing.apps.download.noBuild", { app: name, os: phone ? osName : t(`office.desktop.install.os.${device.desktop ?? os}`) }) : t("landing.apps.download.title", { app: name, os: osName });
  const sub = missing ? t(phone ? "landing.apps.catalog.office.phoneSub" : "landing.apps.download.webInstead")
    : version ? (date ? t("landing.office.download.released", { version, date }) : t("landing.office.download.version", { version })) : null;
  const macHint = os === "macos" && lead.length > 1 && !provenChip(device) && !missing;
  return <>
    <section className={cn("app-dl-featured office-dl-card", missing && "is-missing")} aria-label={title} data-featured={missing ? "missing" : os}>
      <div className="app-dl-featured-copy">
        <span className="app-dl-os" aria-hidden>{missing ? <Download /> : <OsMark os={os} />}</span>
        <div>
          <p className="office-dl-eyebrow">
            {(own || phone) && <span className="app-dl-own">{t("landing.apps.download.device")}</span>}
            {channel && !missing && <Badge className="office-dl-badge">{t(`landing.office.download.channel.${channel}`)}</Badge>}
          </p>
          <h3>{title}</h3>
          {sub && <p className="app-dl-sub">{sub}</p>}
        </div>
      </div>
      <div className="app-dl-actions">
        <div className="app-dl-buttons">
          {missing
            ? <Link className={cn(buttonVariants({ variant: "outline", size: "lg" }), "app-dl-button")} href={paths.login()}>{t("landing.apps.download.openWeb")}</Link>
            : lead.map((file, index) => <LeadButton key={file.id} file={file} primary={index === 0} t={t} />)}
        </div>
        {macHint && <p className="app-dl-help">{t("landing.apps.download.macHelp")}</p>}
      </div>
    </section>
    {others.length > 0 && <FileChips files={others} />}
    {!missing && <p className="office-dl-quiet"><RefreshCw aria-hidden /><span>{t("landing.office.download.autoUpdate")}</span></p>}
  </>;
}

