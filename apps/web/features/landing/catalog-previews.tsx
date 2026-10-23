"use client";
import { ArrowRight, ScrollText } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export function AuditPreview() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState(0);
  const events = [{ name: "task.updated", actor: "Khánh Vy", time: "09:24" }, { name: "task.created", actor: "An Nhiên", time: "09:18" }, { name: "meeting.created", actor: "Gia Minh", time: "09:00" }];
  const event = events[selected]!;
  return <div className="catalog-preview">
    <div className="catalog-heading"><ScrollText aria-hidden /><div><h2>{t("landing.catalog.features.audit.label")}</h2><p>{t("landing.catalog.auditSub")}</p></div></div>
    <div className="catalog-event-list">{events.map((item, index) => <button type="button" key={item.name} aria-pressed={selected === index} onClick={() => setSelected(index)}><time>{item.time}</time><strong>{item.name}</strong><span>{item.actor}</span><ArrowRight aria-hidden /></button>)}</div>
    <dl className="catalog-properties audit-example-detail" aria-live="polite"><div><dt>{t("landing.catalog.event")}</dt><dd>{event.name}</dd></div><div><dt>{t("landing.catalog.actor")}</dt><dd>{event.actor} · human</dd></div><div><dt>{t("landing.catalog.trace")}</dt><dd>demo-trace-0{selected + 1}</dd></div></dl>
    <p className="catalog-note">{t("landing.catalog.auditNote")}</p>
  </div>;
}
