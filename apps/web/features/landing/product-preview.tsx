"use client";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Tabs, TabsContent } from "@uniwork/ui/components/ui/tabs";
import { EmailDemo } from "./product-updates";
import { MeetingPreview } from "./product-band";
import { DEMO_FEATURES as PRODUCT_FEATURES, type ProductFeature } from "./showcase";
import { AuditPreview } from "./catalog-previews";
import { hasPlayback, ProductPlayback } from "./product-playback";
import { LovableReference } from "./lovable-reference";
import { ProductDemoShell, type DemoDestination } from "./product-demo-shell";
import { ProductDemoHome, ProductDemoInbox } from "./product-demo-pages";
import { ProductMyTasksPreview } from "./product-my-tasks-preview";
import { ProductTaskBoard } from "./product-task-board";
import { DEMO_TASKS as TASKS } from "./product-task-data";



const ProductChatPreview = lazy(() => import("./product-chat-preview").then(module => ({ default: module.ProductChatPreview })));

const ProductAskPreview = lazy(() => import("./product-ask-preview").then(module => ({ default: module.ProductAskPreview })));

const ProductProjectsPreview = lazy(() => import("./product-projects-preview").then(module => ({ default: module.ProductProjectsPreview })));

const ProductPeoplePreview = lazy(() => import("./product-people-preview").then(module => ({ default: module.ProductPeoplePreview })));

const ProductCalendarPreview = lazy(() => import("./product-calendar-preview").then(module => ({ default: module.ProductCalendarPreview })));

const ProductDemoDocuments = lazy(() => import("./product-documents-preview").then(module => ({ default: module.ProductDemoDocuments })));

