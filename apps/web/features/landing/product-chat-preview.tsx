"use client";

import { useState, type ReactNode, type RefCallback } from "react";
import { Ellipsis, ListChecks, PanelLeftClose, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { useIsCompact } from "@uniwork/ui/hooks/use-mobile";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { ChatComposer } from "@uniwork/views/chat/chat-composer";
import { ChatConversationHeader } from "@uniwork/views/chat/chat-conversation-header";
import { ChatMessageRow } from "@uniwork/views/chat/chat-message-row";
import { ChatPresenceAvatar } from "@uniwork/views/chat/chat-presence-avatar";
import { SidebarNavItem } from "@uniwork/views/chat/chat-sidebar-rows";
import { ProductDemoPlaybackSlot } from "./product-demo-playback-slot";
import { useContext } from "react";
import { createPortal } from "react-dom";

type Props = { messages?: string[]; onSend?: (message: string) => void; onTask?: () => void; created?: boolean; onCreate?: () => void; step?: number; control?: ReactNode; cursor?: ReactNode; stageRef?: RefCallback<HTMLDivElement>; label?: string };

/** The production conversation rows and composer, with local messages and task creation. */
export function ProductChatPreview({ messages = [], onSend, onTask, created = false, onCreate, step, control, cursor, stageRef, label }: Props) {
  const { t } = useTranslation();
  const compact = useIsCompact();
  const controlSlot = useContext(ProductDemoPlaybackSlot);
  const [room, setRoom] = useState(0);
  const [sidebar, setSidebar] = useState(true);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [reactions, setReactions] = useState(false);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");
  const [pinned, setPinned] = useState(false);
  const movie = step !== undefined;
  const taskCreated = movie ? step === 4 : created;
  const rooms = ["UNICOM", "Product launch", "Minh Linh", "Hoàng Anh"];
  const bodies = [t("landing.studio.message1"), t("landing.actionDemo.chatTaskTitle"), t("landing.studio.message2"), ...messages];
  const people = ["Minh Linh", "Hoàng Anh", "Đạt Đặng"];
  const sampleNotice = () => setNotice(t("landing.lovable.sample"));
  const createDialog = movie ? step === 2 || step === 3 : creating;
  const sidebarContent = <aside className="product-chat-sidebar"><header><h2>{t("chat.title")}</h2><Button variant="ghost" size="icon" aria-label={t("chat.follow_up.list_title")} onClick={sampleNotice}><ListChecks aria-hidden /></Button><Button variant="ghost" size="icon" aria-label={t("chat.new_conversation_aria")} onClick={sampleNotice}><Plus aria-hidden /></Button><Button variant="ghost" size="icon" aria-label={t("chat.hide_conversations")} onClick={() => setSidebar(false)}><PanelLeftClose aria-hidden /></Button></header><div className="px-3 pb-3"><Input type="search" placeholder={t("chat.search_conversations")} aria-label={t("chat.search_conversations_label")} value={query} onChange={event => setQuery(event.target.value)} /></div><div className="flex gap-2 px-3 pb-2"><Button size="sm" variant="secondary">{t("chat.filter_all")}</Button><Button size="sm" variant="ghost" onClick={sampleNotice}>{t("chat.filter_activity_all")}</Button></div><nav aria-label={t("chat.sidebar_nav")}>{rooms.map((title, index) => title.toLowerCase().includes(query.toLowerCase()) && <SidebarNavItem key={title} active={room === index} onClick={() => { setRoom(index); if (compact) setSidebar(false); }} avatar={<ChatPresenceAvatar name={title} initials={index < 2 ? "U" : index === 2 ? "ML" : "HA"} size="lg" online={index > 1} />} title={title} fallbackSubtitle={index === 0 ? t("chat.workspace_room") : bodies[index % 3]} previewOptions={{ currentUserId: "demo", isGroup: index < 2, youLabel: t("chat.you"), voiceCallLabel: t("chat.sidebar_voice_call_preview"), voiceMessageLabel: t("chat.sidebar_voice_message_preview"), yesterdayLabel: t("chat.sidebar_yesterday") }} unread={index === 1 ? 2 : 0} unreadBadgesReady />)}</nav></aside>;
  return <div className="product-chat-preview" data-scene-kind="chat">
    {control && (controlSlot ? createPortal(control, controlSlot) : <div className="product-email-inline-controls">{control}</div>)}
    <div ref={stageRef} className="product-chat-stage" role={movie ? "img" : undefined} aria-label={label}>
      <div className="product-chat-scene" inert={movie || undefined} aria-hidden={movie || undefined} data-sidebar={movie ? !compact : sidebar}>
        {sidebarContent}
        <section className="product-chat-conversation" aria-label={rooms[room]}>
          <ChatConversationHeader avatar={<ChatPresenceAvatar name={rooms[room]!} initials={room < 2 ? "U" : room === 2 ? "ML" : "HA"} size="lg" online={room > 1} />} title={rooms[room]!} subtitle={room < 2 ? t("workspace.members", { count: 4 }) : t("chat.presence_online")} onBack={() => setSidebar(true)} backAriaLabel={t("chat.title")} sidebarCollapsed={!sidebar} onToggleSidebar={() => setSidebar(value => !value)} sidebarToggleAriaLabel={t("chat.title")} onSearch={sampleNotice} searchAriaLabel={t("chat.search_messages")} onOpenSettings={sampleNotice} settingsAriaLabel={t("chat.dm_settings")} onVoiceCall={sampleNotice} voiceCallAriaLabel={t("chat.sidebar_voice_call_preview")} onVideoCall={sampleNotice} videoCallAriaLabel={t("nav.meetings")} />
          <div className="product-chat-messages" role="log" aria-label={t("chat.title")}><p className="text-center text-caption text-muted-foreground">16/10/2026</p>{bodies.map((body, index) => <ChatMessageRow key={`${index}-${body}`} message={{ id: `demo-chat-${index}`, sender: people[index % 3]!, body, ts: new Date(2026, 9, 16, 9, 12 + index * 3).getTime(), reactions: index === 1 && reactions ? { "👍": 1 } : {}, pinned: index === 1 && pinned }} senderLabel={people[index % 3]!} isOwn={index > 1} showReadReceipt={index === bodies.length - 1} showSenderName onReply={() => setReply(body)} onReact={() => setReactions(value => !value)} onToggleReaction={() => setReactions(value => !value)} onPin={() => setPinned(value => !value)} onCopy={() => setNotice(t("landing.productDemo.saved"))} onCreateTask={() => setCreating(true)} onEdit={index > 1 ? () => setDraft(body) : undefined} onDelete={index > 1 ? sampleNotice : undefined} />)}
            {taskCreated && <Button variant="outline" className="product-chat-task-result" data-demo-result="chat-task" onClick={onTask}><ListChecks aria-hidden />UNI-22 · {t("landing.actionDemo.chatTaskTitle")}</Button>}
            {movie && step === 1 && <div className="product-chat-movie-action" data-demo-target="create-from-message"><ListChecks aria-hidden />{t("landing.actionDemo.createFromMessage")}</div>}
            {movie && step === 0 && <span className="product-chat-movie-target" data-demo-target="message-menu"><Ellipsis aria-hidden /></span>}
          </div>
          {reply && <div className="flex items-center gap-2 border-t border-border px-4 py-2 text-caption"><span className="min-w-0 flex-1 truncate">{reply}</span><Button size="sm" variant="ghost" onClick={() => setReply(null)}>{t("common.cancel")}</Button></div>}
          <ChatComposer workspaceId="" draft={draft} onDraftChange={setDraft} onSend={() => { if (draft.trim()) onSend?.(draft.trim()); setDraft(""); setReply(null); }} placeholder={t("landing.demo.messagePlaceholder")} sendLabel={t("landing.demo.send")} onRecordVoice={sampleNotice} onAttachAction={sampleNotice} onSendMedia={sampleNotice} onSendFile={file => { onSend?.(file.name); }} />
          {notice && <p className="product-documents-notice" role="status">{notice}</p>}
        </section>
        {movie && createDialog && <div className="product-chat-dialog-overlay"><div className="product-chat-dialog"><h2>{t("landing.actionDemo.createFromMessage")}</h2><label>{t("tasks.title")}<Input value={t("landing.actionDemo.chatTaskTitle")} readOnly /></label><Button data-demo-target="create-confirm" data-demo-pending={step === 3 ? "create" : undefined}>{t(step === 3 ? "landing.actionDemo.creating" : "common.create")}</Button></div></div>}
      </div>{cursor}
    </div>
    <Dialog open={!movie && creating} onOpenChange={setCreating}><DialogContent><DialogHeader><DialogTitle>{t("landing.actionDemo.createFromMessage")}</DialogTitle><DialogDescription>{t("landing.lovable.sample")}</DialogDescription></DialogHeader><label>{t("tasks.title")}<Input value={t("landing.actionDemo.chatTaskTitle")} readOnly /></label><DialogFooter><Button variant="outline" onClick={() => setCreating(false)}>{t("common.cancel")}</Button><Button onClick={() => { if (!created) onCreate?.(); setCreating(false); }}>{t("common.create")}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
