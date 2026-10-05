"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { cn } from "@uniwork/ui/lib/utils";
import type { PdfNoteIdentity, PdfNoteRow, PdfNoteThread, PdfNotesPanelProps } from "./types";

function identityOf(row: PdfNoteRow): PdfNoteIdentity {
  return { pageIndex: row.pageIndex, objNum: row.objNum, rect: row.rect, contents: row.contents };
}

/**
 * Lists saved PDF note threads (root + replies) and exposes add, reply, edit
 * and resolve through the browser-safe provider. A thread member the host
 * cannot act on stays visible as read-only, so users are not misled into
 * thinking the host dropped it.
 */
export function PdfNotesPanel({ threads, provider, addTarget, loading = false, error = null, disabled = false, className, onApplied }: PdfNotesPanelProps) {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [replyDraft, setReplyDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [errorId, setErrorId] = useState<string | null>(null);

  const canAct = (row: PdfNoteRow): boolean => provider !== undefined && row.binding !== "unbound";
  const canCompose = provider !== undefined && addTarget !== undefined && addTarget !== null;

  const run = async (id: string, action: () => Promise<void> | void) => {
    if (pending) return;
    setPending(true);
    setErrorId(null);
    try {
      await action();
      onApplied?.();
    } catch {
      setErrorId(id);
    } finally {
      setPending(false);
    }
  };

  const submitEdit = (row: PdfNoteRow) => run(row.id, async () => {
    if (!provider || draft.trim() === "") return;
    await provider.editNote({ identity: identityOf(row), contents: draft });
    setEditingId(null);
    setDraft("");
  });

  const submitReply = (thread: PdfNoteThread) => run(thread.id, async () => {
    if (!provider || replyDraft.trim() === "") return;
    await provider.replyToNote({ replyTo: identityOf(thread.root), contents: replyDraft });
    setReplyingId(null);
    setReplyDraft("");
  });

  const submitAdd = () => run("add", async () => {
    if (!provider || !addTarget || draft.trim() === "") return;
    await provider.addNote({ pageIndex: addTarget.pageIndex, rect: addTarget.rect, contents: draft });
    setDraft("");
  });

  const rowError = (id: string) => errorId === id ? <p role="alert" className="text-caption text-destructive">{t("office.pdf.notes.error")}</p> : null;

  return (
    <section className={cn("grid gap-2", className)} data-testid="pdf-notes-panel" aria-label={t("office.pdf.notes.title")}>
      <h2 className="text-label font-medium">{t("office.pdf.notes.title")}</h2>
      {error !== null ? <p role="alert" className="text-caption text-destructive">{error === "" ? t("office.pdf.notes.error") : error}</p> : null}
      {canCompose ? (
        <div className="grid gap-1" data-testid="pdf-note-add">
          <label className="sr-only" htmlFor="pdf-note-add-draft">{t("office.pdf.notes.add")}</label>
          <Textarea id="pdf-note-add-draft" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t("office.pdf.notes.addPlaceholder")} disabled={disabled || pending} />
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void submitAdd()} disabled={disabled || pending || draft.trim() === ""}>{t("office.pdf.notes.add")}</Button>
            {rowError("add")}
          </div>
        </div>
      ) : null}
      {loading ? (
        <p role="status" className="flex items-center gap-2 text-caption text-muted-foreground" data-testid="pdf-notes-loading">
          <Spinner aria-hidden className="size-3.5" />
          {t("common.loading")}
        </p>
      ) : null}
      {!loading && error === null && threads.length === 0 ? <p className="text-caption text-muted-foreground">{t("office.pdf.notes.empty")}</p> : null}
      {!loading && threads.length > 0 ? (
        <ul className="grid gap-2" aria-label={t("office.pdf.notes.title")}>
          {threads.map((thread) => (
            <li key={thread.id} className="grid gap-1 rounded-md border border-border px-2 py-1.5" data-testid={`pdf-note-thread-${thread.id}`}>
              <div className="grid gap-1" data-testid={`pdf-note-${thread.root.id}`}>
                <p className="break-words text-body">{thread.root.contents}</p>
                <p className="text-caption text-muted-foreground">
                  {t("office.pdf.pages.page", { page: thread.root.page })}
                  {thread.root.author ? ` · ${thread.root.author}` : ""}
                  {thread.root.resolved ? ` · ${t("office.pdf.notes.resolved")}` : ""}
                </p>
                {canAct(thread.root) ? (
                  <div className="flex flex-wrap items-center gap-1">
                    <Button type="button" variant="ghost" size="sm" aria-pressed={thread.root.resolved === true} disabled={disabled || pending} onClick={() => void run(thread.root.id, async () => { await provider!.resolveNote({ identity: identityOf(thread.root), resolved: thread.root.resolved !== true }); })}>
                      {thread.root.resolved ? t("office.pdf.notes.unresolve") : t("office.pdf.notes.resolve")}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" disabled={disabled || pending} onClick={() => { setEditingId(editingId === thread.root.id ? null : thread.root.id); setDraft(thread.root.contents); }}>{t("office.pdf.notes.edit")}</Button>
                    <Button type="button" variant="ghost" size="sm" disabled={disabled || pending} onClick={() => { setReplyingId(replyingId === thread.id ? null : thread.id); setReplyDraft(""); }}>{t("office.pdf.notes.reply")}</Button>
                  </div>
                ) : <span className="text-caption text-muted-foreground">{t("office.pdf.notes.readOnly")}</span>}
                {rowError(thread.root.id)}
              </div>
              {thread.replies.length > 0 ? (
                <ul className="grid gap-1 border-l border-border pl-3" aria-label={t("office.pdf.notes.replies")}>
                  {thread.replies.map((reply) => (
                    <li key={reply.id} className="grid gap-0.5" data-testid={`pdf-note-${reply.id}`}>
                      <p className="break-words text-body">{reply.contents}</p>
                      <p className="text-caption text-muted-foreground">
                        {t("office.pdf.pages.page", { page: reply.page })}
                        {reply.author ? ` · ${reply.author}` : ""}
                        {reply.binding === "unbound" ? ` · ${t("office.pdf.notes.readOnly")}` : ""}
                      </p>
                      {rowError(reply.id)}
                    </li>
                  ))}
                </ul>
              ) : null}
              {editingId === thread.root.id && canAct(thread.root) ? (
                <div className="grid gap-1" data-testid={`pdf-note-edit-${thread.root.id}`}>
                  <label className="sr-only" htmlFor={`pdf-note-edit-draft-${thread.root.id}`}>{t("office.pdf.notes.edit")}</label>
                  <Textarea id={`pdf-note-edit-draft-${thread.root.id}`} value={draft} onChange={(event) => setDraft(event.target.value)} disabled={disabled || pending} />
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => void submitEdit(thread.root)} disabled={disabled || pending || draft.trim() === ""}>{t("office.pdf.notes.editSave")}</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setEditingId(null); setDraft(""); }} disabled={pending}>{t("office.pdf.notes.cancel")}</Button>
                  </div>
                </div>
              ) : null}
              {replyingId === thread.id && canAct(thread.root) ? (
                <div className="grid gap-1" data-testid={`pdf-note-reply-${thread.id}`}>
                  <label className="sr-only" htmlFor={`pdf-note-reply-draft-${thread.id}`}>{t("office.pdf.notes.reply")}</label>
                  <Textarea id={`pdf-note-reply-draft-${thread.id}`} value={replyDraft} onChange={(event) => setReplyDraft(event.target.value)} placeholder={t("office.pdf.notes.replyPlaceholder")} disabled={disabled || pending} />
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => void submitReply(thread)} disabled={disabled || pending || replyDraft.trim() === ""}>{t("office.pdf.notes.replySubmit")}</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setReplyingId(null); setReplyDraft(""); }} disabled={pending}>{t("office.pdf.notes.cancel")}</Button>
                  </div>
                  {rowError(thread.id)}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-caption text-muted-foreground">{t("office.pdf.notes.contentNotice")}</p>
    </section>
  );
}
