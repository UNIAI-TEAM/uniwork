"use client";
import { ArrowUpRight, Check, Circle, Columns3, FileText, List, MessageSquare, RotateCcw, Search, Send, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Logo } from "@uniwork/ui/brand";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Tabs, TabsContent } from "@uniwork/ui/components/ui/tabs";
import { EmailDemo } from "./product-updates";
import { MeetingPreview } from "./product-band";
import { TodayPreview } from "./today-preview";
import { PRODUCT_FEATURES, type ProductFeature } from "./showcase";
import { WorkspaceNavigation } from "./workspace-navigation";
import { WorkspaceAppNavigation } from "./workspace-app-navigation";
import { AgentsPreview, AuditPreview, OrganizationPreview, PlannedPreview, ProjectsPreview } from "./catalog-previews";
import { hasPlayback, ProductPlayback } from "./product-playback";
import { LovableReference } from "./lovable-reference";

type Status = "todo" | "in_progress" | "done";
type Task = { key: string; state: Status; person: string; category: string };
const TASKS: Task[] = [
  { key: "brief", state: "todo", person: "ML", category: "strategy" },
  { key: "design", state: "in_progress", person: "HA", category: "design" },
  { key: "review", state: "in_progress", person: "LT", category: "research" },
  { key: "launch", state: "done", person: "TN", category: "product" },
];


const mobileQuery = "(max-width: 900px)";
function subscribeMobile(notify: () => void) {
  const query = window.matchMedia(mobileQuery);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}

/** Two navigation layers, one product stage. All sample state stays in memory. */
export function ProductPreview() {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const mobile = useSyncExternalStore(subscribeMobile, () => window.matchMedia(mobileQuery).matches, () => false);
  const [mode, setMode] = useState<ProductFeature>("tasks");
  const [query, setQuery] = useState("");
  const [tasks, setTasks] = useState(TASKS);
  const [selected, setSelected] = useState("design");
  const [messages, setMessages] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const [watch, setWatch] = useState(true);
  const cinematic = watch;
  useEffect(() => {
    let frame = 0;
    const followHash = () => {
      const target = PRODUCT_FEATURES.find(item => `#${item.anchor}` === window.location.hash);
      if (!target) return;
      setMode(target.key);
      frame = requestAnimationFrame(() => document.getElementById("platform")?.scrollIntoView({ behavior: "instant", block: "start" }));
    };
    followHash();
    window.addEventListener("hashchange", followHash);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("hashchange", followHash); };
  }, []);
  const selectFeature = (value: unknown, focus = false) => {
    const target = PRODUCT_FEATURES.find(item => item.key === value);
    if (!target) return;
    setMode(target.key);
    window.history.replaceState(null, "", `#${target.anchor}`);
    if (focus) requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>(`[role=tab][data-feature="${target.key}"]`)?.focus({ preventScroll: true }));
  };
  const showTask = (key = "design") => { setWatch(false); setQuery(""); setSelected(key); selectFeature("tasks", true); };
  const chatTaskCreated = tasks.some(task => task.key === "followup");
  const toggleChatTask = () => {
    setSelected("design");
    setTasks(current => current.some(task => task.key === "followup") ? current.filter(task => task.key !== "followup") : [...current, { key: "followup", state: "todo", person: "HA", category: "design" }]);
  };
  const openChatTask = () => { setQuery(""); setSelected(chatTaskCreated ? "followup" : "design"); selectFeature("tasks", true); };
  const reset = () => { setTasks(TASKS); setMessages([]); setQuery(""); setSelected("design"); setRevision(value => value + 1); };
  const manualPanel = (key: ProductFeature) => {
    switch (key) {
      case "dashboard": return !watch && mode === "dashboard" ? <LovableReference feature="dashboard" /> : null;
      case "tasks": return <TaskPreview tasks={tasks} query={query} selected={selected} onSelect={setSelected} onStatus={status => setTasks(current => current.map(task => task.key === selected ? { ...task, state: status } : task))} onChat={() => selectFeature("chat", true)} />;
      case "meetings": return <MeetingPreview />;
      case "chat": return <ChatPreview messages={messages} onSend={message => setMessages(current => [...current, message].slice(-8))} onTask={openChatTask} created={chatTaskCreated} onCreate={toggleChatTask} />;
      case "email": return <EmailDemo />;
      case "ask": return <AskPreview onTask={() => showTask()} completed={tasks.filter(task => task.state === "done").length} />;
      case "today": return <TodayPreview tasks={tasks} onTask={showTask} onMeeting={() => { setWatch(false); selectFeature("meetings", true); }} />;
      case "projects": return <ProjectsPreview completed={tasks.filter(task => task.state === "done").length} total={tasks.length} onTasks={() => showTask()} />;
      case "organization": return <OrganizationPreview />;
      case "audit": return <AuditPreview />;
      case "agents": return <AgentsPreview />;
      default: return <PlannedPreview featureKey={key} />;
    }
  };
  return <div ref={root} id="product-preview" className="product-preview unified-workspace" data-presentation={cinematic ? "watch" : "explore"}>
    <Tabs value={mode} onValueChange={value => selectFeature(value)} orientation={mobile ? "horizontal" : "vertical"} className="workspace-explorer">
      <WorkspaceNavigation mode={mode} onSelect={key => selectFeature(key)} />
      <div className="workspace-display">
        <div className="preview-window">
          <div className="preview-topbar">
            <div className="preview-brand"><Logo variant="lockup" size={24} /></div>
            {!cinematic && mode === "tasks" && <div className="preview-search"><Search aria-hidden /><Input type="search" aria-label={t("landing.demo.search")} placeholder={t("landing.demo.search")} value={query} onChange={event => setQuery(event.target.value)} /></div>}
            <span className="preview-illustration">{t("landing.studio.illustration")}</span>
            {!cinematic && <Button variant="ghost" size="icon" data-action="reset-preview" onClick={reset} aria-label={t("landing.demo.reset")}><RotateCcw aria-hidden /></Button>}
            <Button className="preview-presentation-toggle" variant="outline" size="sm" data-action="toggle-presentation" onClick={() => setWatch(value => !value)}>{t(watch ? "landing.playback.explore" : "landing.playback.watch")}</Button>
          </div>
          <div className="workspace-app-body">
            {!cinematic && <WorkspaceAppNavigation mode={mode} onSelect={key => selectFeature(key)} />}
            <div className="preview-main" key={revision}>
              {PRODUCT_FEATURES.map(item => <TabsContent value={item.key} key={item.key} keepMounted>
                <div className="manual-preview" hidden={cinematic && mode === item.key}>{manualPanel(item.key)}</div>
                {cinematic && mode === item.key && (hasPlayback(item.key) ? <ProductPlayback featureKey={item.key} /> : <LovableReference feature={item.key} />)}
              </TabsContent>)}
            </div>
          </div>
        </div>
      </div>
    </Tabs>
  </div>;
}

