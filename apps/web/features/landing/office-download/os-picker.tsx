"use client";
import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { DesktopOS } from "@uniwork/core/office";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@uniwork/ui/components/ui/collapsible";
import { RadioGroup, RadioGroupItem } from "@uniwork/ui/components/ui/radio-group";
import { cn } from "@uniwork/ui/lib/utils";
import { OsMark } from "../apps/os-marks";
import { BuildButton, HINT, ordered, requirementKey } from "./build-meta";
import { OS_ORDER, type DlFile, type FileId, type ReleaseChannel } from "./manifest";

interface PickerMeta { version?: string; channel?: ReleaseChannel }

/** Both pickers are radio groups drawn as tiles: the radio fills the tile, the tile's own text is decorative (the radio carries name and hint). */
const TILE = "absolute inset-0 aspect-auto size-full rounded-2xl border-input bg-background after:inset-0 hover:border-muted-foreground data-checked:border-brand data-checked:bg-brand-subtle data-checked:text-foreground dark:bg-background dark:data-checked:bg-brand-subtle focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:ring-0 [&>[data-slot=radio-group-indicator]]:hidden";

/** The OS the picker opens on: the first one that is not the visitor's own. */
function firstOther(present: readonly DesktopOS[], own: DesktopOS): DesktopOS {
  return present.find((os) => os !== own) ?? own;
}

function Requirements({ file, meta }: { file: DlFile; meta: PickerMeta }) {
  const { t } = useTranslation();
  return <div className="office-dl-picker-info">
    <p>{t("office.desktop.install.requirements", { value: t(requirementKey(file.id)) })}</p>
    {meta.version && <p className="office-dl-picker-version">{meta.channel ? t("office.desktop.install.version_line", { version: meta.version, channel: t(`landing.office.download.channel.${meta.channel}`) }) : t("landing.office.download.version", { version: meta.version })}</p>}
  </div>;
}

/**
 * "Nền tảng khác" (UNI-2098 r5): one quiet row, closed by default. Opened it is
 * the picker the in-app installer already uses: the three systems as tiles
 * (the visitor's own tagged "Đề xuất"), the picked system's builds as chips, one
 * soft info box and one outline download button. Linux adds the apt block.
 * Only drawn beside a spotlight; with no known system the three cards stay.
 */
export function OsPicker({ files, meta, own, chip, apt }: { files: readonly DlFile[]; meta: PickerMeta; own: DesktopOS; chip: FileId | null; apt?: ReactNode }) {
  const { t } = useTranslation();
  const present = OS_ORDER.filter((os) => files.some((file) => file.os === os));
  const [open, setOpen] = useState(false);
  const [os, setOs] = useState<DesktopOS>(() => firstOther(present, own));
  const [picked, setPicked] = useState<Partial<Record<DesktopOS, FileId>>>({});
  const builds = ordered(files.filter((file) => file.os === os), os === own ? chip : null);
  const file = builds.find((build) => build.id === picked[os]) ?? builds[0];
  const macHelp = os === "macos" && builds.length > 1 && !(os === own && chip);
  return <Collapsible className="office-dl-others is-secondary" open={open} onOpenChange={setOpen}>
    <h3 className="office-dl-others-title">
      <CollapsibleTrigger className="office-dl-others-trigger">
        <span>{t("landing.apps.download.others")}</span>
        <span className="office-dl-others-marks" aria-hidden>{present.map((name) => <OsMark key={name} os={name} />)}</span>
        <ChevronDown aria-hidden />
      </CollapsibleTrigger>
    </h3>
    <CollapsibleContent className="office-dl-picker">
      <div className="office-dl-picker-pick">
        <RadioGroup aria-label={t("office.desktop.install.os_group")} value={os} onValueChange={(value) => setOs(value as DesktopOS)} className="office-dl-tiles">
          {present.map((name) => <div key={name} className="office-dl-tile" data-os={name}>
            <RadioGroupItem value={name} aria-label={t(`office.desktop.install.os.${name}`)} className={TILE} />
            {name === own && <span className="office-dl-tile-tag" aria-hidden>{t("landing.office.download.picker.recommended")}</span>}
            <span className="office-dl-tile-body" aria-hidden><OsMark os={name} /><span>{t(`office.desktop.install.os.${name}`)}</span></span>
          </div>)}
        </RadioGroup>
        <p className="office-dl-picker-label">{t("office.desktop.install.format_group")}</p>
        <RadioGroup aria-label={t("office.desktop.install.format_group")} value={file?.id ?? ""} onValueChange={(value) => setPicked((now) => ({ ...now, [os]: value as FileId }))} className="office-dl-chip-row">
          {builds.map((build) => {
            const hint = HINT[build.id] ?? (build.id === "win" ? "office.desktop.install.fmt.win_exe_hint" : null);
            return <div key={build.id} className="office-dl-chip-pick">
              <RadioGroupItem value={build.id} aria-label={t(`landing.office.download.history.build.${build.id}`)} aria-description={hint ? t(hint) : undefined} className={cn(TILE, "rounded-xl")} />
              <span className="office-dl-chip-body" aria-hidden><strong>{t(`landing.office.download.history.build.${build.id}`)}</strong>{hint && <small>{t(hint)}</small>}</span>
            </div>;
          })}
        </RadioGroup>
        {macHelp && <p className="app-dl-help">{t("landing.apps.download.macHelp")}</p>}
      </div>
      {file && <div className="office-dl-picker-act">
        <Requirements file={file} meta={meta} />
        <BuildButton key={file.id} file={file} primary={false} hint={false} className="office-dl-picker-button" />
      </div>}
      {os === "linux" && os !== own && apt}
    </CollapsibleContent>
  </Collapsible>;
}
