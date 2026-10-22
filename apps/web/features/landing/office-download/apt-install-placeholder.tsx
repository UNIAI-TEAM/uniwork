"use client";
import { ChevronDown } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@uniwork/ui/components/ui/collapsible";
import { OsMark } from "../apps/os-marks";
import { aptCommands, APT_KEY_ASC_URL } from "./apt-commands";
import { CopyButton } from "./copy-button";

function Step({ n, title, command }: { n: number; title: string; command: string }) {
  const { t } = useTranslation();
  return <li className="office-dl-apt-step">
    <div className="office-dl-apt-step-head"><span className="office-dl-apt-n" aria-hidden>{n}</span><h5>{title}</h5>
      <CopyButton value={command} text={t("landing.office.download.apt.copy")} label={t("landing.office.download.apt.copyStep", { title })} />
    </div>
    <pre className="office-dl-code"><code>{command}</code></pre>
  </li>;
}

/** One of the two equal ways in: a short label with its own copy button, and the command under it. No number, so it never reads as a step. */
function Way({ label, command, copyLabel }: { label: string; command: string; copyLabel: string }) {
  const { t } = useTranslation();
  return <div className="office-dl-apt-way">
    <div className="office-dl-apt-way-head"><h5>{label}</h5><CopyButton value={command} text={t("landing.office.download.apt.copy")} label={copyLabel} className="office-dl-copy-cmd" /></div>
    <pre className="office-dl-code"><code>{command}</code></pre>
  </div>;
}

/**
 * DESIGN-ONLY PLACEHOLDER of `<AptInstall suite>` (UNI-2097 owns the real
 * component at apps/web/features/landing/apps/apt-install.tsx and the commands
 * in packages/core/office/apt-repo.ts). Same single prop; UNI-2098 Step 2
 * deletes this file, `apt-commands.ts` and the `apt` copy, and imports the real
 * one. Compact and always rendered, with no feature flag: one sentence, TWO
 * equal ways in (install script, .deb), each with its own copy, and the three
 * manual steps folded away. r3: it renders
 * inside the Linux group, as an inset rather than a card of its own. The page decides
 * where it sits and which suite it gets, never what it says.
 */
export function AptInstall({ suite }: { suite: string }) {
  const { t } = useTranslation();
  const commands = aptCommands(suite);
  const titleId = useId();
  return <section className="office-dl-apt" aria-labelledby={titleId} data-design-placeholder="apt-install">
    <header className="office-dl-apt-head">
      <OsMark os="linux" />
      <h4 id={titleId}>{t("landing.office.download.apt.title")}</h4>
    </header>
    <p className="office-dl-apt-line">{t("landing.office.download.apt.line")}</p>
    <div className="office-dl-apt-ways">
      <Way label={t("landing.office.download.apt.script.label")} command={commands.script} copyLabel={t("landing.office.download.apt.script.copyAria")} />
      <p className="office-dl-apt-or" aria-hidden>{t("landing.office.download.apt.or")}</p>
      <Way label={t("landing.office.download.apt.deb.label")} command={commands.deb} copyLabel={t("landing.office.download.apt.deb.copyAria")} />
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
