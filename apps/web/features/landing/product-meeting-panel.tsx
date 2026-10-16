"use client";

import { useId, useState } from "react";
import { Send, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { MeetingPersonAvatar } from "@uniwork/views/meetings/meeting-person";
import { MeetingUnderlineTabs } from "@uniwork/views/meetings/meeting-underline-tabs";
import { MeetingCopilotHeader } from "@uniwork/views/meetings/meeting-copilot/meeting-copilot-header";
import { MeetingCopilotFooter, MeetingCopilotTasksCta } from "@uniwork/views/meetings/meeting-copilot/meeting-copilot-footer";

export const DEMO_MEETING_PEOPLE = ["Minh Linh", "Hoàng Anh", "Tuan Nguyen", "Đạt Đặng"];
const MEETING_DEMO_TABS = ["copilot", "chat", "participants", "motions", "recordings"] as const;
export type DemoMeetingTab = typeof MEETING_DEMO_TABS[number];
const COPILOT_SECTIONS = ["insights", "notes", "transcript", "actions"] as const;

/** Keep the draft and demo history while the dock or phone sheet is closed. */
export function useDemoMeetingPanelState() {
  const [section, setSection] = useState<typeof COPILOT_SECTIONS[number]>("insights");
  const [summary, setSummary] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  return { section, setSection, summary, setSummary, draft, setDraft, messages, setMessages, note, setNote, notes, setNotes };
}

export function ProductMeetingPanel({ tab, onTab, onClose, onTask, compact, state }: {
  tab: DemoMeetingTab; onTab: (tab: DemoMeetingTab) => void; onClose: () => void;
  onTask?: (title: string) => void; compact: boolean; state: ReturnType<typeof useDemoMeetingPanelState>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const { section, setSection, summary, setSummary, draft, setDraft, messages, setMessages, note, setNote, notes, setNotes } = state;
  const label = (value: DemoMeetingTab) => t({ copilot: "meetings.aiCopilot", chat: "meetings.chat", participants: "meetings.people", motions: "meetings.governance.motionsTab", recordings: "meetings.recordingsTab" }[value]);
  const sectionLabel = (value: typeof section) => t({ insights: "meetings.insightsTab", notes: "meetings.notes", transcript: "meetings.transcriptTab", actions: "meetings.actionsTab" }[value]);
  return <aside className="product-meeting-panel" aria-label={t("meetings.roomPanel")}>
    <div className="product-meeting-panel-tabs"><MeetingUnderlineTabs tabs={MEETING_DEMO_TABS} value={tab} onChange={onTab} label={label} panelId={value => `${id}-${value}`} />{compact && <Button size="icon" variant="ghost" aria-label={t("common.close")} onClick={onClose}><X aria-hidden /></Button>}</div>
    <div className="product-meeting-panel-content" role="tabpanel" id={`${id}-${tab}`} aria-label={label(tab)}>
      {tab === "copilot" && <>
        <MeetingCopilotHeader canHost aiOn hasSource hasSummary={summary} generating={false} onGenerate={() => setSummary(true)} />
        <MeetingUnderlineTabs tabs={COPILOT_SECTIONS} value={section} onChange={setSection} label={sectionLabel} />
        <div className="product-meeting-copilot-body">
          {section === "insights" && (summary ? <><h3>{t("meetings.aiSummary")}</h3><p>{t("landing.playback.meetingGoal")}</p><ul>{["brief", "design", "launch"].map(key => <li key={key}>{t(`landing.playback.tasks.${key}`)}</li>)}</ul></> : <p>{t("meetings.summaryEmpty")}</p>)}
          {section === "transcript" && <><small>09:12 · Minh Linh</small><p>{t("landing.reference.meetingChat")}</p><small>09:15 · Hoàng Anh</small><p>{t("landing.studio.message2")}</p></>}
          {section === "notes" && <><p>{t("landing.playback.meetingGoal")}</p>{notes.map((value, index) => <p key={index}>{value}</p>)}<form onSubmit={event => { event.preventDefault(); if (note.trim()) { setNotes(current => [...current, note.trim()].slice(-8)); setNote(""); } }}><Input value={note} onChange={event => setNote(event.target.value)} aria-label={t("meetings.notesInputLabel")} placeholder={t("meetings.notesPlaceholder")} maxLength={500} /><Button type="submit" variant="outline" size="icon" aria-label={t("meetings.addNote")} disabled={!note.trim()}><Send aria-hidden /></Button></form></>}
          {section === "actions" && (summary ? <><p>{t("landing.studio.task_design")}</p><MeetingCopilotTasksCta count={1} disabled={!onTask} onClick={() => onTask?.(t("landing.studio.task_design"))} /></> : <p>{t("meetings.summaryEmpty")}</p>)}
        </div>
        <MeetingCopilotFooter />
        <small className="product-meeting-sample">{t("landing.lovable.sample")}</small>
      </>}
      {tab === "participants" && <div className="product-meeting-roster">{DEMO_MEETING_PEOPLE.map(name => <div key={name}><MeetingPersonAvatar name={name} size="default" /><span><strong>{name}</strong><small>{t("landing.lovable.member")}</small></span></div>)}</div>}
      {tab === "chat" && <><div className="product-meeting-chat-log" role="log" aria-label={t("meetings.chat")}><small>09:12 · Minh Linh</small><p>{t("landing.reference.meetingChat")}</p>{messages.map((message, index) => <div key={index}><small>Đạt Đặng</small><p>{message}</p></div>)}</div><form className="product-meeting-chat-form" onSubmit={event => { event.preventDefault(); if (draft.trim()) { setMessages(current => [...current, draft.trim()].slice(-8)); setDraft(""); } }}><Input value={draft} onChange={event => setDraft(event.target.value)} aria-label={t("meetings.chatPlaceholder")} placeholder={t("meetings.chatPlaceholder")} maxLength={500} /><Button type="submit" variant="brand" size="icon" aria-label={t("landing.demo.send")} disabled={!draft.trim()}><Send aria-hidden /></Button></form></>}
      {tab === "recordings" && <p className="product-meeting-empty">{t("meetings.recordingsEmpty")}</p>}
      {tab === "motions" && <p className="product-meeting-empty">{t("meetings.governance.motionsEmpty")}</p>}
    </div>
  </aside>;
}
