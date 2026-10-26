"use client";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DESKTOP_INSTALLER_KINDS, type DesktopPlatform } from "@uniwork/core/office";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import type { VisitorDevice } from "../apps/visitor-device";
import { megabytes, type DlFile, type FileId } from "./manifest";

/** A size only where the visitor must choose between two files (Linux); never for the rest. */
function useSize(): (file: DlFile) => string | null {
  const { t, i18n } = useTranslation();
  const format = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  return (file) => (file.os === "linux" && file.size ? t("office.desktop.install.size_mb", { value: format.format(Number(megabytes(file.size))) }) : null);
}

/** A small format hint only where an OS has two builds the visitor must tell apart (macOS chips, Linux formats). */
export const HINT: Partial<Record<FileId, string>> = {
  mac_arm: "office.desktop.install.fmt.mac_arm_hint",
  mac_intel: "office.desktop.install.fmt.mac_intel_hint",
  deb: "office.desktop.install.fmt.deb_hint",
  appimage: "office.desktop.install.fmt.appimage_hint",
};

/** The platform row each build comes from: where its requirement line lives (`DESKTOP_INSTALLER_KINDS`, also the in-app installer's). */
const PLATFORM: Record<FileId, DesktopPlatform> = { win: "win32-x64", mac_arm: "darwin-arm64", mac_intel: "darwin-x64", deb: "linux-x64-deb", appimage: "linux-x64-appimage" };
export const requirementKey = (id: FileId): string => `office.desktop.install.req.${DESKTOP_INSTALLER_KINDS[PLATFORM[id]].requirement}`;

/** The Mac chip a certain browser proves; an unproven Mac keeps the published order and gets the help line. */
export function provenChip(device: VisitorDevice): FileId | null {
  if (device.guess.confidence !== "certain") return null;
  return device.guess.platform === "darwin-arm64" ? "mac_arm" : device.guess.platform === "darwin-x64" ? "mac_intel" : null;
}

/** The proven Mac chip leads; otherwise the published order stands. */
export const ordered = (files: readonly DlFile[], chip: FileId | null): DlFile[] => [...files].sort((a, b) => Number(b.id === chip) - Number(a.id === chip));

/** One build as one button: "Tải cho macOS chip Apple", with its hint (and on Linux its size) under the label. */
export function BuildButton({ file, primary, hero = false, hint = true, className }: { file: DlFile; primary: boolean; hero?: boolean; hint?: boolean; className?: string }) {
  const { t } = useTranslation();
  const size = useSize();
  const hinted = hint ? HINT[file.id] : undefined;
  const bytes = size(file);
  // The size and its unit never part ("118,3 MB" stays on one line at 390 px).
  const caption = hinted || bytes ? <>{hinted && t(hinted)}{hinted && bytes && " · "}{bytes && <span className="office-dl-size">{bytes}</span>}</> : null;
  return <a className={cn(buttonVariants({ variant: primary ? "brand" : "outline", size: "lg" }), "app-dl-button office-dl-build", caption && "has-caption", hero && "is-hero", className)} href={file.url} download data-file={file.id}>
    <Download aria-hidden />
    <span className="office-dl-build-text"><span>{t("landing.office.download.cta", { label: t(`landing.office.download.chip.${file.id}`) })}</span>{caption && <small>{caption}</small>}</span>
  </a>;
}
