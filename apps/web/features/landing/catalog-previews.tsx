"use client";
import { ArrowRight, Bot, Check, Clock3, FileText, FolderKanban, GitBranch, LockKeyhole, ScrollText, Users } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { PRODUCT_FEATURES, type ProductFeature } from "./showcase";
import { CalendarReference } from "./reference-previews";

export function ProjectsPreview({ completed, total, onTasks }: { completed: number; total: number; onTasks: () => void }) {
  const { t } = useTranslation();
  const [view, setView] = useState("overview");
  return <div className="catalog-preview project-catalog-preview">
    <div className="catalog-heading"><FolderKanban aria-hidden /><div><h2>{t("landing.studio.launchProject")}</h2><p>{t("landing.catalog.projectSub")}</p></div></div>
    <div className="catalog-local-tabs">{["overview", "resources"].map(key => <Button key={key} variant={view === key ? "secondary" : "ghost"} size="sm" aria-pressed={view === key} onClick={() => setView(key)}>{t(`landing.catalog.${key}`)}</Button>)}</div>
    {view === "overview" ? <div>
      <div className="project-progress-example"><div><strong>{t("landing.catalog.progress")}</strong><span>{completed}/{total}</span></div><progress value={completed} max={total} aria-label={t("landing.catalog.progress")} /></div>
      <dl className="catalog-properties"><div><dt>{t("landing.catalog.lead")}</dt><dd>Hoàng Anh</dd></div><div><dt>{t("tasks.status")}</dt><dd>in_progress</dd></div><div><dt>{t("landing.catalog.scope")}</dt><dd>{t("landing.studio.productTeam")}</dd></div></dl>
      <h3>{t("landing.catalog.projectViews")}</h3><ul className="catalog-view-list">{["board", "list", "table", "gantt", "swimlane"].map(key => <li key={key}><Check aria-hidden />{t(`landing.catalog.views.${key}`)}</li>)}</ul>
      <Button variant="outline" onClick={onTasks}>{t("landing.catalog.openTasks")}<ArrowRight aria-hidden /></Button>
    </div> : <div className="catalog-resource-list">{["brief", "design", "review"].map(key => <div key={key}><FileText aria-hidden /><span>{t(`landing.studio.task_${key}`)}<small>{t("landing.catalog.linkedResource")}</small></span></div>)}<p>{t("landing.catalog.resourceNote")}</p></div>}
  </div>;
}

export function OrganizationPreview() {
  const { t } = useTranslation();
  const [scope, setScope] = useState("organization");
  return <div className="catalog-preview organization-preview">
    <div className="catalog-heading"><Users aria-hidden /><div><h2>{t("landing.catalog.features.organization.label")}</h2><p>{t("landing.catalog.peopleSub")}</p></div></div>
    <div className="catalog-local-tabs">{["organization", "workspace"].map(key => <Button key={key} variant={scope === key ? "secondary" : "ghost"} aria-pressed={scope === key} onClick={() => setScope(key)}>{t(`landing.catalog.scopes.${key}`)}</Button>)}</div>
    <ul className="catalog-people">{[{ name: "Minh Linh", initials: "ML", role: "owner" }, { name: "Hoàng Anh", initials: "HA", role: "admin" }, { name: "Thanh Ngân", initials: "TN", role: "member" }].map(person => <li key={person.role}><span className="preview-avatar">{person.initials}</span><strong>{person.name}</strong><span>{person.role}</span></li>)}</ul>
    <div className="catalog-permission"><LockKeyhole aria-hidden /><div><h3>{t(`landing.catalog.permission.${scope}`)}</h3><p>{t(`landing.catalog.permission.${scope}Note`)}</p></div></div>
  </div>;
}

export function AuditPreview() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState(0);
  const events = [{ name: "task.updated", actor: "Hoàng Anh", time: "09:24" }, { name: "task.created", actor: "Minh Linh", time: "09:18" }, { name: "meeting.created", actor: "Thanh Ngân", time: "09:00" }];
  const event = events[selected]!;
  return <div className="catalog-preview">
    <div className="catalog-heading"><ScrollText aria-hidden /><div><h2>{t("landing.catalog.features.audit.label")}</h2><p>{t("landing.catalog.auditSub")}</p></div></div>
    <div className="catalog-event-list">{events.map((item, index) => <button type="button" key={item.name} aria-pressed={selected === index} onClick={() => setSelected(index)}><time>{item.time}</time><strong>{item.name}</strong><span>{item.actor}</span><ArrowRight aria-hidden /></button>)}</div>
    <dl className="catalog-properties audit-example-detail" aria-live="polite"><div><dt>{t("landing.catalog.event")}</dt><dd>{event.name}</dd></div><div><dt>{t("landing.catalog.actor")}</dt><dd>{event.actor} · human</dd></div><div><dt>{t("landing.catalog.trace")}</dt><dd>demo-trace-0{selected + 1}</dd></div></dl>
    <p className="catalog-note">{t("landing.catalog.auditNote")}</p>
  </div>;
}

export function AgentsPreview() {
  const { t } = useTranslation();
  return <div className="catalog-preview">
    <div className="catalog-heading"><Bot aria-hidden /><div><h2>{t("landing.catalog.features.agents.label")}</h2><p>{t("landing.catalog.features.agents.description")}</p></div></div>
    <div className="agent-identity-example"><span className="agent-avatar">UNI</span><div><h3>{t("landing.catalog.agentIdentity")}</h3><p>{t("landing.catalog.agentIdentityNote")}</p></div></div>
    <dl className="catalog-properties"><div><dt>{t("landing.catalog.actor")}</dt><dd>agent</dd></div><div><dt>{t("landing.catalog.lead")}</dt><dd>Hoàng Anh</dd></div><div><dt>{t("landing.catalog.scope")}</dt><dd>{t("landing.studio.productTeam")}</dd></div></dl>
    <div className="planned-notice"><Clock3 aria-hidden /><p>{t("landing.catalog.agentLimit")}</p></div>
  </div>;
}

/** These are concept outlines, never working controls for unshipped modules. */
export function PlannedPreview({ featureKey }: { featureKey: ProductFeature }) {
  const { t } = useTranslation();
  const feature = PRODUCT_FEATURES.find(item => item.key === featureKey)!;
  const Icon = feature.icon;
  return <div className="catalog-preview planned-preview" data-concept={featureKey}>
    <div className="catalog-heading"><Icon aria-hidden /><div><h2>{t(feature.label)}</h2><p>{t(feature.description)}</p></div></div>
    <div className="planned-notice"><Clock3 aria-hidden /><p>{t("landing.catalog.plannedNotice")}</p></div>
    {featureKey === "calendar" ? <CalendarReference /> : <div className="concept-outline">
      <h3>{t("landing.catalog.concept")}</h3>
      <ol>{[1, 2, 3].map(index => <li key={index}><span className="concept-node">{featureKey === "documents" || featureKey === "outputs" ? <FileText aria-hidden /> : <GitBranch aria-hidden />}</span><div><strong>{t(`landing.catalog.features.${featureKey}.step${index}`)}</strong><p>{t(`landing.catalog.features.${featureKey}.detail${index}`)}</p></div>{index < 3 && <ArrowRight className="concept-next" aria-hidden />}</li>)}</ol>
    </div>}
    <a className="catalog-roadmap-link" href="#lo-trinh">{t("landing.catalog.viewRoadmap")}<ArrowRight aria-hidden /></a>
  </div>;
}
