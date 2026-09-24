"use client";
import { Activity, ArrowDownToLine, ArrowUpRight, Bell, BookOpen, CalendarDays, CheckCheck, ChevronDown, CircleCheck, FileText, FolderKanban, Inbox, ListChecks, MessageSquare, Plus, RefreshCw, Send, ShieldCheck, SlidersHorizontal, Sparkles, TriangleAlert, Users, Video, Workflow, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LovableControl, LovablePageHeading, usePreviewLabels } from "./lovable-frame";

export function LovableDashboard() {
  const copy = usePreviewLabels();
  const metrics = [{ key: "users", value: 14, icon: Users }, { key: "activeUsers", value: 4, icon: Activity }, { key: "workspaces", value: 1, icon: FolderKanban }, { key: "tasks", value: 64, icon: CircleCheck }, { key: "meetings", value: 53, icon: Video }];
  return <div className="lovable-page lovable-dashboard">
    <LovablePageHeading title="Dashboard" subtitle={copy("dashboardSub")}><LovableControl><CalendarDays />{copy("lastWeek")}<ChevronDown /></LovableControl><LovableControl><RefreshCw />{copy("refreshInterval")}<ChevronDown /></LovableControl><LovableControl><SlidersHorizontal />{copy("customize")}</LovableControl></LovablePageHeading>
    <div className="lovable-metrics">{metrics.map(({ key, value, icon: Icon }, index) => <div className="lovable-stat" key={key} data-tone={index}><span>{copy(key)}</span><i><Icon /></i><strong>{value}</strong><small>{index < 2 ? copy("lastWeek") : <><ArrowUpRight />{index === 2 ? "0%" : index === 3 ? "-41.7%" : "+60%"} {copy("vsPrevious")}</>}</small></div>)}</div>
    <div className="lovable-charts">
      <section className="lovable-card"><header><h3>{copy("activity")}</h3><span>{copy("lastWeek")}</span></header>
        <div className="lovable-chart-content"><ActivityChart /><div className="lovable-chart-legend">{["createdTasks", "meetings", "completedTasks", "updatedDocs"].map((key, index) => <div key={key}><span className={`lovable-dot tone-${index}`} /><span>{copy(key)}<strong>{[7, 27, 0, 0][index]}</strong></span><small>{["+100%", "-41.2%", "0%", "0%"][index]}</small></div>)}</div></div>
      </section>
      <section className="lovable-card"><header><h3>{copy("distribution")}</h3></header><div className="lovable-donut"><div><strong>64</strong><small>{copy("totalTasks")}</small></div></div><div className="lovable-distribution">{["done", "inProgress", "pending", "blocked", "cancelled"].map((key, index) => <div key={key}><span className={`lovable-dot status-${key}`} /><span>{copy(key)}</span><strong>{["3 (5%)", "9 (14%)", "43 (67%)", "9 (14%)", "0 (0%)"][index]}</strong></div>)}</div></section>
    </div>
    <div className="lovable-dashboard-bottom">{["featuredProjects", "recentActivity", "todayMeetings"].map((key, index) => <section className="lovable-card" key={key}><header><h3>{copy(key)}</h3><small>{copy("viewAll")}</small></header><div className="lovable-bottom-entry">{index === 0 ? <FolderKanban /> : index === 1 ? <Activity /> : <Video />}<div><strong>{copy(index === 0 ? "launch" : index === 1 ? "taskUpdated" : "sync")}</strong><p>{index === 0 ? "General · 64" : index === 1 ? "Minh Linh · 09:24" : "09:30 – 10:00"}</p></div></div></section>)}</div>
  </div>;
}

function ActivityChart() {
  return <svg className="lovable-line-chart" viewBox="0 0 650 280" aria-hidden>
    {[0, 1, 2, 3, 4].map((i) => <g key={i}><line x1="32" x2="634" y1={238 - i * 50} y2={238 - i * 50} /><text x="8" y={242 - i * 50}>{i * 2}</text></g>)}
    <polyline className="lovable-line-meetings" points="32,159 118,159 204,159 290,60 376,139 462,159 548,159 634,238" />
    <polyline className="lovable-line-tasks" points="32,238 118,238 204,238 290,238 376,120 462,238 548,199 634,238" />
    {[32,118,204,290,376,462,548,634].map((x,i) => <g key={x}><circle className="lovable-line-meetings" cx={x} cy={[159,159,159,60,139,159,159,238][i]} r="3"/><circle className="lovable-line-tasks" cx={x} cy={[238,238,238,238,120,238,199,238][i]} r="3"/><text x={x-13} y="266">{17+i}/09</text></g>)}
  </svg>;
}

