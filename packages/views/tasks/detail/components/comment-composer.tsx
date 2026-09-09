"use client";

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  ContentEditor,
  type ContentEditorRef,
  useComposerSubmit,
  useLazyEditor,
  useUploadGate,
} from "../../../editor";

/**
 * Lazy ContentEditor comment composer. Submit awaits the server; draft stays
 * on failure (useComposerSubmit contract).
 */
export function TaskCommentComposer({
  taskId,
  onSubmit,
}: {
  taskId: string;
  onSubmit: (body: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const editorRef = useRef<ContentEditorRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const uploadGate = useUploadGate(editorRef);
  const lazy = useLazyEditor({
    editorRef,
    resetKey: taskId,
  });

  const { submitting, submit } = useComposerSubmit({
    editorRef,
    uploadGate,
    afterAccepted: "blur",
    onSubmit,
    onAccepted: () => {
      editorRef.current?.clearContent();
      setIsEmpty(true);
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
            key={`comment-composer-${taskId}`}
            ref={editorRef}
            defaultValue=""
            placeholder={placeholder}
            className="min-h-16 text-body"
            debounceMs={0}
            showBubbleMenu={false}
            disableMentions
            onReady={lazy.onReady}
            onUploadingChange={uploadGate.onUploadingChange}
            onUpdate={(md) => setIsEmpty(!md.trim())}
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
