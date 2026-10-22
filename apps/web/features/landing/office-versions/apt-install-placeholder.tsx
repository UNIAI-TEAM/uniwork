"use client";
import { Info, Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { aptCommands, APT_KEY_ASC_URL, APT_UPGRADE } from "./apt-commands";
import { CopyButton } from "./copy-button";

function Step({ n, title, command }: { n: number; title: string; command: string }) {
  const { t } = useTranslation();
  return <li className="ver-apt-step">
    <div className="ver-apt-step-head"><span className="ver-apt-n" aria-hidden>{n}</span><h4>{title}</h4>
      <CopyButton value={command} text={t("landing.office.versions.aptPlaceholder.copy")} label={t("landing.office.versions.aptPlaceholder.copyStep", { title })} />
    </div>
    <pre className="ver-code"><code>{command}</code></pre>
  </li>;
}

/**
 * DESIGN-ONLY PLACEHOLDER of `<AptInstall suite>` (UNI-2097 owns the real
 * component at apps/web/features/landing/apps/apt-install.tsx and the commands
 * in packages/core/office/apt-repo.ts). Same single prop; Step 2 deletes this
 * file, `apt-commands.ts` and the `aptPlaceholder` copy, and imports the real one.
 * Always rendered, with no feature flag: the page decides where it sits and
 * which suite it gets, never what it says.
 */
export function AptInstall({ suite }: { suite: string }) {
  const { t } = useTranslation();
  const commands = aptCommands(suite);
  return <section className="ver-card ver-apt" aria-labelledby="ver-apt-title" data-design-placeholder="apt-install">
    <header className="ver-card-head">
      <span className="ver-card-icon" aria-hidden><Terminal /></span>
      <div>
        <h3 id="ver-apt-title">{t("landing.office.versions.aptPlaceholder.title")}</h3>
        <p>{t("landing.office.versions.aptPlaceholder.sub")}</p>
      </div>
    </header>
    <ol className="ver-apt-steps">
      <Step n={1} title={t("landing.office.versions.aptPlaceholder.step1")} command={commands.key} />
      <Step n={2} title={t("landing.office.versions.aptPlaceholder.step2", { suite })} command={commands.source} />
      <Step n={3} title={t("landing.office.versions.aptPlaceholder.step3")} command={commands.install} />
    </ol>
    <div className="ver-apt-foot">
      <CopyButton value={commands.all} text={t("landing.office.versions.aptPlaceholder.copyAll")} label={t("landing.office.versions.aptPlaceholder.copyAll")} className="ver-copy-all" />
      <a href={APT_KEY_ASC_URL}>{t("landing.office.versions.aptPlaceholder.keyAsc")}</a>
    </div>
    <p className="ver-apt-note"><Info aria-hidden /><span>{t("landing.office.versions.aptPlaceholder.upgrade", { command: APT_UPGRADE })}</span></p>
    <p className="ver-apt-note"><Info aria-hidden /><span>{t("landing.office.versions.aptPlaceholder.deb")}</span></p>
  </section>;
}
