"use client";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { APT_KEY_FINGERPRINT, aptInstallCommands, selectOfficeInstallerChannel, type AptSuite } from "@uniwork/core/office";
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
      <Button type="button" variant="outline" size="sm" aria-label={t("landing.office.apt.copy", { step: label })} onClick={() => { void copy(); }}>
        {state === "copied" ? <Check aria-hidden className="text-success" /> : <Copy aria-hidden />}
      </Button>
    </div>
    <pre className="apt-code"><code>{command}</code></pre>
    <span aria-live="polite" className={state === "failed" ? "apt-status is-failed" : "sr-only"}>{state === "copied" ? t("landing.office.apt.copied") : state === "failed" ? t("landing.office.apt.copyFailed") : ""}</span>
  </div>;
}

/**
 * "Install with apt" (UNI-2097): the steps to add the UniWork Office repository
 * and install the app, always shown. The commands come from the shared apt
 * module in @uniwork/core/office, and the block fetches nothing itself. The
 * suite defaults to the channel this page already selects, else "dev"; a page
 * that knows better (the versions tab) passes it.
 */
export function AptInstall({ suite }: { suite?: AptSuite }) {
  const { t } = useTranslation();
  const selected = selectOfficeInstallerChannel(usePublicConfig().data?.office_installers);
  const lines = aptInstallCommands(suite ?? selected ?? "dev");
  return <section className="apt-install" aria-labelledby="office-apt-title">
    <h3 id="office-apt-title">{t("landing.office.apt.title")}</h3>
    <p className="apt-intro">{t("landing.office.apt.intro")}</p>
    <CommandBlock label={t("landing.office.apt.setup")} command={lines.slice(0, -1).join("\n")} />
    <CommandBlock label={t("landing.office.apt.install")} command={lines.at(-1)!} />
    <p className="apt-note">{t("landing.office.apt.deb")}</p>
    <p className="apt-note">{t("landing.office.apt.fingerprint")}: <code>{APT_KEY_FINGERPRINT}</code></p>
  </section>;
}
