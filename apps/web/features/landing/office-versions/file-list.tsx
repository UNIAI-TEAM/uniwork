"use client";
import { Check, Copy, Download, Info, Laptop, Monitor, ShieldAlert, ShieldCheck, Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DesktopOS } from "@uniwork/core/office";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { CopyStatus, useCopy } from "./copy-button";
import { formatKey, groupAssets, megabytes, shortSha, signedOf, type Release, type ReleaseAsset } from "./manifest";

const OS_ICON = { windows: Monitor, macos: Laptop, linux: Terminal } as const;

function FileRow({ asset, primary }: { asset: ReleaseAsset; primary: boolean }) {
  const { t } = useTranslation();
  const { state, copy } = useCopy(asset.sha256);
  const format = formatKey(asset);
  return <li className="ver-file">
    <div className="ver-file-name">
      <strong>{t(`office.desktop.install.fmt.${format}`)}</strong>
      <span>{t(`office.desktop.install.fmt.${format}_hint`)}</span>
    </div>
    <span className="ver-file-size">{t("office.desktop.install.size_mb", { value: megabytes(asset.size) })}</span>
    <div className="ver-file-sha">
      <span className="ver-file-sha-label">{t("landing.office.versions.sha")}</span>
      <code title={asset.sha256} data-copied={state === "copied" || undefined}>{state === "copied" ? <><Check aria-hidden />{t("office.desktop.install.copied")}</> : shortSha(asset.sha256)}</code>
      <Button type="button" variant="ghost" size="icon-sm" className="ver-copy" data-copied={state === "copied" || undefined} aria-label={t("landing.office.versions.copySha", { file: asset.file })} onClick={copy}>
        {state === "copied" ? <Check aria-hidden /> : <Copy aria-hidden />}
      </Button>
      <CopyStatus state={state} />
    </div>
    <a className={cn(buttonVariants({ variant: primary ? "brand" : "outline", size: "lg" }), "ver-file-action")} href={asset.url} download aria-label={t("landing.office.versions.downloadFile", { file: asset.file })}>
      <Download aria-hidden />{t("landing.office.versions.download")}
    </a>
  </li>;
}

/**
 * One release's installers by system: the visitor's own first, a signed badge
 * per system and, where it is not signed, one honest line about the warning.
 * `lead` marks the single brand-coloured button on the card.
 */
export function FileList({ release, own, lead }: { release: Release; own: DesktopOS | null; lead: boolean }) {
  const { t } = useTranslation();
  const { groups, checksums } = groupAssets(release, own);
  return <div className="ver-files-wrap">
    {groups.map((group, index) => {
      const Icon = OS_ICON[group.os];
      const signed = signedOf(release, group.os);
      return <section key={group.os} className="ver-os" data-own={group.os === own || undefined} aria-label={t(`office.desktop.install.os.${group.os}`)}>
        <header className="ver-os-head">
          <Icon aria-hidden />
          <h4>{t(`office.desktop.install.os.${group.os}`)}</h4>
          {group.os === own && <Badge className="ver-badge is-own">{t("landing.apps.download.device")}</Badge>}
          <Badge className={cn("ver-badge", signed ? "is-signed" : "is-unsigned")}>{signed ? <ShieldCheck aria-hidden /> : <ShieldAlert aria-hidden />}{t(signed ? "landing.office.versions.signed" : "landing.office.versions.unsigned")}</Badge>
        </header>
        <ul className="ver-files">{group.assets.map((asset, row) => <FileRow key={asset.file} asset={asset} primary={lead && index === 0 && row === 0} />)}</ul>
        {!signed && <p className="ver-os-note"><Info aria-hidden /><span>{t(`landing.office.versions.unsignedNote.${group.os}`)}</span></p>}
      </section>;
    })}
    {checksums && <p className="ver-checksums"><a href={checksums.url} download>{t("landing.office.versions.checksums", { file: checksums.file })}</a></p>}
  </div>;
}
