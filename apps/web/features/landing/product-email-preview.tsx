"use client";

import { DEMO_PROFILE } from "./product-demo-data";

import { useContext, useRef, useState, type KeyboardEvent, type ReactNode, type RefCallback } from "react";
import { createPortal } from "react-dom";
import { Inbox, SearchX } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmailHubThread } from "@uniwork/core/types/email-hub";
import { Button } from "@uniwork/ui/components/ui/button";
import { EmailHubFolderSidebar, type EmailHubFolderKey } from "@uniwork/views/email-hub/email-hub-folder-sidebar";
import { EmailHubListHeader } from "@uniwork/views/email-hub/email-hub-list-header";
import { EmailHubShortcutsDialog } from "@uniwork/views/email-hub/email-hub-shortcuts-dialog";
import { EmailHubSnoozeDialog } from "@uniwork/views/email-hub/email-hub-snooze-dialog";
import { EmailHubThreadListItem } from "@uniwork/views/email-hub/email-hub-thread-list-item";
import { EmailHubEmptyState } from "@uniwork/views/email-hub/email-hub-view-parts";
import { ProductEmailCompose, emptyEmailDraft, type DemoEmailDraft } from "./product-email-compose";
import { DEMO_MAILBOX, demoEmailThreads } from "./product-email-data";
import { ProductEmailReader } from "./product-email-reader";
import { ProductDemoPlaybackSlot } from "./product-demo-playback-slot";

export function ProductEmailPreview({ step, control, cursor, stageRef, label }: {
  step?: number; control?: ReactNode; cursor?: ReactNode; stageRef?: RefCallback<HTMLDivElement>; label?: string;
}) {
  const movie = step !== undefined;
  const controlSlot = useContext(ProductDemoPlaybackSlot);
  return <div className="product-email-preview">
    {control && (controlSlot ? createPortal(control, controlSlot) : <div className="product-email-inline-controls">{control}</div>)}
    <div className="product-email-stage" ref={stageRef} role={movie ? "img" : undefined} aria-label={movie ? label : undefined} data-scene-kind="email">
      <div className="product-email-scene" inert={movie || undefined} aria-hidden={movie || undefined}><EmailWorkspace step={step} /></div>
      {cursor}
    </div>
  </div>;
}

