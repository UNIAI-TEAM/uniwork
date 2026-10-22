"use client";
import { Check, ChevronRight, Copy } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { APT_KEY_FINGERPRINT, aptInstallCommands, aptQuickInstallCommand, aptScriptInstallCommand, selectOfficeInstallerChannel, type AptSuite } from "@uniwork/core/office";
import { usePublicConfig } from "@uniwork/core/feature-flags";
import { Button } from "@uniwork/ui/components/ui/button";
import { copyText } from "@uniwork/ui/lib/clipboard";
import "./apt-install.css";

function CommandBlock({ label, command, note }: { label: string; command: string; note?: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    setState((await copyText(command)) ? "copied" : "failed");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2500);
  }
  return <div className="apt-block">
    <div className="apt-block-head">
      <h4>{label}</h4>
      <span className="apt-head-end">
        <span aria-live="polite" className={state === "idle" ? "sr-only" : state === "failed" ? "apt-status is-failed" : "apt-status"}>{state === "copied" ? t("landing.office.apt.copied") : state === "failed" ? t("landing.office.apt.copyFailed") : ""}</span>
        <Button type="button" variant="outline" size="sm" aria-label={t("landing.office.apt.copy", { step: label })} onClick={() => { void copy(); }}>
          {state === "copied" ? <Check aria-hidden className="text-success" /> : <Copy aria-hidden />}
        </Button>
      </span>
    </div>
    <pre className="apt-code"><code>{command}</code></pre>
    {note ? <p className="apt-note">{note}</p> : null}
  </div>;
}

/**
 * "Install with apt" (UNI-2097, UNI-2114): two ways side by side, the install
 * script and the .deb download, with the manual repository steps folded below;
 * always shown. The commands come from the shared apt module in
 * @uniwork/core/office, and the block fetches nothing itself. The suite defaults
 * to the channel this page already selects, else "dev"; a page that knows better
 * (the versions tab) passes it. A stable suite is shown only while the catalogue
 * publishes stable: otherwise the block falls back to the selected channel, else "dev".
 */
export function AptInstall({ suite }: { suite?: AptSuite }) {
  const { t } = useTranslation();
  const titleId = useId();
  const installers = usePublicConfig().data?.office_installers;
  const selected = selectOfficeInstallerChannel(installers);
  const requested = suite ?? selected ?? "dev";
  const aptSuite = requested === "stable" && !installers?.stable?.length ? (selected ?? "dev") : requested;
  const lines = aptInstallCommands(aptSuite);
  return <section className="apt-install" aria-labelledby={titleId}>
    <h3 id={titleId}>{t("landing.office.apt.title")}</h3>
    <p className="apt-intro">{t("landing.office.apt.intro")}</p>
    <CommandBlock label={t("landing.office.apt.script")} command={aptScriptInstallCommand(aptSuite)} note={t("landing.office.apt.scriptNote")} />
    <CommandBlock label={t("landing.office.apt.quick")} command={aptQuickInstallCommand(aptSuite)} note={t("landing.office.apt.quickNote")} />
    <details className="apt-manual">
      <summary><ChevronRight aria-hidden className="apt-chevron" />{t("landing.office.apt.manual")}</summary>
      <div className="apt-manual-body">
        <CommandBlock label={t("landing.office.apt.setup")} command={lines.slice(0, -1).join("\n")} />
        <p className="apt-note">{t("landing.office.apt.deb")}</p>
        <CommandBlock label={t("landing.office.apt.install")} command={lines.at(-1)!} />
        <p className="apt-note">{t("landing.office.apt.fingerprint")}: <code>{APT_KEY_FINGERPRINT}</code></p>
      </div>
    </details>
  </section>;
}
