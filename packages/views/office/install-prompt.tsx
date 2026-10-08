"use client";

import { useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import {
  DESKTOP_INSTALLER_KINDS, DESKTOP_PLATFORMS, isDesktopPlatform,
  type DesktopOS, type DesktopPlatform, type DesktopPlatformGuess, type OfficeInstallerOption, type OfficeChannel,
} from "@uniwork/core/office";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Button } from "@uniwork/ui/components/ui/button";
import { Alert, AlertDescription } from "@uniwork/ui/components/ui/alert";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@uniwork/ui/components/ui/radio-group";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { Logo } from "@uniwork/ui/brand";
import { OSGlyph } from "./os-glyphs";
import { InstallerInstructions } from "./installer-instructions";

export type OfficeInstallChannel = OfficeChannel;
export interface OfficeInstallPromptProps {
  open: boolean;
  channel: OfficeInstallChannel;
  installers: OfficeInstallerOption[];
  supportedPlatforms?: readonly DesktopPlatform[];
  platformHint: DesktopPlatformGuess;
  onOpenChange: (open: boolean) => void;
  onOpenAgain: () => void;
  reason?: "not-installed" | "expired" | "error" | "download";
  onDownload: (platform: DesktopPlatform) => Promise<void>;
}

const radioStyle = "absolute inset-0 aspect-auto size-full rounded-xl border-input bg-background after:inset-0 hover:border-muted-foreground data-checked:border-primary data-checked:bg-primary/10 data-checked:text-foreground dark:bg-background dark:data-checked:bg-primary/10 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:ring-0 [&>[data-slot=radio-group-indicator]]:hidden";

function installerFilename(installer: OfficeInstallerOption): string {
  try { return decodeURIComponent(new URL(installer.url).pathname).split("/").pop() || installer.platform + installer.kind; }
  catch { return installer.platform + installer.kind; }
}

/** Reset a new visit without removing the popup during its exit animation. */
export function OfficeInstallPrompt(props: OfficeInstallPromptProps) {
  const [visit, setVisit] = useState({ open: props.open, id: 0 });
  if (visit.open !== props.open) {
    setVisit({ open: props.open, id: visit.id + (props.open ? 1 : 0) });
  }
  return <Dialog open={props.open} onOpenChange={props.onOpenChange}>
    <InstallerPicker key={visit.id} {...props} />
  </Dialog>;
}

