"use client";
import { Check, Copy } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { APT_KEY_FINGERPRINT, aptInstallCommands, aptQuickInstallCommand, selectOfficeInstallerChannel, type AptSuite } from "@uniwork/core/office";
import { usePublicConfig } from "@uniwork/core/feature-flags";
import { Button } from "@uniwork/ui/components/ui/button";
import { copyText } from "@uniwork/ui/lib/clipboard";
import "./apt-install.css";

function CommandBlock({ label, command }: { label: string; command: string }) {
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
  </div>;
}

/**
 * "Install with apt" (UNI-2097): one command that installs the app (the .deb adds
 * the repository itself), with the manual repository steps folded below; always
 * shown. The commands come from the shared apt module in @uniwork/core/office,
 * and the block fetches nothing itself. The suite defaults to the channel this page already selects, else "dev"; a page
 * that knows better (the versions tab) passes it.
 */
export function AptInstall({ suite }: { suite?: AptSuite }) {
  const { t } = useTranslation();
  const titleId = useId();
  const selected = selectOfficeInstallerChannel(usePublicConfig().data?.office_installers);
  const aptSuite = suite ?? selected ?? "dev";
  const lines = aptInstallCommands(aptSuite);
  return <section className="apt-install" aria-labelledby={titleId}>
    <h3 id={titleId}>{t("landing.office.apt.title")}</h3>
    <p className="apt-intro">{t("landing.office.apt.intro")}</p>
    <CommandBlock label={t("landing.office.apt.quick")} command={aptQuickInstallCommand(aptSuite)} />
    <details className="apt-manual">
      <summary>{t("landing.office.apt.manual")}</summary>
      <div className="apt-manual-body">
        <CommandBlock label={t("landing.office.apt.setup")} command={lines.slice(0, -1).join("\n")} />
        <p className="apt-note">{t("landing.office.apt.deb")}</p>
        <CommandBlock label={t("landing.office.apt.install")} command={lines.at(-1)!} />
        <p className="apt-note">{t("landing.office.apt.fingerprint")}: <code>{APT_KEY_FINGERPRINT}</code></p>
      </div>
    </details>
  </section>;
}
