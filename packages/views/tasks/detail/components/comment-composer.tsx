"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp } from "lucide-react";
import type { UploadFileFn } from "@uniwork/core/hooks/use-file-upload";
import type { Attachment } from "@uniwork/core/types";
import { FileUploadButton } from "@uniwork/ui/components/common/file-upload-button";
import { Button } from "@uniwork/ui/components/ui/button";
import { useCommentDraftStore } from "@uniwork/core/tasks/stores/comment-draft-store";
import {
  ContentEditor,
  type ContentEditorRef,
  useComposerSubmit,
  useEditorUpload,
  useLazyEditor,
  useUploadGate,
} from "../../../editor";

/**
 * Same interval `task-detail-editors.tsx` uses for the description field's
 * autosave (`ContentEditor`'s `debounceMs`) — the house delay for "write
 * this to storage a little after the person stops typing." Applied by hand
 * here instead of via `ContentEditor`'s own `debounceMs` because that prop
 * would also delay `onUpdate`, and the Send button's `isEmpty` state must
 * track the caret exactly, not lag a debounce window behind it.
 */
const DRAFT_DEBOUNCE_MS = 1500;

/**
 * Lazy ContentEditor comment composer. Submit awaits the server; draft stays
 * on failure (useComposerSubmit contract).
 */
