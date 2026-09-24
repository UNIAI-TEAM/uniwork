"use client";
import { ArrowDownToLine, ArrowRight, BookOpen, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, Clock3, FileText, Filter, Folder, Hash, History, List, LockKeyhole, MessageSquare, MoreHorizontal, Plus, Search, Share2, ShieldCheck, SlidersHorizontal, Sparkles, Star, Upload, Users, Video, Workflow } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PRODUCT_FEATURES, type ProductFeature } from "./showcase";
import { LovableControl, LovableFrame, LovablePageHeading, usePreviewLabels } from "./lovable-frame";
import { LovableDashboard, LovableMySpace } from "./lovable-overviews";
import { CalendarReference } from "./reference-previews";
import { AuditPreview } from "./catalog-previews";
import { LovableAgents, LovablePeople } from "./lovable-secondary";

/** Static UI references share the exact same desktop canvas as the action films. */
export function LovableReference({ feature }: { feature: ProductFeature }) {
  const { t } = useTranslation();
  const item = PRODUCT_FEATURES.find(value => value.key === feature)!;
  return <LovableFrame feature={feature} label={`${t(item.label)} — ${t("landing.lovable.sample")}`}>
    {feature === "dashboard" ? <LovableDashboard /> : feature === "today" ? <LovableMySpace /> : feature === "calendar" ? <LovableCalendar /> : feature === "projects" ? <LovableProjects /> : feature === "documents" ? <LovableDocuments /> : feature === "workflows" || feature === "automation" ? <LovableWorkflows /> : ["outputs", "approvals", "knowledge"].includes(feature) ? <LovableLibrary feature={feature} /> : feature === "organization" ? <LovablePeople /> : feature === "agents" ? <LovableAgents /> : <div className="lovable-page"><AuditPreview /></div>}
  </LovableFrame>;
}

export function LovableTaskHeading({ completed }: { completed: boolean }) {
  const copy = usePreviewLabels();
  return <div className="lovable-task-heading"><div className="lovable-project-tabs"><span className="lovable-workspace-pill"><i>G</i>General<ChevronDown /></span>{["overview", "board", "list", "timeline", "calendar", "reports", "files"].map(key => <span key={key} data-active={key === "board"}>{copy(key)}</span>)}<MoreHorizontal /></div><div className="lovable-breadcrumb">{copy("home")} › {copy("tasks")} › {copy("all")}</div><h2>{copy("allTasks")}</h2><LovablePageHeading title="General" subtitle={copy("taskSummary", { completed: completed ? 4 : 3 })}><LovableControl>General<ChevronDown /></LovableControl><LovableControl><SlidersHorizontal />{copy("projectSettings")}<ChevronDown /></LovableControl></LovablePageHeading>
    <div className="action-board-summary lovable-task-stats">{[["progress", completed ? "6%" : "5%"], ["tasks", "64"], ["done", completed ? "4" : "3"], ["inProgress", completed ? "8" : "9"], ["todo", "43"], ["blocked", "9"]].map(([key, value]) => <div key={key}><span>{copy(key!)}</span><strong>{value}</strong>{key === "progress" && <progress value={completed ? 4 : 3} max={64} />}{key === "tasks" && <small>{copy("overdue27")}</small>}</div>)}</div>
    <div className="lovable-saved-filter"><span>{copy("savedFilters")}<small>{copy("noSavedView")}</small></span><LovableControl><Plus />{copy("saveFilter")}</LovableControl></div><div className="lovable-task-filter"><span>{copy("filter")}</span><LovableControl>{copy("allPriorities")}<ChevronDown /></LovableControl><span>{copy("sort")}</span><LovableControl>{copy("default")}<ChevronDown /></LovableControl><span>{copy("noLabels")}</span></div>
  </div>;
}

