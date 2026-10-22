"use client";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { selectOfficeInstallerChannel } from "@uniwork/core/office";
import { usePublicConfig } from "@uniwork/core/feature-flags";
import { Button } from "@uniwork/ui/components/ui/button";
import { copyText } from "@uniwork/ui/lib/clipboard";
import "./apt-install.css";

/** The apt repository lives under the same origin as the installers it indexes. */
const DOWNLOADS = "https://uniworkos.com/downloads/office/";
const KEYRING = "/usr/share/keyrings/uniwork-office-archive-keyring.gpg";
const SOURCE = "/etc/apt/sources.list.d/uniwork-office.sources";
const FINGERPRINT = "58A9 0232 2C8D 45C4 33B5 25F5 1198 D109 26F3 4831";
const INSTALL = "sudo apt update && sudo apt install uniwork-office";

/** Key and deb822 source for one channel; the suite is named after the channel. */
function setupCommands(suite: string): string {
  return [
    `curl -fsSL ${DOWNLOADS}apt/key.gpg | sudo tee ${KEYRING} > /dev/null`,
    `sudo tee ${SOURCE} > /dev/null <<'EOF'`,
    "Types: deb",
    `URIs: ${DOWNLOADS}apt`,
    `Suites: ${suite}`,
    "Components: main",
    "Architectures: amd64",
    `Signed-By: ${KEYRING}`,
    "EOF",
  ].join("\n");
}

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
    <span role="status" className={state === "failed" ? "apt-status is-failed" : "sr-only"}>{state === "copied" ? t("landing.office.apt.copied") : state === "failed" ? t("landing.office.apt.copyFailed") : ""}</span>
  </div>;
}

/**
 * "Install with apt" for /apps/office (UNI-2097). It appears only once the
 * published Linux deb is served from the downloads origin, so a catalogue that
 * still points elsewhere never shows a repository that does not exist yet.
 * The suite in the source file is the catalogue's channel.
 */
export function AptInstall() {
  const { t } = useTranslation();
  const channels = usePublicConfig().data?.office_installers;
  const channel = selectOfficeInstallerChannel(channels);
  const deb = channel ? channels?.[channel]?.find((row) => row.platform === "linux-x64-deb") : undefined;
  if (!channel || !deb?.url.startsWith(DOWNLOADS)) return null;
  return <section className="apt-install" aria-labelledby="office-apt-title">
    <h3 id="office-apt-title">{t("landing.office.apt.title")}</h3>
    <p className="apt-intro">{t("landing.office.apt.intro")}</p>
    <CommandBlock label={t("landing.office.apt.setup")} command={setupCommands(channel)} />
    <CommandBlock label={t("landing.office.apt.install")} command={INSTALL} />
    <p className="apt-note">{t("landing.office.apt.deb")}</p>
    <p className="apt-note">{t("landing.office.apt.fingerprint")}: <code>{FINGERPRINT}</code></p>
  </section>;
}