/** The product's own menu drives the local sandbox; sample changes stay in memory. */
export function ProductPreview({ initialFeature = "tasks" }: { initialFeature?: ProductFeature }) {
  const root = useRef<HTMLDivElement>(null);
  const taskSequence = useRef(0);
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set([initialFeature]));
  const [mode, setMode] = useState<DemoDestination>(initialFeature);
  const [query, setQuery] = useState("");
  const [tasks, setTasks] = useState(TASKS);
  const [selected, setSelected] = useState("design");
  const [taskOpen, setTaskOpen] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  const [watch, setWatch] = useState(hasPlayback(initialFeature));
  const [meetings, setMeetings] = useState<{ title: string; startsAt: string }[]>([]);
  const cinematic = watch;
  useEffect(() => {
    let frame = 0;
    const followHash = () => {
      if (window.location.hash === "#demo-inbox") { setMode("inbox"); setWatch(false); return; }
      const target = PRODUCT_FEATURES.find(item => `#${item.anchor}` === window.location.hash);
      if (!target) return;
      setMode(target.key);
      setVisited(current => new Set([...current, target.key]));
      setWatch(hasPlayback(target.key));
      frame = requestAnimationFrame(() => document.getElementById("platform")?.scrollIntoView({ behavior: "instant", block: "start" }));
    };
    followHash();
    window.addEventListener("hashchange", followHash);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("hashchange", followHash); };
  }, []);
  const selectFeature = (value: unknown, focus = false) => {
    if (value === "inbox") { setMode("inbox"); setWatch(false); window.history.replaceState(null, "", "#demo-inbox"); return; }
    const target = PRODUCT_FEATURES.find(item => item.key === value);
    if (!target) return;
    setMode(target.key);
      setVisited(current => new Set([...current, target.key]));
    setWatch(!focus && hasPlayback(target.key));
    window.history.replaceState(null, "", `#${target.anchor}`);
    if (focus) requestAnimationFrame(() => root.current?.querySelector<HTMLElement>("[role=tabpanel]:not([hidden])")?.focus({ preventScroll: true }));
  };
  const showTask = (key = "design") => { setWatch(false); setQuery(""); setSelected(key); setTaskOpen(true); selectFeature("tasks", true); };
  const chatTaskCreated = tasks.some(task => task.key === "followup");
  const toggleChatTask = () => {
    setSelected("design");
    setTasks(current => current.some(task => task.key === "followup") ? current.filter(task => task.key !== "followup") : [...current, { key: "followup", state: "todo", person: "HA", category: "design" }]);
  };
  const openChatTask = () => showTask(chatTaskCreated ? "followup" : "design");
  const createTask = (title: string) => {
    const number = taskSequence.current++ + 111;
    const key = `sample-${number}`;
    setTasks(current => [...current, { key, title, identifier: `DEMO-${number}`, state: "todo", person: "Đ", category: "product" }]);
    showTask(key);
  };
  const manualPanel = (key: ProductFeature) => {
    switch (key) {
      case "dashboard": return <ProductDemoHome onTask={createTask} onOpenTask={() => showTask("brief")} onOpenMeetings={() => selectFeature("meetings", true)} onMeeting={(title, startsAt) => { setMeetings(current => [...current, { title, startsAt }]); selectFeature("meetings", true); }} />;
      case "tasks": return <ProductTaskBoard open={taskOpen} onOpenChange={setTaskOpen} tasks={tasks} query={query} onQuery={setQuery} selected={selected} onSelect={setSelected} onStatus={(key, status) => setTasks(current => current.map(task => task.key === key ? { ...task, state: status } : task))} onChat={() => selectFeature("chat", true)} />;
      case "meetings": return <><div className="product-demo-created-meetings">{meetings.map((meeting, index) => <p key={index}>{meeting.title} · {meeting.startsAt.replace("T", " · ")}</p>)}</div><MeetingPreview onTask={createTask} /></>;
      case "chat": return <ProductChatPreview messages={messages} onSend={message => setMessages(current => [...current, message].slice(-8))} onTask={openChatTask} created={chatTaskCreated} onCreate={toggleChatTask} />;
      case "email": return <EmailDemo />;
      case "ask": return <ProductAskPreview onTask={() => showTask()} />;
      case "today": return <ProductMyTasksPreview tasks={tasks} query={query} onQuery={setQuery} selected={selected} onSelect={setSelected} onStatus={(key, status) => setTasks(current => current.map(task => task.key === key ? { ...task, state: status } : task))} onChat={() => selectFeature("chat", true)} />;
      case "documents": return <ProductDemoDocuments />;
      case "calendar": return <ProductCalendarPreview onTask={() => showTask()} onMeeting={() => selectFeature("meetings", true)} />;
      case "projects": return <ProductProjectsPreview completed={tasks.filter(task => task.state === "done").length} total={tasks.length} onTasks={() => showTask()} />;
      case "organization": return <ProductPeoplePreview onChat={() => selectFeature("chat", true)} />;
      case "audit": return <AuditPreview />;
      default: return !watch && mode === key ? <LovableReference feature={key} /> : null;
    }
  };
  return <div ref={root} id="product-preview" className="product-preview unified-workspace product-demo" data-presentation={cinematic ? "watch" : "explore"}>
    <Tabs value={mode} onValueChange={value => selectFeature(value)} orientation="vertical" unstyled className="workspace-explorer">
      <div className="workspace-display"><div className="preview-window">
        <ProductDemoShell mode={mode} onSelect={key => selectFeature(key)} onCreate={createTask} watch={watch} onWatch={() => setWatch(value => !value)}>
            <div className="preview-main">
              <TabsContent value="inbox" keepMounted><ProductDemoInbox onTask={showTask} /></TabsContent>
              {PRODUCT_FEATURES.map(item => <TabsContent value={item.key} key={item.key} keepMounted>
                <div className="manual-preview" hidden={cinematic && mode === item.key}><Suspense fallback={null}>{visited.has(item.key) && manualPanel(item.key)}</Suspense></div>
                {cinematic && mode === item.key && (hasPlayback(item.key) ? <ProductPlayback featureKey={item.key} onExplore={() => setWatch(false)} /> : <LovableReference feature={item.key} />)}
              </TabsContent>)}
            </div>
        </ProductDemoShell>
      </div></div>
    </Tabs>
  </div>;
}
