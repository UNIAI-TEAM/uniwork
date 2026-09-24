"use client";
import { Archive, ArrowRight, Check, ChevronDown, Columns3, FileText, Flag, Hand, Inbox, Mail, MessageSquare, Mic, MicOff, Monitor, MoreHorizontal, MousePointer2, Pause, PhoneOff, Play, Plus, Search, Send, ShieldCheck, Sparkles, Star, Users, Video, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Logo } from "@uniwork/ui/brand";
import { Button } from "@uniwork/ui/components/ui/button";
import { type ProductFeature } from "./showcase";
import { usePreviewPlayback } from "./animation/use-preview-playback";
import { useDemoItemMotion } from "./animation/use-demo-item-motion";
import { LovableControl, LovableFrame, LovablePageHeading, LovablePoster, usePreviewLabels } from "./lovable-frame";
import { LovableTaskHeading, LovableChatChannels } from "./lovable-reference";

const PLAYBACK_FEATURES = ["tasks", "meetings", "chat", "email", "ask"] as const;
type PlaybackFeature = typeof PLAYBACK_FEATURES[number];
export function hasPlayback(feature: ProductFeature): feature is PlaybackFeature {
  return PLAYBACK_FEATURES.some(key => key === feature);
}
const PEOPLE = ["ML", "HA", "TN", "LT"];
const NAMES = ["Minh Linh", "Hoàng Anh", "Thanh Ngân", "Lê Tùng"];
const TARGETS: Record<PlaybackFeature, readonly (string | null)[]> = {
  tasks: ["task-row", "assignee", "member", "task-close", "task-status", "task-done", null],
  meetings: ["share-start", "share-source", "share-confirm", null],
  chat: ["message-menu", "create-from-message", "create-confirm", null, null],
  email: ["mail-row", "mail-star", null, null],
  ask: ["ask-send", null, "ask-source", null],
};
function Avatar({ person = "HA" }: { person?: string }) { return <span className="action-avatar" data-person={person}>{person}</span>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <div className="action-field"><span>{label}</span><div>{children}</div></div>; }