function TaskPreview({ tasks, query, selected, onSelect, onStatus, onChat }: { tasks: Task[]; query: string; selected: string; onSelect: (key: string) => void; onStatus: (status: Status) => void; onChat: () => void }) {
  const { t } = useTranslation();
  const [view, setView] = useState<"board" | "list">("board");
  const visible = tasks.filter(task => t(`landing.studio.task_${task.key}`).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const current = tasks.find(task => task.key === selected)!;
  return <div>
    <div className="preview-project-heading"><div><span className="preview-breadcrumb">{t("landing.studio.productTeam")} / {t("landing.studio.launchProject")}</span><h2>{t("landing.studio.launchProject")}</h2></div><div className="preview-avatars" aria-label={t("landing.studio.exampleMembers")}><span>ML</span><span>HA</span><span>TN</span><span>LT</span></div></div>
    <div className="preview-toolbar"><div className="preview-view-switch" aria-label={t("landing.studio.viewMode")}><Button size="sm" variant={view === "board" ? "secondary" : "ghost"} aria-pressed={view === "board"} onClick={() => setView("board")}><Columns3 aria-hidden />{t("landing.studio.board")}</Button><Button size="sm" variant={view === "list" ? "secondary" : "ghost"} aria-pressed={view === "list"} onClick={() => setView("list")}><List aria-hidden />{t("landing.studio.list")}</Button></div><span>{t("landing.studio.sharedWithTeam")}</span></div>
    {visible.length === 0 ? <p className="preview-empty" role="status">{t("landing.demo.noResults")}</p> : <div className={view === "board" ? "preview-board" : "preview-task-list"}>
      {(["todo", "in_progress", "done"] as const).map(status => <div className="preview-column" key={status}>
        <div className={`preview-column-name status-${status}`}><Circle aria-hidden /><span>{status}</span><small>{visible.filter(task => task.state === status).length}</small></div>
        {visible.filter(task => task.state === status).map(task => <button type="button" className="preview-task" key={`${task.key}-${task.state}`} aria-pressed={selected === task.key} onClick={() => onSelect(task.key)}>
          <span className={`preview-category category-${task.category}`}>{t(`landing.studio.${task.category}`)}</span><strong>{t(`landing.studio.task_${task.key}`)}</strong>
          <span className="preview-task-footer"><span><MessageSquare aria-hidden />{t("landing.studio.contextAttached")}</span><span className="preview-avatar">{task.person}</span></span>
        </button>)}
      </div>)}
    </div>}
    <div className="preview-selection" aria-live="polite"><FileText aria-hidden /><span><strong>{t(`landing.studio.task_${selected}`)}</strong><small>{t("landing.studio.selectionHint")}</small></span><Check className="text-success" aria-hidden /></div>
    <div className="preview-detail-actions"><Button size="sm" variant="outline" onClick={() => onStatus(current.state === "done" ? "in_progress" : "done")}><Check aria-hidden />{t(current.state === "done" ? "landing.demo.reopen" : "landing.demo.complete")}</Button><Button size="sm" variant="ghost" onClick={onChat}><MessageSquare aria-hidden />{t("landing.demo.openDiscussion")}</Button><span>{current.person} · {current.state}</span></div>
  </div>;
}

function ChatPreview({ messages, onSend, onTask, created, onCreate }: { messages: string[]; onSend: (message: string) => void; onTask: () => void; created: boolean; onCreate: () => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  return <div className="preview-conversation"><div className="preview-project-heading"><div><span className="preview-breadcrumb">{t("landing.studio.productTeam")}</span><h2># {t("landing.studio.launchProject")}</h2></div><MessageSquare aria-hidden /></div>
    <div className="preview-message-log" role="log" aria-label={t("landing.demo.messageHistory")}>
      <div className="preview-message"><span className="preview-avatar">ML</span><div><strong>Minh Linh <small>09:15</small></strong><p>{t("landing.studio.message1")}</p></div></div>
      <div className="preview-message"><span className="preview-avatar">HA</span><div><strong>Hoàng Anh <small>09:18</small></strong><p>{t("landing.studio.message2")}</p><button type="button" className="preview-linked-task" onClick={onTask}><Columns3 aria-hidden /><span>{t("landing.studio.task_design")}<small>{t("landing.demo.openTask")}</small></span><ArrowUpRight aria-hidden /></button></div></div>
      {messages.map((message, index) => <div className="preview-message sent-message" key={index}><span className="preview-avatar">B</span><div><strong>{t("landing.demo.you")}</strong><p>{message}</p></div></div>)}
    </div>
    <form className="preview-composer" onSubmit={(event) => { event.preventDefault(); if (draft.trim()) { onSend(draft.trim()); setDraft(""); } }}><Input aria-label={t("landing.demo.messageLabel")} placeholder={t("landing.demo.messagePlaceholder")} value={draft} maxLength={500} onChange={(event) => setDraft(event.target.value)} /><Button type="submit" variant="brand" size="icon" aria-label={t("landing.demo.send")} disabled={!draft.trim()}><Send aria-hidden /></Button></form>
    <div className="chat-task-action"><Button variant="outline" size="sm" onClick={onCreate}>{created ? <RotateCcw aria-hidden /> : <Columns3 aria-hidden />}{t(created ? "landing.updates.tryAgain" : "landing.updates.createTask")}</Button><span role="status">{t(created ? "landing.updates.created" : "landing.updates.sourceMessage")}</span>{created && <Button variant="ghost" size="sm" onClick={onTask}>{t("landing.demo.openTask")}<ArrowUpRight aria-hidden /></Button>}</div>
  </div>;
}

function AskPreview({ onTask, completed }: { onTask: () => void; completed: number }) {
  const { t } = useTranslation();
  const [question, setQuestion] = useState(0);
  return <div className="preview-conversation"><div className="preview-project-heading"><div><span className="preview-breadcrumb">{t("landing.studio.permissionAware")}</span><h2>{t("landing.studio.askTab")}</h2></div><Sparkles className="text-brand" aria-hidden /></div>
    <div className="preview-prompts">{["askQuestion", "ownerQuestion"].map((key, index) => <Button key={key} variant={question === index ? "secondary" : "outline"} size="sm" aria-pressed={question === index} onClick={() => setQuestion(index)}>{t(index === 0 ? `landing.studio.${key}` : `landing.demo.${key}`)}</Button>)}</div>
    <div className="preview-answer" key={question} aria-live="polite"><div className="preview-message"><span className="agent-avatar">UNI</span><div><strong>UNI</strong><p>{t(question === 0 ? "landing.studio.askAnswer" : "landing.demo.ownerAnswer")}</p>{question === 0 && <ul className="preview-answer-list"><li><Check aria-hidden />{t("landing.demo.completedCount", { count: completed })}</li><li><Circle aria-hidden />{t("landing.studio.askPoint2")}</li></ul>}<button type="button" className="preview-source" onClick={onTask}><FileText aria-hidden />{t("landing.studio.sourceLabel")}: {t("landing.studio.launchProject")}<ArrowUpRight aria-hidden /></button></div></div></div>
    
  </div>;
}
