"use client";
import { ChevronDown, Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@uniwork/ui/components/ui/collapsible";
import { aptCommands, APT_KEY_ASC_URL } from "./apt-commands";
import { CopyButton } from "./copy-button";

function Step({ n, title, command }: { n: number; title: string; command: string }) {
  const { t } = useTranslation();
  return <li className="office-dl-apt-step">
    <div className="office-dl-apt-step-head"><span className="office-dl-apt-n" aria-hidden>{n}</span><h4>{title}</h4>
      <CopyButton value={command} text={t("landing.office.download.apt.copy")} label={t("landing.office.download.apt.copyStep", { title })} />
    </div>
    <pre className="office-dl-code"><code>{command}</code></pre>
  </li>;
}

/**
 * DESIGN-ONLY PLACEHOLDER of `<AptInstall suite>` (UNI-2097 owns the real
 * component at apps/web/features/landing/apps/apt-install.tsx and the commands
 * in packages/core/office/apt-repo.ts). Same single prop; UNI-2098 Step 2
 * deletes this file, `apt-commands.ts` and the `apt` copy, and imports the real
 * one. Compact and always rendered, with no feature flag: one sentence, ONE
 * copyable command, and the three manual steps folded away. The page decides
 * where it sits and which suite it gets, never what it says.
 */
export function AptInstall({ suite }: { suite: string }) {
  const { t } = useTranslation();
  const commands = aptCommands(suite);
  return <section className="office-dl-apt" aria-labelledby="office-dl-apt-title" data-design-placeholder="apt-install">
    <header className="office-dl-apt-head">
      <span className="office-dl-tile" aria-hidden><Terminal /></span>
      <div><h3 id="office-dl-apt-title">{t("landing.office.download.apt.title")}</h3><p>{t("landing.office.download.apt.line")}</p></div>
    </header>
    <div className="office-dl-apt-cmd">
      <pre className="office-dl-code"><code>{commands.oneLine}</code></pre>
      <CopyButton value={commands.oneLine} text={t("landing.office.download.apt.copy")} label={t("landing.office.download.apt.copyAria")} className="office-dl-copy-cmd" />
    </div>
    <Collapsible className="office-dl-manual">
      <CollapsibleTrigger className="office-dl-manual-trigger">{t("landing.office.download.apt.manual")}<ChevronDown aria-hidden /></CollapsibleTrigger>
      <CollapsibleContent className="office-dl-manual-panel">
        <ol className="office-dl-apt-steps">
          <Step n={1} title={t("landing.office.download.apt.step1")} command={commands.key} />
          <Step n={2} title={t("landing.office.download.apt.step2", { suite })} command={commands.source} />
          <Step n={3} title={t("landing.office.download.apt.step3")} command={commands.install} />
        </ol>
        <div className="office-dl-apt-foot">
          <CopyButton value={commands.manual} text={t("landing.office.download.apt.copyAll")} label={t("landing.office.download.apt.copyAll")} className="office-dl-copy-all" />
          <a href={APT_KEY_ASC_URL}>{t("landing.office.download.apt.keyAsc")}</a>
        </div>
      </CollapsibleContent>
    </Collapsible>
  </section>;
}
