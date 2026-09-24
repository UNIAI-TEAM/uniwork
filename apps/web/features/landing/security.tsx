"use client";
import { ArrowRight, Gauge, History, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@uniwork/ui/components/ui/accordion";
import { Container } from "./layout-primitives";

const SECURITY_GROUPS = [
  { key: "access", icon: ShieldCheck, items: [4, 3] },
  { key: "history", icon: History, items: [1, 2] },
  { key: "usage", icon: Gauge, items: [5, 6] },
] as const;

/** Claims remain mechanisms backed by the existing authorization and audit tests. */
export function Security() {
  const { t } = useTranslation();
  return (
    <section id="security" className="studio-section security-section dark text-foreground" aria-labelledby="security-title">
      <Container className="security-layout">
        <div className="security-copy">
          <h2 id="security-title" className="studio-title">{t("landing.studio.securityTitle")}</h2>
          <p className="studio-description">{t("landing.studio.securitySub")}</p>
          <Accordion className="security-mechanisms">{SECURITY_GROUPS.map(({ key, icon: Icon, items }) => (
            <AccordionItem className="security-mechanism" key={key} value={key}>
              <AccordionTrigger><span className="security-mechanism-label"><span className="security-mechanism-icon" aria-hidden><Icon /></span><span>{t(`landing.security.${key}Title`)}</span></span></AccordionTrigger>
              <AccordionContent><div className="security-detail">{items.map(n => (
                <div key={n}><h4>{t(`landing.security.i${n}Title`)}</h4><p>{t(`landing.security.i${n}Desc`)}</p></div>
              ))}</div></AccordionContent>
            </AccordionItem>
          ))}</Accordion>
        </div>
        <figure className="security-record">
          <figcaption><History aria-hidden />{t("landing.reference.auditSample")}</figcaption>
          <h3>{t("landing.studio.task_design")}</h3>
          <div className="security-record-heading">
            <span className="preview-avatar" aria-hidden>ML</span>
            <div><strong>{t("landing.reference.auditAction")}</strong><small>Minh Linh · human · <time>09:24</time></small></div>
          </div>
          <div className="security-record-diff">
            <div><small>{t("landing.reference.auditBefore")}</small><span>{t("landing.playback.unassigned")}</span></div>
            <ArrowRight aria-hidden />
            <div><small>{t("landing.reference.auditAfter")}</small><span><span className="preview-avatar" aria-hidden>HA</span>Hoàng Anh</span></div>
          </div>
          <dl>
            <div><dt>{t("landing.reference.auditScope")}</dt><dd>{t("landing.studio.productTeam")}</dd></div>
            <div><dt>{t("landing.reference.auditTrace")}</dt><dd>task.updated · UW-102</dd></div>
          </dl>
          <a className="security-explore" href="#nhat-ky">{t("landing.reference.viewAudit")}<ArrowRight aria-hidden /></a>
        </figure>
      </Container>
    </section>
  );
}