function InstallerPicker({
  channel, installers, supportedPlatforms = DESKTOP_PLATFORMS, platformHint, onOpenChange, onOpenAgain, reason = "not-installed", onDownload,
}: OfficeInstallPromptProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.desktop.install" });
  const supported = useMemo(() => DESKTOP_PLATFORMS.filter((key) => supportedPlatforms.includes(key)), [supportedPlatforms]);
  const options = useMemo(() => supported.flatMap((platform) => {
    const item = installers.find((row) => row.platform === platform && row.channel === channel);
    return item && isDesktopPlatform(item.platform) ? [item] : [];
  }), [supported, installers, channel]);
  const systems = [...new Set(supported.map((key) => DESKTOP_INSTALLER_KINDS[key].os))];
  const recommended = platformHint.platform && supported.includes(platformHint.platform) ? platformHint.platform : null;
  const recommendedOS = recommended ? DESKTOP_INSTALLER_KINDS[recommended].os : null;
  const firstOS = recommendedOS ?? systems[0] ?? null;
  const [selectedOS, setSelectedOS] = useState<DesktopOS | null>(firstOS);
  const [selectedPlatform, setSelectedPlatform] = useState<DesktopPlatform | null>(() =>
    recommended && options.some((row) => row.platform === recommended) ? recommended
      : options.find((row) => DESKTOP_INSTALLER_KINDS[row.platform].os === firstOS)?.platform ?? null);
  const [downloading, setDownloading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [started, setStarted] = useState<string | null>(null);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const primary = useRef<HTMLButtonElement>(null);
  const openAgain = useRef<HTMLButtonElement>(null);
  const later = useRef<HTMLButtonElement>(null);
  const selected = options.find((row) => row.platform === selectedPlatform && DESKTOP_INSTALLER_KINDS[row.platform].os === selectedOS);
  const formats = options.filter((row) => DESKTOP_INSTALLER_KINDS[row.platform].os === selectedOS);
  const reasonKey = reason === "download" ? "description_download" : reason === "expired" ? "expired" : reason === "error" ? "error" : "not_installed";
  const osLabel = selectedOS ? t(`os.${selectedOS}`) : "";
  const resetDownload = () => { setFailed(false); setStarted(null); setInstructionsOpen(false); };
  const selectOS = (value: unknown) => {
    if (downloading || !systems.includes(value as DesktopOS)) return;
    const os = value as DesktopOS;
    setSelectedOS(os);
    setSelectedPlatform(options.find((row) => DESKTOP_INSTALLER_KINDS[row.platform].os === os)?.platform ?? null);
    resetDownload();
  };
  const selectFormat = (value: unknown) => {
    if (downloading || typeof value !== "string" || !isDesktopPlatform(value) || !formats.some((row) => row.platform === value)) return;
    setSelectedPlatform(value); resetDownload();
  };
  const download = async () => {
    if (!selected || downloading) return;
    setDownloading(true); setFailed(false); setStarted(null);
    try {
      await onDownload(selected.platform);
      setStarted("UniWork-Office.zip"); setInstructionsOpen(true);
    } catch { setFailed(true); }
    finally { setDownloading(false); }
  };
  const filename = selected ? installerFilename(selected) : "";
  const requirement = selected ? selected.requirements ?? t(`req.${DESKTOP_INSTALLER_KINDS[selected.platform].requirement}`) : "";

  return <DialogContent
    className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto rounded-[16px] bg-background p-4 min-[480px]:max-w-[560px] min-[480px]:p-6 sm:max-w-[560px] [&_[data-slot=dialog-close]]:size-8"
    closeLabel={t("close")} aria-describedby="office-install-description"
    initialFocus={() => selected ? primary.current : reason !== "download" && options.length > 0 ? openAgain.current : later.current}
  >
    <div className="flex items-start gap-3 pr-6">
      <Logo variant="mark" size={36} decorative className="size-9 shrink-0 rounded-[10px]" />
      <div className="min-w-0 space-y-1">
        <DialogTitle className="text-title leading-snug">{t("title")}</DialogTitle>
        <DialogDescription id="office-install-description" className="text-body">{t(options.length === 0 && reason === "download" ? "description_unavailable" : reasonKey)}</DialogDescription>
      </div>
    </div>
    {options.length === 0 ? <p role="status" className="text-body text-muted-foreground">{t("unavailable")}</p> : <>
      {!recommended ? <Alert role="status"><AlertDescription>{t("unsupported")}</AlertDescription></Alert> : null}
      <RadioGroup aria-label={t("os_group")} value={selectedOS ?? ""} onValueChange={selectOS} disabled={downloading}
        className="grid auto-cols-fr grid-flow-col gap-2 pt-2 min-[480px]:gap-[10px]">
        {systems.map((os) => {
          const unavailable = !options.some((row) => DESKTOP_INSTALLER_KINDS[row.platform].os === os);
          return <div key={os} className="relative flex min-h-[88px] min-w-0 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl px-1 py-3">
            <RadioGroupItem value={os} aria-label={t(`os.${os}`)} aria-disabled={unavailable || undefined}
              aria-description={unavailable ? t("not_in_channel", { os: t(`os.${os}`) }) : undefined}
              className={radioStyle + (unavailable ? " opacity-50" : "")} />
            {recommendedOS === os ? <Badge className="pointer-events-none absolute -top-2 z-10 bg-primary px-2 py-0 text-caption text-primary-foreground">{t("recommended_tag")}</Badge> : null}
            <span aria-hidden className={"pointer-events-none relative flex flex-col items-center gap-2 text-body font-medium" + (unavailable ? " text-muted-foreground" : "")}>
              <OSGlyph os={os} />{t(`os.${os}`)}
              {unavailable ? <span className="text-caption font-normal">{t("unavailable_os")}</span> : null}
            </span>
          </div>;
        })}
      </RadioGroup>
      <div className="space-y-2">
        <p className="text-caption font-medium">{t("format_group")}</p>
        {formats.length === 0 ? <Alert role="status"><AlertDescription>{t("not_in_channel", { os: osLabel })}</AlertDescription></Alert> :
          <RadioGroup aria-label={t("format_group")} value={selectedPlatform ?? ""} onValueChange={selectFormat} disabled={downloading} className="flex flex-wrap gap-2">
            {formats.map((item) => {
              const format = DESKTOP_INSTALLER_KINDS[item.platform].format;
              return <div key={item.platform} className="relative min-h-11 min-w-0 cursor-pointer rounded-md px-3 py-2">
                <RadioGroupItem value={item.platform} aria-label={t(`fmt.${format}`)} aria-description={t(`fmt.${format}_hint`)} className={radioStyle + " rounded-md"} />
                <span aria-hidden className="pointer-events-none relative block text-body font-medium">{t(`fmt.${format}`)}</span>
                <span aria-hidden className="pointer-events-none relative block text-caption text-muted-foreground">{t(`fmt.${format}_hint`)}</span>
              </div>;
            })}
          </RadioGroup>}
        {selectedOS === recommendedOS && selectedOS === "macos" && platformHint.confidence === "uncertain" ?
          <p className="text-caption text-muted-foreground">{t("mac_chip_help")}</p> : null}
      </div>
      {selected ? <>
        <div className="space-y-2 rounded-lg bg-muted p-3 text-caption text-muted-foreground">
          <div className="flex flex-wrap justify-between gap-x-3 gap-y-1">
            <span>{t("requirements", { value: "" })}<strong className="font-medium text-foreground">{requirement}</strong></span>
            {selected.size_bytes ? <span>{t("size", { value: "" })}<strong className="font-medium text-foreground">{t("size_mb", { value: (selected.size_bytes / 1048576).toFixed(0) })}</strong></span> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">{t("version_line", { version: selected.version ?? t("version_unknown"), channel })}</span>
            {selected.unsigned ? <Badge variant="outline" className="text-caption">{t("unsigned")}</Badge> : null}
          </div>
        </div>
        <InstallerInstructions key={selected.platform} installer={selected} file={filename} open={instructionsOpen} onOpenChange={setInstructionsOpen} />
      </> : null}
    </>}
    {failed ? <Alert variant="destructive" role="alert"><AlertDescription>{t("download_failed")}</AlertDescription></Alert> : null}
    <div className="flex flex-col gap-3">
      <p role="status" className="min-w-0 text-caption text-muted-foreground empty:sr-only">
        {downloading ? t("downloading") : started ? <Trans t={t} i18nKey="started" values={{ file: started }} components={{ filename: <span className="font-medium text-foreground [overflow-wrap:anywhere]" /> }} /> : ""}
      </p>
      <div className="flex flex-col-reverse gap-2 min-[480px]:flex-row min-[480px]:justify-end">
        {reason !== "download" && options.length > 0 ? <Button ref={openAgain} variant="ghost" onClick={onOpenAgain} disabled={downloading}>{t("open_again")}</Button> : null}
        <Button ref={later} variant="outline" onClick={() => onOpenChange(false)}>{t("later")}</Button>
        {options.length > 0 ? <Button ref={primary} onClick={() => void download()} disabled={!selected || downloading} className="min-w-0">
          {downloading ? <Spinner aria-hidden className="size-4" /> : <Download aria-hidden className="size-4" />}
          {t(downloading ? "downloading" : failed ? "retry" : "download_for", { os: osLabel })}
        </Button> : null}
      </div>
    </div>
  </DialogContent>;
}