/** Illustrative controls are not interactive. Real controls live outside the film. */
export function ProductPlayback({ featureKey }: { featureKey: PlaybackFeature }) {
  const { t, i18n } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [surface, setSurface] = useState<HTMLDivElement | null>(null);
  const attachStage = useCallback((node: HTMLDivElement | null) => { stage.current = node; setSurface(node); }, []);
  const cursor = useRef<HTMLDivElement>(null);
  const beatCount = TARGETS[featureKey].length;
  const [sceneVisible, setSceneVisible] = useState(true);
  const { step, playing, running, reduced, pressing, toggle } = usePreviewPlayback(host, beatCount, sceneVisible);
  useDemoItemMotion(stage, step, running && !reduced);
  useEffect(() => {
    const pointer = cursor.current;
    if (!surface || !pointer) return;
    const measure = () => {
      const name = TARGETS[featureKey][step];
      const target = name && surface.querySelector<HTMLElement>(`[data-demo-target="${name}"]`);
      pointer.hidden = !target;
      surface.querySelectorAll<HTMLElement>("[data-demo-pointed]").forEach(item => item.removeAttribute("data-demo-pointed"));
      if (!target) return;
      target.dataset.demoPointed = "true";
      const rect = target.getBoundingClientRect();
      const bounds = surface.getBoundingClientRect();
      const scaleX = bounds.width / surface.offsetWidth;
      const scaleY = bounds.height / surface.offsetHeight;
      const x = (rect.left - bounds.left + rect.width * .68) / scaleX;
      const y = (rect.top - bounds.top + rect.height * .65) / scaleY;
      pointer.style.transform = `translate(${x}px, ${y}px)`;
      const label = pointer.querySelector<HTMLElement>(".action-cursor-label");
      if (label) {
        label.style.left = `${Math.max(8 - x, Math.min(12, surface.offsetWidth - x - label.offsetWidth - 8))}px`;
        label.style.top = `${y + label.offsetHeight + 33 > surface.offsetHeight ? -label.offsetHeight - 12 : 25}px`;
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(surface);
    const timer = window.setTimeout(measure, 300);
    return () => { observer.disconnect(); clearTimeout(timer); };
  }, [featureKey, step, i18n.language, surface]);
  return <div ref={host} className="product-playback" data-feature-preview={featureKey} data-step={step} data-beat-count={beatCount} data-running={running} data-reduced={reduced} data-pressing={pressing}>
    <LovableFrame feature={featureKey} label={t(`landing.actionDemo.steps.${featureKey}${step}`)} completed={featureKey === "tasks" && step === 6} onSceneVisibilityChange={setSceneVisible} playback={{ running, reduced, pressing, control: <Button variant="ghost" size="icon" data-action="toggle-playback" onClick={toggle} aria-label={t(playing ? "landing.playback.pause" : "landing.playback.play")}>{playing ? <Pause aria-hidden /> : <Play aria-hidden />}</Button> }}>
    <div ref={attachStage} className="action-stage demo-stage" data-scene-kind={featureKey} role="img" aria-label={t(`landing.actionDemo.steps.${featureKey}${step}`)}>
      {featureKey === "tasks" && <TaskScene step={step} />}
      {featureKey === "meetings" && <MeetingScene step={step} />}
      {featureKey === "chat" && <ChatScene step={step} />}
      {featureKey === "email" && <EmailScene step={step} />}
      {featureKey === "ask" && <AskScene step={step} />}
      <div ref={cursor} className="action-cursor" aria-hidden><i className="action-click-ring" /><MousePointer2 /><div className="action-cursor-label"><Logo variant="mark" size={22} decorative /><span><strong>Minh Linh</strong><small>{t(`landing.actionDemo.pointer.${TARGETS[featureKey][step] ?? "task-row"}`)}</small></span></div></div>
    </div>
    </LovableFrame>
  </div>;
}

export function TaskPoster() {
  const { t } = useTranslation();
  return <LovablePoster feature="tasks" label={`${t("landing.lovable.allTasks")} — ${t("landing.lovable.sample")}`} completed><TaskScene step={6} /></LovablePoster>;
}

function TaskScene({ step }: { step: number }) {
  const { t } = useTranslation();
  const copy = usePreviewLabels();
  const completed = step === 6;
  const columns = [
    { status: "todo", count: 43, keys: ["brief"] },
    { status: "in_progress", count: completed ? 8 : 9, keys: completed ? ["review"] : ["design", "review"] },
    { status: "blocked", count: 9, keys: ["blocked"] },
    { status: "done", count: completed ? 4 : 3, keys: completed ? ["design", "launch"] : ["launch"] },
    { status: "cancelled", count: 0, keys: [] },
  ];
  return <div className="action-work">
    <LovableTaskHeading completed={completed} />
    <div className="action-kanban">{columns.map(column => <div className="action-board-column" key={column.status} data-status={column.status}>
      <header><span className="action-board-dot" /><strong>{copy(column.status === "in_progress" ? "inProgress" : column.status)}</strong><small>{column.count}</small><Plus /></header>
      {column.keys.map(key => <div className="action-board-card" key={key} data-demo-item={key} data-demo-target={key === "design" ? "task-row" : undefined} data-focus={key === "design"} data-demo-result={key === "design" && completed ? "task-moved" : undefined}>
        <small>UW-{key === "brief" ? 101 : key === "design" ? 102 : key === "review" ? 103 : key === "blocked" ? 106 : 104}</small>
        <strong>{t(key === "blocked" ? "landing.lovable.blockedTask" : `landing.playback.tasks.${key}`)}</strong>
        <p className="lovable-task-excerpt">{t(key === "blocked" ? "landing.lovable.blockedNote" : "landing.lovable.taskExcerpt")}</p>
        <span className="action-card-priority"><Flag />{key === "design" ? "high" : "medium"}</span>
        <footer>
          {key === "design" ? <span className="action-card-status" data-demo-target="task-status" data-completed={completed}>{completed ? <Check /> : <Columns3 />}<span>{column.status}</span><ChevronDown /></span> : <span><MessageSquare />1</span>}
          {key === "design" && step < 3 ? <span className="demo-unassigned"><Users /></span> : <Avatar person={key === "design" ? "HA" : key === "brief" ? "ML" : "TN"} />}
        </footer>
        {key === "design" && step === 5 && <div className="action-status-menu"><small>{t("tasks.status")}</small><span><span className="action-board-dot" />in_progress<Check /></span><span data-demo-target="task-done"><Check />done</span></div>}
      </div>)}
      <div className="lovable-add-task"><Plus />{t("landing.lovable.addTask")}</div>
    </div>)}</div>
    {step > 0 && step < 4 && <div className="action-drawer" data-demo-detail="task"><header><span><FileText />UW-102</span><span data-demo-target="task-close"><X /></span></header><h3>{t("landing.playback.tasks.design")}</h3><p>{t("landing.actionDemo.taskBrief")}</p><Field label={t("tasks.status")}><span className="action-state">in_progress</span></Field><Field label={t("tasks.priority")}><Flag />high</Field><Field label={t("landing.playback.assignee")}><span className="action-control" data-demo-target="assignee" data-demo-result={step === 3 ? "assignee" : undefined}>{step === 3 ? <><Avatar />Hoàng Anh</> : <><Users />{t("landing.playback.unassigned")}</>}<ChevronDown /></span></Field>{step === 2 && <div className="action-member-picker">{NAMES.map((name, index) => <div key={name} data-demo-target={index === 1 ? "member" : undefined} data-selected={index === 1}><Avatar person={PEOPLE[index]} />{name}</div>)}</div>}<div className="action-detail-foot"><ShieldCheck />{t("landing.actionDemo.assignmentOnly")}</div></div>}
  </div>;
}

function MeetingScene({ step }: { step: number }) {
  const { t } = useTranslation();
  return <div className="action-meeting dark"><div className="action-meeting-title"><span className="action-live" /><strong>{t("landing.playback.meetingTitle")}</strong><time>12:38</time></div><div className="action-conference-body"><div className="action-call-layout" data-sharing={step === 3}>
    {step === 3 && <div className="action-shared-screen" data-demo-result="screen"><Logo variant="lockup" size={22} decorative /><h3>{t("landing.playback.project")}</h3><p>{t("landing.playback.meetingGoal")}</p><div className="action-slide-rule" />{["brief", "design", "launch"].map((key, index) => <div className="action-slide-item" key={key}><span>0{index + 1}</span>{t(`landing.playback.tasks.${key}`)}</div>)}</div>}
    <div className="action-call-people">{PEOPLE.map((person, index) => <div key={person}><Avatar person={person} /><span>{NAMES[index]}</span><MicOff /></div>)}</div>
  </div><aside className="action-meeting-chat"><header><span>{t("landing.explorer.chat")}</span><Users /><Video /></header><small>09:12</small><strong>Minh Linh</strong><p>{t("landing.reference.meetingChat")}</p><div><span>{t("landing.demo.messagePlaceholder")}</span><Send /></div></aside></div><div className="action-call-controls"><span><Mic /></span><span><Video /></span><span data-active={step === 3}><Monitor /></span><span className="action-extra-control"><Hand /></span><span className="action-extra-control"><Sparkles /></span><span><MoreHorizontal /></span><span className="action-hangup"><PhoneOff /></span></div>
    {step === 0 && <div className="action-share-menu"><small>{t("landing.actionDemo.moreOpen")}</small><span data-demo-target="share-start"><Monitor />{t("landing.actionDemo.share")}</span></div>}
    {(step === 1 || step === 2) && <div className="action-system-scrim"><div className="action-source-picker"><header><Monitor /><strong>{t("landing.actionDemo.chooseWindow")}</strong></header><p>{t("landing.actionDemo.systemSimulation")}</p><div className="action-source-choice" data-demo-target="share-source" data-selected={step === 2}><div><Logo variant="lockup" size={20} decorative /><span>{t("landing.playback.project")}</span></div><span>{t("landing.actionDemo.appWindow")}{step === 2 && <Check />}</span></div><footer><span>{t("common.cancel")}</span><span className="action-primary" data-demo-target="share-confirm" data-enabled={step === 2}>{t("landing.actionDemo.share")}</span></footer></div></div>}
    {step === 3 && <div className="action-share-notice"><Monitor />{t("landing.playback.screenShared")}</div>}
  </div>;
}

function ChatScene({ step }: { step: number }) {
  const { t } = useTranslation();
  return <div className="action-chat"><LovableChatChannels /><div className="lovable-chat-thread"><div className="action-viewbar"><MessageSquare /><strong># product-launch</strong><span className="action-count">4 {t("workspace.members")}</span><Search /><Sparkles /></div><div className="lovable-chat-date">24/09/2026</div><div className="action-message"><Avatar person="ML" /><div><strong>Minh Linh <small>09:12</small></strong><p>{t("landing.studio.message1")}</p></div></div><div className="action-message"><Avatar person="HA" /><div><strong>Hoàng Anh <small>09:15</small></strong><p>{t("landing.actionDemo.chatTaskTitle")}</p><span className="action-message-menu" data-demo-target="message-menu"><MoreHorizontal /></span>{step === 1 && <div className="action-context-menu" data-demo-target="create-from-message"><Plus />{t("landing.actionDemo.createFromMessage")}</div>}{step === 4 && <div className="action-linked-task" data-demo-result="chat-task"><Check /><span><small>UW-105 · todo</small><strong>{t("landing.actionDemo.chatTaskTitle")}</strong></span><ArrowRight /></div>}</div></div><div className="action-compose"><span>{t("landing.demo.messagePlaceholder")}</span><Send /></div></div>
    {(step === 2 || step === 3) && <div className="action-system-scrim"><div className="action-create-dialog"><header><Columns3 /><strong>{t("landing.actionDemo.createFromMessage")}</strong><X /></header><Field label={t("tasks.title")}><span className="action-input">{t("landing.actionDemo.chatTaskTitle")}</span></Field><Field label={t("landing.actionDemo.projectOptional")}><span className="action-control">{t("landing.actionDemo.notSelected")}<ChevronDown /></span></Field><Field label={t("landing.playback.assignee")}><span className="action-control">{t("landing.playback.unassigned")}<ChevronDown /></span></Field><footer><span>{t("common.cancel")}</span><span className="action-primary" data-demo-target={step === 2 ? "create-confirm" : undefined} data-demo-pending={step === 3 ? "create" : undefined}>{t(step === 3 ? "landing.actionDemo.creating" : "landing.updates.createTask")}</span></footer></div></div>}
  </div>;
}

function EmailScene({ step }: { step: number }) {
  const { t } = useTranslation();
  return <div className="action-email"><aside className="action-mail-folders"><strong><Mail />Email Hub</strong><span className="action-primary"><Plus />{t("landing.reference.compose")}</span>{[{ key: "inbox", icon: Inbox }, { key: "starred", icon: Star }, { key: "sent", icon: Send }, { key: "drafts", icon: FileText }, { key: "archive", icon: Archive }].map(({ key, icon: Icon }, index) => <div key={key} data-selected={index === 0}><Icon /><span>{t(`landing.reference.${key}`)}</span>{index === 0 && <small>3</small>}</div>)}</aside><div className="action-mail-list"><div className="action-viewbar"><Search /><span>{t("landing.reference.searchMail")}</span></div>{["mailOne", "mailTwo", "mailThree"].map((key, index) => <div key={key} className="action-mail-row" data-demo-target={index === 0 ? "mail-row" : undefined} data-selected={step > 0 && index === 0}><Avatar person={PEOPLE[index]} /><div><strong>{NAMES[index]}</strong><p>{t(`landing.playback.${key}`)}</p></div>{index === 0 && <Star data-starred={step >= 2} />}</div>)}</div>{step > 0 ? <article className="action-mail-reader"><header><small>09:12 · Minh Linh</small><span data-demo-target="mail-star" data-demo-result={step >= 2 ? "starred" : undefined}><Star data-starred={step >= 2} /></span></header><h3>{t("landing.playback.mailOne")}</h3><p>{t("landing.playback.mailGreeting")}</p><p>{t("landing.playback.mailBodyOne")}</p><div className="action-attachment"><FileText /><span>Launch-brief.pdf<small>248 KB</small></span></div><p>Minh Linh</p></article> : <div className="action-mail-empty"><Mail /><p>{t("landing.actionDemo.selectThread")}</p></div>}</div>;
}

function AskScene({ step }: { step: number }) {
  const { t } = useTranslation();
  const copy = usePreviewLabels();
  return <div className="action-ask lovable-ai-page"><div className="lovable-ai-main">
    <LovablePageHeading title="AI Assistant" subtitle={copy("aiSubtitle")}><LovableControl primary><Plus />{copy("newChat")}</LovableControl></LovablePageHeading>
    <div className="lovable-view-tabs">{["chat", "assistants", "prompts", "knowledge", "tools", "usage"].map((key, i) => <span key={key} data-active={i === 0}>{copy(key)}</span>)}</div>
    <div className="action-ask-sheet"><div className="lovable-ai-welcome"><Sparkles /><h2>{copy("aiWelcome")}</h2><p>{copy("aiSubtitle")}</p></div>
      {step === 0 && <div className="lovable-ai-prompts">{["meetingSummary", "projectStatus", "reportAnalysis", "improvementIdeas"].map(key => <div key={key}><strong>{copy(key)}</strong><p>{copy(`${key}Hint`)}</p></div>)}</div>}
      {step > 0 && <div className="action-question">{t("landing.demo.ownerQuestion")}</div>}
      {step === 1 && <div className="action-pending"><span /><span /><span /><p>{t("landing.actionDemo.answerPending")}</p></div>}
      {step >= 2 && <div className="action-ai-answer"><Logo variant="mark" size={25} decorative /><p>{t("landing.actionDemo.ownerAnswer")}</p><div className="action-citation" data-demo-target="ask-source"><FileText /><span>[S1] {t("landing.playback.tasks.design")}</span><ArrowRight /></div></div>}
      <div className="lovable-ai-composer"><span>{step === 0 ? t("landing.demo.ownerQuestion") : copy("askAnything")}</span><span className="action-ask-submit" data-demo-target={step === 0 ? "ask-send" : undefined}><Send /></span></div><span className="action-readonly"><ShieldCheck />{t("landing.actionDemo.readOnly")}</span>
    </div>
    </div><aside className="lovable-ai-catalog"><header><h3>{copy("assistants")}</h3><small>{copy("viewAll")}</small></header>{["meetingAssistant", "projectAnalyst", "documentHelper", "dataAnalyst"].map((key, i) => <div className="lovable-ai-assistant-card" key={key}><span>{i === 0 ? <Users /> : i === 2 ? <FileText /> : <Sparkles />}</span><div><strong>{copy(key)}</strong><small>{copy(`${key}Hint`)}</small></div></div>)}<div className="lovable-add-task"><Plus />{copy("createAssistant")}</div><header><h3>{copy("prompts")}</h3><small>{copy("viewAll")}</small></header>{["meetingSummary", "draftEmail", "reportAnalysis"].map(key => <div className="lovable-ai-assistant-card" key={key}><FileText /><div><strong>{copy(key)}</strong><small>{copy(`${key}Hint`)}</small></div></div>)}</aside>
    {step === 3 && <div className="action-source-detail" data-demo-result="source"><header><span>{t("tasks.title")} / UW-102</span><FileText /></header><h3>{t("landing.playback.tasks.design")}</h3><Field label={t("landing.playback.assignee")}><Avatar />Hoàng Anh</Field><Field label={t("tasks.status")}><span className="action-state">in_progress</span></Field><p><ShieldCheck />{t("landing.actionDemo.readOnly")}</p></div>}
  </div>;
}