export function LovableChatChannels() {
  const copy = usePreviewLabels();
  return <aside className="lovable-chat-channels"><header><strong>{copy("channels")}</strong><MessageSquare /><Plus /></header><div className="lovable-search-field"><Search />{copy("filterChannels")}</div><small>{copy("myChannels")}</small>{["product-launch", "general", "design", "engineering"].map((name, index) => <div className="lovable-channel" data-active={index === 0} key={name}><Hash />{name}</div>)}<small>{copy("otherChannels")}</small>{["operations", "people", "leadership"].map(name => <div className="lovable-channel" key={name}><LockKeyhole />{name}</div>)}</aside>;
}

function LovableCalendar() {
  const copy = usePreviewLabels();
  return <div className="lovable-page lovable-calendar-page"><aside className="lovable-calendar-intro"><LovablePageHeading title={copy("calendar")} subtitle={copy("calendarSub")} /><LovableControl primary><Plus />{copy("createEvent")}</LovableControl><LovableControl><ArrowDownToLine />{copy("exportCalendar")}</LovableControl><div className="lovable-card"><h3><Filter />{copy("filter")}</h3>{["meetings", "tasks", "deadlines", "upcoming", "completed", "highPriority"].map((key, i) => <div className="lovable-calendar-filter" key={key}><Check /><span className={`lovable-dot tone-${i % 4}`} />{copy(key)}<small>{[53,9,22,1,52,11][i]}</small></div>)}</div></aside><div className="lovable-calendar-stage"><div className="lovable-calendar-tools"><LovableControl>{copy("today")}</LovableControl><ChevronLeft /><ChevronRight /><strong>{copy("month")}</strong><span className="lovable-search-field"><Search />{copy("searchEvents")}</span><span className="lovable-primary">{copy("monthView")}</span><span>{copy("weekView")}</span></div><CalendarReference /></div></div>;
}

function LovableProjects() {
  const copy = usePreviewLabels();
  return <div className="lovable-page"><LovablePageHeading title={copy("projects")} subtitle={copy("projectsSub")}><LovableControl>General<ChevronDown /></LovableControl><LovableControl primary><Plus />{copy("createProject")}</LovableControl></LovablePageHeading><div className="lovable-list-filter"><span className="lovable-search-field"><Search />{copy("searchProjects")}</span><LovableControl>{copy("allStatuses")}<ChevronDown /></LovableControl></div><div className="lovable-project-list">{["launch", "onboarding", "operations"].map((key, index) => <section className="lovable-card" key={key}><header><Folder /><strong>{copy(key)}</strong><MoreHorizontal /></header><p>{copy("projectExample")}</p><div className="lovable-key-value"><span>{copy("tasks")}</span><strong>{[24,18,22][index]}</strong></div><div className="lovable-key-value"><span>{copy("progress")}</span><strong>{[67,40,25][index]}%</strong></div><progress value={[67,40,25][index]} max={100} /><footer><span className="action-avatar">HA</span><span className="action-avatar">ML</span><span>General</span><ArrowRight /></footer></section>)}</div></div>;
}

function LovableDocuments() {
  const copy = usePreviewLabels();
  return <div className="lovable-document-layout"><aside><div className="lovable-workspace-pill"><i>G</i>General<ChevronDown /></div><div className="lovable-search-field"><Search />{copy("quickFind")}<Plus /></div>{["launchBrief", "designGuide", "meetingNotes"].map((key, index) => <div className="lovable-document-link" key={key} data-active={index === 0}><FileText />{copy(key)}</div>)}</aside><article><div className="lovable-breadcrumb">{copy("home")} › {copy("documents")} › {copy("all")}</div><h2>{copy("allDocuments")}</h2><div className="lovable-document-toolbar"><span>General / {copy("launchBrief")}</span><LovableControl><Share2 />{copy("share")}</LovableControl><LovableControl>{copy("edit")}<ChevronDown /></LovableControl><MoreHorizontal /></div><h2>{copy("launchBrief")}</h2><p><Users />4 {copy("members")} · 24/09/2026</p><div className="lovable-editor-toolbar"><ChevronDown /><span>{copy("heading")}</span><strong>B</strong><em>I</em><u>U</u><List /><FileText /><MoreHorizontal /></div><div className="lovable-document-copy"><h3>{copy("projectGoal")}</h3><p>{copy("projectExample")}</p><h3>{copy("scope")}</h3>{["designGuide", "meetingNotes", "launchBrief"].map(key => <p key={key}><CircleCheck />{copy(key)}</p>)}<blockquote>{copy("documentNote")}</blockquote></div></article></div>;
}

