"use client";
import { ArrowLeftRight, ArrowRight, Cloud, KeyRound, Laptop, ShieldCheck, UserRound } from "lucide-react";
import { MarketingLink as Link } from "../../platform/marketing-link";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@uniwork/ui/components/ui/accordion";

const PRINCIPLES = [{ key: "account", icon: UserRound }, { key: "ai", icon: KeyRound }, { key: "permissions", icon: ShieldCheck }] as const;

/** Distinguish storage choices and AI routing without implying automatic file sync. */
export function OfficeConnection() {
  const { t } = useTranslation();
  return <section className="office-section chapter-width office-connection" aria-labelledby="office-ai-title">
    <div className="office-connection-grid">
      <div>
        <div className="office-heading"><h2 id="office-ai-title">{t("landing.office.connection.title")}</h2><p>{t("landing.office.connection.sub")}</p></div>
        <ul className="office-connection-points">{PRINCIPLES.map(({ key, icon: Icon }) => <li key={key}>
          <Icon aria-hidden /><div><h3>{t(`landing.office.connection.${key}.title`)}</h3><p>{t(`landing.office.connection.${key}.description`)}</p></div>
        </li>)}</ul>
      </div>
      <figure className="office-file-flow" aria-labelledby="office-file-flow-title">
        <figcaption id="office-file-flow-title">{t("landing.office.connection.flow.title")}</figcaption>
        <div className="office-file-flow-nodes">
          <div className="office-file-node"><Laptop aria-hidden /><h3>{t("landing.office.connection.flow.local")}</h3><p>{t("landing.office.connection.flow.localDescription")}</p></div>
          <div className="office-file-bridge"><ArrowLeftRight aria-hidden /><span>{t("landing.office.connection.flow.action")}</span></div>
          <div className="office-file-node"><Cloud aria-hidden /><h3>{t("landing.office.connection.flow.workspace")}</h3><p>{t("landing.office.connection.flow.workspaceDescription")}</p></div>
        </div>
        <p className="office-file-flow-note">{t("landing.office.connection.flow.note")}</p>
      </figure>
    </div>
    <Accordion className="office-connection-details">
      <AccordionItem value="ai"><AccordionTrigger>{t("landing.office.connection.details.ai")}</AccordionTrigger><AccordionContent className="office-connection-details-copy"><p>{t("landing.office.ai.account.description")}</p><p>{t("landing.office.faq.a4")}</p></AccordionContent></AccordionItem>
      <AccordionItem value="files"><AccordionTrigger>{t("landing.office.connection.details.files")}</AccordionTrigger><AccordionContent className="office-connection-details-copy"><p>{t("landing.office.ai.files.description")}</p></AccordionContent></AccordionItem>
    </Accordion>
    <Link className="chapter-link" href={paths.enterprise()}>{t("landing.office.ai.link")}<ArrowRight aria-hidden /></Link>
  </section>;
}
