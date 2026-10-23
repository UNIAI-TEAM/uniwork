"use client";

import { useState } from "react";
import { ChevronRight, Check, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DESKTOP_INSTALLER_COMMANDS, DESKTOP_INSTALLER_KINDS, type OfficeInstallerOption } from "@uniwork/core/office";
import { Button } from "@uniwork/ui/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@uniwork/ui/components/ui/collapsible";

function InstallerCommand({ command }: { command: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.desktop.install" });
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(command); setCopied(true); setCopyFailed(false); }
    catch { setCopyFailed(true); }
  };
  return <div className="mt-1 flex min-w-0 items-start gap-1">
    <code className="min-w-0 flex-1 break-all rounded bg-muted px-1 py-1 font-mono text-caption">{command}</code>
    <Button variant="ghost" size="icon-sm" aria-label={t(copied ? "copied" : "copy_command")} onClick={() => void copy()}>
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
    </Button>
    {copyFailed ? <span role="status" className="text-caption text-destructive">{t("copy_failed")}</span> : null}
  </div>;
}

/** Browsers quarantine the unsigned dmg, and macOS then reports it as damaged. */
function MacQuarantineNote({ command }: { command: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.desktop.install" });
  return <Collapsible className="mt-2">
    <CollapsibleTrigger render={<Button variant="ghost" className="group -ml-2 justify-start text-body" />}>
      <ChevronRight aria-hidden className="size-4 transition-transform group-data-panel-open:rotate-90 motion-reduce:transition-none" />{t("mac_blocked")}
    </CollapsibleTrigger>
    <CollapsibleContent>
      <div className="space-y-2 pl-2 pt-1 text-body text-foreground">
        <p>{t("mac_blocked_intro")}</p>
        <p>{t("mac_blocked_terminal")}</p>
        <InstallerCommand command={command} />
        <p>{t("mac_blocked_settings")}</p>
      </div>
    </CollapsibleContent>
  </Collapsible>;
}

export function InstallerInstructions({ installer, file, open, onOpenChange }: {
  installer: OfficeInstallerOption; file: string; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.desktop.install" });
  const steps = DESKTOP_INSTALLER_KINDS[installer.platform].steps.filter((key) => installer.unsigned || !key.endsWith("unsigned"));
  // Single-quote actual release filenames before putting them into shell commands.
  const quoted = "'" + file.replaceAll("'", "'\\''") + "'";
  return <Collapsible open={open} onOpenChange={onOpenChange}>
    <CollapsibleTrigger render={<Button variant="ghost" className="group -ml-2 justify-start text-body" />}>
      <ChevronRight aria-hidden className="size-4 transition-transform group-data-panel-open:rotate-90 motion-reduce:transition-none" />{t("after_download")}
    </CollapsibleTrigger>
    <CollapsibleContent>
      <ol className="list-decimal space-y-2 pl-5 pt-2 text-body text-foreground">
        {steps.map((key) => <li key={key}>
          {t(`steps.${key}`, { file })}
          {DESKTOP_INSTALLER_COMMANDS[key] ? <InstallerCommand command={DESKTOP_INSTALLER_COMMANDS[key].replaceAll("{{file}}", quoted)} /> : null}
        </li>)}
      </ol>
      {DESKTOP_INSTALLER_KINDS[installer.platform].os === "macos" && installer.unsigned
        && DESKTOP_INSTALLER_COMMANDS.mac_quarantine
        ? <MacQuarantineNote command={DESKTOP_INSTALLER_COMMANDS.mac_quarantine.replaceAll("{{file}}", quoted)} /> : null}
    </CollapsibleContent>
  </Collapsible>;
}
