"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { useCommentDraftStore } from "@uniwork/core/tasks/stores/comment-draft-store";
import {
  ContentEditor,
  type ContentEditorRef,
  useComposerSubmit,
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
  onSubmit,
}: {
  taskId: string;
  /** Distinguishes composers on the same task: the main box and each reply box. */
  composerKey?: string;
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
  const lazy = useLazyEditor({
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
  // Set right before `clearContent()` in `onAccepted`; suppresses the one
  // resulting `onUpdate("")` echo (TipTap fires `onUpdate` for any
  // programmatic doc change, including `clearContent`). Still needed even
  // though `onAccepted` no longer reads `pendingDraftRef` to decide what to
  // keep: left alone, that echo would still reach the debounced-write path
  // below, re-arm it, and overwrite whatever `onAccepted` just decided to
  // keep with "" about 1.5s later. This guards the decision's aftermath, not
  // the decision itself.
  const suppressNextClearEchoRef = useRef(false);

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
      suppressNextClearEchoRef.current = true;
      editorRef.current?.clearContent();
      setIsEmpty(true);
      if (liveMarkdown !== lastSubmittedRef.current) {
        // Typed after what was submitted — keep it as the draft.
        setDraft(key, liveMarkdown);
      } else {
        // Everything on screen was sent — nothing left to keep.
        clearDraft(key);
      }
    },
  });

  const placeholder = t("tasks.detail.comment_placeholder");

  return (
    <div
      ref={containerRef}
      className="relative rounded-lg border border-border bg-card p-3"
      data-testid="task-comment-composer"
    >
      {lazy.active ? (
        <div className={lazy.ready ? undefined : "hidden"}>
          <ContentEditor
            key={`comment-composer-${key}`}
            ref={editorRef}
            defaultValue={draft}
            placeholder={placeholder}
            className="min-h-16 text-body"
            debounceMs={0}
            showBubbleMenu={false}
            disableMentions
            onReady={lazy.onReady}
            onUploadingChange={uploadGate.onUploadingChange}
            onUpdate={(md) => {
              if (suppressNextClearEchoRef.current) {
                suppressNextClearEchoRef.current = false;
                // Echo of onAccepted's own clearContent(): nothing to
                // persist, the keep/clear decision was already made.
                if (md === "") {
                  setIsEmpty(true);
                  return;
                }
                // The doc changed again before the echo fired (the person
                // kept typing) — it's real content, fall through as usual.
              }
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
          className="min-h-16 cursor-text text-body text-muted-foreground"
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
      <div className="mt-2 flex justify-end">
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
    </div>
  );
}