export function LovableAssistant({ feature, completed = false }: { feature: string; completed?: boolean }) {
  const copy = usePreviewLabels();
  const { t } = useTranslation();
  const isTask = feature === "tasks";
  const isMail = feature === "email";
  if (feature === "documents") return <aside className="lovable-assistant lovable-document-assistant"><div className="lovable-view-tabs"><span data-active="true">AI Copilot</span><span>{t("tasks.comments")}</span><span>{copy("members")}</span></div><section className="lovable-assistant-card"><h3><Sparkles />{copy("documentSummary")}</h3><p>{copy("projectExample")}</p><small>{copy("sample")}</small></section><section><h3><Sparkles />{t("landing.studio.askTab")}</h3><div className="lovable-ask-input">{copy("askAnything")}<Send /></div></section></aside>;
  return <aside className="lovable-assistant"><header><Sparkles /><strong>{isTask ? "AI Project Copilot" : isMail ? "AI Email Assistant" : feature === "documents" ? "AI Copilot" : "AI Assistant"}</strong><small>Beta</small><X /></header>
    {isTask ? <>
      <div className="lovable-assistant-actions"><span>{copy("expandAll")}</span><span>{copy("collapseAll")}</span></div>
      <section><h3>{copy("projectHealth")}</h3><p>{copy("projectProgress", { completed: completed ? 4 : 3 })}</p><progress value={completed ? 4 : 3} max={64} /><small>{completed ? "6%" : "5%"}</small></section>
      <section><h3>{copy("risks")}</h3><p><TriangleAlert />{copy("overdue27")}</p></section>
      <section><h3>{copy("suggestion")}</h3><p><Sparkles />{copy("prioritize")}</p></section>
      <section><h3>{copy("recentActivity")}</h3><p>{copy("auditHint")}</p></section>
      <section><h3>{copy("quickActions")}</h3><div className="lovable-quick-actions">{[Activity, Users, ArrowDownToLine, ArrowUpRight].map((Icon, i) => <span key={i}><Icon />{copy(["gantt", "resources", "import", "export"][i]!)}</span>)}</div></section>
      <section><h3>{copy("integrations")}</h3><div className="lovable-integration-list">G <span>Gh</span><span>Fi</span><span>No</span><span>+3</span></div></section>
    </> : isMail ? <>
      <section className="lovable-assistant-card"><h3>{copy("quickSummary")}</h3>{["totalMail", "read", "unread", "sent", "forwarded", "resolved", "cancelled"].map((key, i) => <div className="lovable-key-value" key={key}><span>{copy(key)}</span><strong>{[3, 1, 2, 0, 0, 0, 0][i]}</strong></div>)}</section><section className="lovable-assistant-card"><h3>{copy("priority")}</h3><p>{copy("mailPriority")}</p><small>{copy("viewAll")}</small></section><section className="lovable-assistant-card"><h3>{copy("mailStatistics")}</h3><div className="lovable-donut"><div><strong>3</strong><small>Email</small></div></div></section>
    </> : <><div className="lovable-assistant-greeting"><strong>{copy("greeting")}</strong><p>{copy("assistantSub")}</p></div>{[{ icon: FileText, key: "docAlert" }, { icon: TriangleAlert, key: "taskAlert" }, { icon: Video, key: "meetingAlert" }, { icon: Workflow, key: "workflowAlert" }].map(({ icon: Icon, key }, i) => <div className="lovable-assistant-alert" key={key} data-tone={i}><i><Icon /></i><span><strong>{copy(key)}</strong><small>{copy("viewDetails")} →</small></span></div>)}<div className="lovable-ask-input">{copy("askAnything")}<Send /></div><section className="lovable-assistant-card"><h3><ShieldCheck />{copy("importantNotice")}</h3><p>{copy("noNotice")}</p><small>{copy("viewAll")} ↗</small></section><div className="lovable-guide"><BookOpen />{copy("guide")}</div></>}
  </aside>;
}

export function LovableMySpace() {
  const copy = usePreviewLabels();
  const { t } = useTranslation();
  return <div className="lovable-page lovable-my-space"><LovablePageHeading title={copy("mySpace")} subtitle={copy("morning")}><LovableControl><SlidersHorizontal />{copy("customize")}</LovableControl><LovableControl><RefreshCw />{copy("refresh")}</LovableControl><LovableControl primary><Plus />{copy("tasks")}</LovableControl><LovableControl><Plus />{copy("meetings")}</LovableControl><LovableControl><Plus />{copy("message")}</LovableControl></LovablePageHeading><p>{copy("todayAttention")}</p>
    <div className="lovable-personal-stats">{[ListChecks, TriangleAlert, MessageSquare, ShieldCheck, Video].map((Icon, i) => <div key={i}><Icon /><strong>{[2, 0, 1, 0, 1][i]}<small>{copy(["today", "overdue", "mentions", "pending", "meetings"][i]!)}</small></strong></div>)}</div>
    <div className="lovable-personal-grid"><section className="lovable-card"><header><h3>{copy("myTasks")}</h3><small>{copy("viewAll")} →</small></header>{["design", "brief"].map((key, index) => <div className="lovable-personal-task" key={key}><CircleCheck /><span><strong>{t(`landing.playback.tasks.${key}`)}</strong><small>UW-10{index+1} · General</small></span><span className="lovable-tag">{index === 0 ? "in_progress" : "todo"}</span><span>14:00</span></div>)}</section><section className="lovable-card"><header><h3>{copy("inbox")}</h3><small>{copy("viewAll")} →</small></header><div className="lovable-space-empty"><Inbox /><strong>{copy("caughtUp")}</strong><p>{copy("inboxEmpty")}</p><LovableControl><Bell />{copy("notifications")}</LovableControl></div></section></div>
    <div className="lovable-personal-bottom"><section className="lovable-card"><header><h3>{copy("upcoming")}</h3><small>{copy("viewAll")}</small></header><div className="lovable-bottom-entry"><Video /><span><strong>{copy("sync")}</strong><p>09:30 · 4 {copy("members")}</p></span><LovableControl primary>{copy("join")}</LovableControl></div></section><section className="lovable-card"><header><h3><Sparkles />{copy("todaySummary")}</h3><RefreshCw /></header><p><CheckCheck /> {copy("summaryCopy")}</p></section></div>
  </div>;
}