function LovableWorkflows() {
  const copy = usePreviewLabels();
  return <div className="lovable-page"><LovablePageHeading title={copy("workflows")} subtitle={copy("workflowSub")}><LovableControl primary><Plus />{copy("newWorkflow")}</LovableControl><LovableControl><CalendarDays />{copy("runSchedule")}</LovableControl><LovableControl><History />{copy("runHistory")}</LovableControl><LovableControl><ShieldCheck />{copy("permissions")}</LovableControl></LovablePageHeading><div className="lovable-metrics">{["totalWorkflows", "activeRuns", "completed", "pending", "averageTime"].map((key, i) => <div className="lovable-stat" key={key}><span>{copy(key)}</span><strong>{["1","0","0","0","—"][i]}</strong></div>)}</div><section className="lovable-card lovable-permissions"><h3>{copy("myPermissions")}</h3><p>{copy("permissionNote")}</p><div className="lovable-permission-row">{["edit", "publish", "run"].map((key, index) => <span key={key}><ShieldCheck />{copy(key)}<strong>{copy(index === 2 ? "allowed" : "restricted")}</strong></span>)}</div></section><div className="lovable-list-filter"><span className="lovable-search-field"><Search />{copy("searchWorkflows")}</span><LovableControl>{copy("allStatuses")}<ChevronDown /></LovableControl></div><div className="lovable-data-table"><div>{["workflowName", "status", "instances", "completed", "lastUpdated"].map(key => <strong key={key}>{copy(key)}</strong>)}</div><div><span><Workflow />{copy("approvalFlow")}</span><span className="lovable-tag">draft</span><span>0</span><span>0</span><span>24/09/2026</span></div></div></div>;
}

function LovableLibrary({ feature }: { feature: string }) {
  const copy = usePreviewLabels();
  const isApproval = feature === "approvals";
  const isKnowledge = feature === "knowledge";
  const kind = isApproval ? "approvals" : isKnowledge ? "knowledge" : "outputs";
  return <div className="lovable-page lovable-library"><LovablePageHeading title={copy(kind)} subtitle={copy(`${kind}Sub`)}>{!isApproval && !isKnowledge && <><LovableControl><Upload />{copy("importWord")}</LovableControl><LovableControl primary><Plus />{copy("new")}</LovableControl></>}</LovablePageHeading>
    {isApproval ? <div className="lovable-view-tabs">{["pending", "myApprovals", "processed"].map((key, i) => <span key={key} data-active={i === 0}>{copy(key)}</span>)}</div> : <div className="lovable-list-filter"><div className="lovable-search-field"><Search />{copy(isKnowledge ? "searchArticles" : "searchTitle")}</div>{["allProjects", "allTypes", "allStatuses"].slice(0, isKnowledge ? 1 : 3).map(key => <LovableControl key={key}>{copy(key)}<ChevronDown /></LovableControl>)}</div>}
    {!isApproval && !isKnowledge && <section className="lovable-card lovable-weekly-report"><header><h3>{copy("weeklyReport")}</h3><span>{copy("lastWeek")}</span><span>DOCX · XLSX · PPTX · PDF</span><LovableControl><ArrowDownToLine />{copy("export")}</LovableControl></header><p>{copy("reportSample")}</p></section>}
    <div className="lovable-library-list">{["launchBrief", "designGuide", "meetingNotes"].map((key, i) => <div key={key}><span className="lovable-file-icon">{isKnowledge ? <BookOpen /> : isApproval ? <CircleCheck /> : <FileText />}</span><div><h3>{copy(key)}</h3><p>{copy("launch")} · General · v{[2,1,3][i]}</p></div><span className="lovable-tag">{isApproval ? "pending" : "draft"}</span><span>24/09/2026</span><MoreHorizontal /></div>)}</div>
  </div>;
}
