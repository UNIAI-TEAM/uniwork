"use client";
import { Check, ChevronDown, Copy } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { APT_KEY_FINGERPRINT, aptInstallCommands, aptQuickInstallCommand, aptScriptInstallCommand, selectOfficeInstallerChannel, type AptSuite } from "@uniwork/core/office";
import { usePublicConfig } from "@uniwork/core/feature-flags";
import { Button } from "@uniwork/ui/components/ui/button";
import { copyText } from "@uniwork/ui/lib/clipboard";
import { AptCode } from "./apt-code";
import { OsMark } from "./os-marks";
import "./apt-install.css";

function CommandBlock({ label, command }: { label: string; command: string }) {
  const { t } = useTranslation();
  const copyLabel = t("landing.office.apt.copy");
  const copiedLabel = t("landing.office.apt.copied");
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
      <h5>{label}</h5>
      <Button type="button" variant="outline" size="sm" className="apt-copy" data-copied={state === "copied" || undefined} aria-label={t("landing.office.apt.copyStep", { step: label })} onClick={() => { void copy(); }}>
        {state === "copied" ? <Check aria-hidden /> : <Copy aria-hidden />}
        {/* The button is as wide as the longer label whichever one shows, so the row never shifts. */}
        <span className="apt-copy-label" data-widest={copiedLabel.length > copyLabel.length ? copiedLabel : copyLabel}>{state === "copied" ? copiedLabel : copyLabel}</span>
      </Button>
    </div>
    <AptCode command={command} />
    {/* "Đã sao chép" is already the button's visible text; a failure needs its own visible line. */}
    <p aria-live="polite" className={state === "failed" ? "apt-status is-failed" : "sr-only"}>{state === "copied" ? copiedLabel : state === "failed" ? t("landing.office.apt.copyFailed") : ""}</p>
  </div>;
}

/**
 * "Install with apt" (UNI-2097, UNI-2114), drawn as the Download section's
 * Linux inset (UNI-2098 r6): two equal ways side by side, the install script
 * and the .deb download, with the manual repository steps folded below. The
 * commands come from the shared apt module in @uniwork/core/office, and the
 * block fetches nothing itself. The suite defaults to the channel the public
 * config selects, else "dev"; the section passes the channel it shows. A
 * stable suite is shown only while the catalogue publishes stable: otherwise
 * the block falls back to the selected channel, else "dev".
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
    <header className="apt-head">
      <OsMark os="linux" />
      <h4 id={titleId}>{t("landing.office.apt.title")}</h4>
    </header>
    <p className="apt-intro">{t("landing.office.apt.intro")}</p>
    <div className="apt-ways">
      <CommandBlock label={t("landing.office.apt.script")} command={aptScriptInstallCommand(aptSuite)} />
      <p className="apt-or" aria-hidden>{t("landing.office.apt.or")}</p>
      <CommandBlock label={t("landing.office.apt.quick")} command={aptQuickInstallCommand(aptSuite)} />
    </div>
    <details className="apt-manual">
      <summary>{t("landing.office.apt.manual")}<ChevronDown aria-hidden className="apt-chevron" /></summary>
      <div className="apt-manual-body">
        <CommandBlock label={t("landing.office.apt.setup")} command={lines.slice(0, -1).join("\n")} />
        <p className="apt-note">{t("landing.office.apt.deb")}</p>
        <CommandBlock label={t("landing.office.apt.install")} command={lines.at(-1)!} />
        <p className="apt-note">{t("landing.office.apt.fingerprint")}: <code>{APT_KEY_FINGERPRINT}</code></p>
      </div>
    </details>
  </section>;
}