/** The same folder rail, list header, rows, reader actions and composer as the application. */
function EmailWorkspace({ step }: { step?: number }) {
  const { t } = useTranslation();
  const root = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);
  const [changes, setChanges] = useState<Record<string, Partial<EmailHubThread>>>({});
  const [outbox, setOutbox] = useState<EmailHubThread[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DemoEmailDraft>>({});
  const [folder, setFolder] = useState<EmailHubFolderKey>("INBOX");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [unread, setUnread] = useState(false);
  const [files, setFiles] = useState(false);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [compose, setCompose] = useState<DemoEmailDraft | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [shortcuts, setShortcuts] = useState(true);
  const [notice, setNotice] = useState("");
  const [customSnooze, setCustomSnooze] = useState(false);
  const [synced, setSynced] = useState(false);
  const movie = step !== undefined;
  const base = demoEmailThreads(t);
  const all = [...base, ...outbox].map(row => ({ ...row, ...changes[row.id], ...(movie && row.id === base[0]!.id ? { is_read: step > 0, is_starred: step >= 2 } : {}) }));
  const selected = all.find(row => row.id === (movie ? step > 0 ? base[0]!.id : null : selectedId));
  const folderRows = all.filter(row => folder === "STARRED" ? row.is_starred : row.folder === folder);
  const rows = folderRows.filter(row => (!unread || !row.is_read) && (!files || row.has_attachments) && `${row.from_name} ${row.from_addr} ${row.subject} ${row.body_text}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const patch = (id: string, change: Partial<EmailHubThread>) => setChanges(value => ({ ...value, [id]: { ...value[id], ...change } }));
  const selectFolder = (value: EmailHubFolderKey) => { setFolder(value); setSelectedId(null); setSearch(""); setChecked(new Set()); setAiOpen(false); };
  const openThread = (id: string) => {
    const draft = drafts[id];
    if (draft) { setCompose({ ...draft, id }); return; }
    setSelectedId(id); patch(id, { is_read: true }); setAiOpen(false);
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>("#demo-email-subject")?.focus({ preventScroll: true }));
  };
  const back = () => { setSelectedId(null); requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-thread-row="${selectedId}"]`)?.focus({ preventScroll: true })); };
  const moveSelected = (value: string) => { if (selected) patch(selected.id, { folder: value }); back(); };
  const toggleStar = (row: EmailHubThread) => patch(row.id, { is_starred: !row.is_starred });
  const reply = (mode: "reply" | "replyAll" | "forward") => {
    if (!selected) return;
    setCompose({ ...emptyEmailDraft(), to: mode === "forward" ? [] : [selected.from_addr], subject: `${mode === "forward" ? "Fwd" : "Re"}: ${selected.subject}`, body: mode === "forward" ? `${selected.from_name}\n${selected.body_text}` : "" });
  };
  const saveDraft = (draft: DemoEmailDraft | null, destination = "DRAFTS", sendAt?: string) => {
    const id = draft?.id ?? compose?.id ?? `demo-outbox-${++sequence.current}`;
    setCompose(null);
    if (!draft) { setOutbox(value => value.filter(row => row.id !== id)); setDrafts(value => { const next = { ...value }; delete next[id]; return next; }); return; }
    const row: EmailHubThread = { id, account_id: DEMO_MAILBOX.id, folder: destination, subject: draft.subject || t("email_hub.no_subject"), snippet: draft.body, body_text: draft.body, from_name: DEMO_PROFILE.name, from_addr: DEMO_MAILBOX.email_address, to_addrs: draft.to, sent_at: sendAt ?? new Date().toISOString(), is_read: true, is_starred: false, body_cached: true, has_attachments: draft.attachments.length > 0, attachments: draft.attachments.map(att => ({ id: att.id, filename: att.file.name, mime_type: att.file.type, size_bytes: att.file.size })), imap_labels: [] };
    setOutbox(value => [...value.filter(item => item.id !== id), row]);
    setDrafts(value => { const next = { ...value }; if (destination === "DRAFTS") next[id] = draft; else delete next[id]; return next; });
    setNotice(t(destination === "DRAFTS" ? "landing.productDemo.email.draftSaved" : "landing.productDemo.email.sentLocally"));
  };
  const applySnooze = (until: string) => { if (selected) patch(selected.id, { folder: "SNOOZED", snoozed_until: until }); setCustomSnooze(false); back(); };
  const actions = {
    onBack: back, onToggleStar: () => selected && toggleStar(selected), onReply: () => reply("reply"), onReplyAll: () => reply("replyAll"), onForward: () => reply("forward"),
    onMarkUnread: () => { if (selected) patch(selected.id, { is_read: false }); back(); },
    onRestoreInbox: () => moveSelected("INBOX"), onNotSpam: () => moveSelected("INBOX"), onArchive: () => moveSelected("ARCHIVE"), onSpam: () => moveSelected("SPAM"), onTrash: () => moveSelected("TRASH"),
    onClearSnooze: () => { if (selected) patch(selected.id, { folder: "INBOX", snoozed_until: undefined }); back(); },
    onSnooze: (preset: "tomorrow" | "next_week" | "custom") => { if (preset === "custom") { setCustomSnooze(true); return; } const date = new Date(); date.setDate(date.getDate() + (preset === "tomorrow" ? 1 : 7)); date.setHours(9, 0, 0, 0); applySnooze(date.toISOString()); },
    onToggleAi: () => setAiOpen(value => !value), onRefetch: () => setNotice(t("landing.productDemo.saved")), onDownloadAttachment: () => setNotice(t("landing.productDemo.email.sampleAttachment")),
  };
  const accountMenu = { accounts: [DEMO_MAILBOX], activeAccountId: DEMO_MAILBOX.id, disconnectPending: false, onSelectAccount: () => {}, onDisconnect: (_id: string, done: () => void) => { setNotice(t("landing.productDemo.email.localOnly")); done(); }, onAddAccount: () => setNotice(t("landing.productDemo.email.localOnly")), onReconnect: () => setNotice(t("landing.productDemo.email.localOnly")) };
  const nav = { folder, selectedLabel: null, imapLabels: [], counts: { inboxUnread: all.filter(row => row.folder === "INBOX" && !row.is_read).length, scheduled: all.filter(row => row.folder === "SCHEDULED").length, snoozed: all.filter(row => row.folder === "SNOOZED").length }, onFolderChange: selectFolder, onLabelChange: () => {} };
  const onCompose = () => setCompose(emptyEmailDraft());
  const onOpenShortcuts = () => setShortcutsOpen(true);
  const bulkPatch = (change: Partial<EmailHubThread>) => { checked.forEach(id => patch(id, change)); setChecked(new Set()); };
  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!shortcuts || event.ctrlKey || event.metaKey || event.altKey || target.closest("input,textarea,[contenteditable=true],[role=dialog],[role=menu]")) return;
    const key = event.key.toLowerCase();
    const commands: Record<string, () => void> = { c: onCompose, "/": () => searchRef.current?.focus(), "?": onOpenShortcuts, escape: back, u: back };
    if (selected) Object.assign(commands, { r: actions.onReply, a: actions.onReplyAll, f: actions.onForward, e: actions.onArchive, "#": actions.onTrash, s: actions.onToggleStar, ...(event.shiftKey ? { u: actions.onMarkUnread } : {}) });
    if (key === "j" || key === "k") {
      event.preventDefault(); const index = rows.findIndex(row => row.id === (selected?.id ?? target.closest<HTMLElement>("[data-thread-row]")?.dataset.threadRow)); const next = rows[Math.max(0, Math.min(rows.length - 1, index + (key === "j" ? 1 : -1)))];
      if (next) { if (selected) openThread(next.id); else root.current?.querySelector<HTMLElement>(`[data-thread-row="${next.id}"]`)?.focus(); } return;
    }
    if (commands[key]) { event.preventDefault(); commands[key](); }
  };
  return <section ref={root} className="product-email-workspace" aria-label={t("email_hub.title")} onKeyDownCapture={handleKey}>
    <EmailHubFolderSidebar {...nav} composeDisabled={false} onCompose={onCompose} accountMenu={accountMenu} shortcutsOn={shortcuts} onOpenShortcuts={onOpenShortcuts} />
    <div className="product-email-main">
      {selected ? <ProductEmailReader thread={selected} folder={folder} actions={actions} aiOpen={aiOpen} /> : <>
        <EmailHubListHeader headingAs="h2" nav={nav} accountMenu={accountMenu} isScheduledFolder={false} searchInput={search} onSearchInputChange={setSearch} searchRef={searchRef} refreshDisabled={false} refreshing={false} onRefresh={() => setSynced(true)} unreadOnly={unread} onToggleUnreadOnly={() => setUnread(value => !value)} hasAttachmentsOnly={files} onToggleAttachmentsOnly={() => setFiles(value => !value)} countText={t("email_hub.list_count", { count: folderRows.length, unread: folderRows.filter(row => !row.is_read).length })} lastSyncText={t("email_hub.last_sync", { when: synced ? new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "11:10 AM" })} composeDisabled={false} onCompose={onCompose} onOpenShortcuts={onOpenShortcuts} shortcutsOn={shortcuts} bulk={checked.size ? { count: checked.size, allChecked: rows.every(row => checked.has(row.id)), onToggleAll: value => setChecked(value ? new Set(rows.map(row => row.id)) : new Set()), onClear: () => setChecked(new Set()), onMarkRead: value => bulkPatch({ is_read: value }), onArchive: () => bulkPatch({ folder: "ARCHIVE" }), onTrash: () => bulkPatch({ folder: "TRASH" }), pending: false } : null} />
        <div className="product-email-list @container">
          {rows.length ? <ul>{rows.map(row => <EmailHubThreadListItem key={row.id} row={row} listFolder={folder} checked={checked.has(row.id)} selectionMode={checked.size > 0} onCheckedChange={value => setChecked(current => { const next = new Set(current); if (value) next.add(row.id); else next.delete(row.id); return next; })} onSelect={() => openThread(row.id)} onPrefetch={() => {}} onToggleStar={() => toggleStar(row)} />)}</ul> : <EmailHubEmptyState icon={search || unread || files ? SearchX : Inbox} message={t(search || unread || files ? "email_hub.search_empty" : `email_hub.empty.${folder.toLowerCase()}`)} />}
        </div>
      </>}
      {notice && <div className="product-email-notice" role="status"><span>{notice}</span><Button variant="ghost" size="sm" onClick={() => setNotice("")}>{t("common.close")}</Button></div>}
    </div>
    {compose && <ProductEmailCompose initial={compose} onClose={draft => saveDraft(draft)} onSave={(draft, sendAt) => saveDraft(draft, sendAt ? "SCHEDULED" : "SENT", sendAt)} />}
    <EmailHubShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} enabled={shortcuts} onEnabledChange={setShortcuts} />
    <EmailHubSnoozeDialog open={customSnooze} onOpenChange={setCustomSnooze} pending={false} onConfirm={when => applySnooze(when.toISOString())} />
  </section>;
}