export function TaskCommentComposer({
  taskId,
  composerKey,
  attachments,
  uploadFile,
  compact = false,
  onSubmit,
}: {
  taskId: string;
  /** Distinguishes composers on the same task: the main box and each reply box. */
  composerKey?: string;
  attachments?: Attachment[];
  uploadFile?: UploadFileFn;
  compact?: boolean;
  onSubmit: (body: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const key = composerKey ?? taskId;
  const editorRef = useRef<ContentEditorRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const draft = useCommentDraftStore((state) => state.draftFor(key));
  const setDraft = useCommentDraftStore((state) => state.setDraft);
  const clearDraft = useCommentDraftStore((state) => state.clearDraft);
  const [isEmpty, setIsEmpty] = useState(!draft.trim());
  const uploadGate = useUploadGate(editorRef);
  const editorUpload = useEditorUpload(uploadFile);
  const lazy = useLazyEditor({
    // An unsent draft is proof of edit intent, which is exactly the case
    // `initialActive` documents. Without it the composer renders the static
    // stand-in — showing the placeholder, not the draft — while `isEmpty` is
    // already seeded false from that draft: Send looks enabled over what
    // looks like an empty box, and clicking it runs submit() against a null
    // editor ref, so the hook reads "", the empty guard returns, and nothing
    // happens at all.
    initialActive: draft.trim().length > 0,
    editorRef,
    resetKey: key,
  });

  // Debounced draft write ONLY: `pendingDraftRef` holds the latest markdown
  // not yet persisted, flushed on unmount so mid-debounce navigation can't
  // silently drop the last keystrokes. `onAccepted` used to also read this
  // ref to decide what to keep, but it can lag the live document (see
  // `onAccepted` below) — that decision now reads the editor directly.
  const draftTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pendingDraftRef = useRef<string | null>(null);
  // What `submit()` actually sent (post-normalize), captured at submit time
  // so `onAccepted` can tell "everything on screen was sent" from "there is
  // unsent text" — the editor is not locked while the send is in flight.
  const lastSubmittedRef = useRef<string | null>(null);

  const cancelPendingDraftWrite = () => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = undefined;
    pendingDraftRef.current = null;
  };

  useEffect(() => {
    return () => {
      if (pendingDraftRef.current !== null) {
        setDraft(key, pendingDraftRef.current);
      }
      cancelPendingDraftWrite();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- flush-on-unmount only, not on every key/setDraft identity change
  }, [key]);

  const { submitting, submit } = useComposerSubmit({
    editorRef,
    uploadGate,
    afterAccepted: "blur",
    onSubmit: (body) => {
      lastSubmittedRef.current = body;
      return onSubmit(body);
    },
    onAccepted: () => {
      // `pendingDraftRef` is only as fresh as ContentEditor's own internal
      // forward, which it debounces via its own setTimeout even at
      // debounceMs={0} — so it can lag the live document by a keystroke in
      // either direction around the server's response. The live editor is
      // the same source submit() itself reads (`getMarkdown()`) and is
      // authoritative; read it here, before clearContent() replaces it.
      const rawLive = editorRef.current?.getMarkdown() ?? "";
      // Mirrors use-composer-submit.ts's own (private, unexported)
      // `defaultNormalize`, which submit() applies before calling onSubmit —
      // comparing un-normalized raw markdown against `lastSubmittedRef`
      // would flag a trailing-newline-only difference as "new content" and
      // resurrect a phantom draft after an ordinary clean send. Stays
      // correct only as long as this composer doesn't pass a custom
      // `normalize` to useComposerSubmit (it doesn't, today).
      const liveMarkdown = rawLive.replace(/(\n\s*)+$/, "").trim();
      cancelPendingDraftWrite();
      if (liveMarkdown !== lastSubmittedRef.current) {
        // Typed while the send was in flight — keep it, on screen as well as
        // in the draft store. Clearing here would wipe text this very branch
        // decided to keep, and `defaultValue` is mount-only, so nothing
        // would ever put it back. This is also what useComposerSubmit's own
        // contract promises: success clears only the draft it submitted.
        setDraft(key, liveMarkdown);
        return;
      }
      // Everything on screen was sent — nothing left to keep.
      clearDraft(key);
      // The resulting `onUpdate("")` echo (TipTap forwards any programmatic
      // doc change) needs no suppression: it can only ever write "" for a
      // draft that was just cleared, and ContentEditor forwards every doc
      // change through ONE shared debounce timer, so text typed before the
      // echo lands supersedes it rather than being overwritten by it.
      editorRef.current?.clearContent();
      setIsEmpty(true);
    },
  });

  const placeholder = t("tasks.detail.comment_placeholder");

  return (
    <div
      ref={containerRef}
      className={compact ? "relative" : "relative rounded-lg border border-border bg-card p-3"}
      data-testid="task-comment-composer"
    >
      <div className={compact ? "flex min-h-10 items-end gap-2" : undefined}>
        {compact ? (
          <FileUploadButton
            size="sm"
            multiple
            disabled={editorUpload.uploading || uploadGate.uploading}
            onSelect={(file) => editorRef.current?.uploadFile(file)}
          />
        ) : null}
        {lazy.active ? (
          <div className={lazy.ready ? (compact ? "min-w-0 flex-1" : undefined) : "hidden"}>
          <ContentEditor
            key={`comment-composer-${key}`}
            ref={editorRef}
            defaultValue={draft}
            placeholder={placeholder}
            className={compact ? "min-h-8 py-1 text-body" : "min-h-16 text-body"}
            debounceMs={0}
            showBubbleMenu={false}
            disableMentions
            onReady={lazy.onReady}
            onUploadingChange={uploadGate.onUploadingChange}
            attachments={attachments}
            currentTaskId={taskId}
            onUploadFile={(file) => editorUpload.upload(file, { taskId })}
            onUpdate={(md) => {
              // isEmpty drives the Send button and must never lag the caret.
              setIsEmpty(!md.trim());
              // The persisted write is debounced: a long comment must not
              // re-serialise every draft in storage on each keystroke.
              pendingDraftRef.current = md;
              if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
              draftTimerRef.current = setTimeout(() => {
                draftTimerRef.current = undefined;
                pendingDraftRef.current = null;
                setDraft(key, md);
              }, DRAFT_DEBOUNCE_MS);
            }}
            onSubmit={() => {
              void submit();
            }}
          />
          </div>
        ) : null}
        {!lazy.ready ? (
          <div
          role="button"
          tabIndex={0}
          data-testid="task-comment-composer-shell"
          className={compact ? "min-h-8 min-w-0 flex-1 cursor-text py-1 text-body text-muted-foreground" : "min-h-16 cursor-text text-body text-muted-foreground"}
          onClick={(e) => {
            const sel = window.getSelection();
            if (sel && !sel.isCollapsed) return;
            lazy.activate({ x: e.clientX, y: e.clientY });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              lazy.activate();
            }
          }}
          >
            {placeholder}
          </div>
        ) : null}
        {compact ? (
        <Button
          type="button"
          size="icon-sm"
          aria-label={t("tasks.detail.comment_send")}
          aria-disabled={isEmpty || submitting || uploadGate.uploading || undefined}
          onClick={() => {
            if (isEmpty || submitting || uploadGate.uploading) return;
            void submit();
          }}
        >
          <ArrowUp aria-hidden />
        </Button>
        ) : null}
      </div>
      {!compact ? (
        <div className="mt-2 flex items-center justify-between">
          <FileUploadButton
            size="sm"
            multiple
            disabled={editorUpload.uploading || uploadGate.uploading}
            onSelect={(file) => editorRef.current?.uploadFile(file)}
          />
          <Button
            type="button"
            size="sm"
            aria-disabled={isEmpty || submitting || uploadGate.uploading || undefined}
            onClick={() => {
              if (isEmpty || submitting || uploadGate.uploading) return;
              void submit();
            }}
          >
            {t("tasks.detail.comment_send")}
          </Button>
      </div>
      ) : null}
    </div>
  );
}
