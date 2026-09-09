"use client";

import { useRef } from "react";
import { useTranslation } from "react-i18next";
import type { Task } from "@uniwork/core/types";
import {
  ContentEditor,
  type ContentEditorRef,
  TitleEditor,
  type TitleEditorRef,
  useLazyEditor,
} from "../../../editor";
import { TaskDetailAttachmentsSlot } from "./task-detail-attachments-slot";
import { TaskDetailTimelineSlot } from "./task-detail-timeline-slot";

export function TaskDetailEditors({
  task,
  onSaveTitle,
  onSaveDescription,
  scrollContainerRef,
}: {
  task: Task;
  onSaveTitle: (title: string) => void;
  onSaveDescription: (markdown: string) => void;
  scrollContainerRef?: (el: HTMLElement | null) => void;
}) {
  const { t } = useTranslation();
  const titleEditorRef = useRef<TitleEditorRef>(null);
  const descEditorRef = useRef<ContentEditorRef>(null);
  const titleLazy = useLazyEditor({
    editorRef: titleEditorRef,
    resetKey: task.id,
  });

  return (
    <div
      ref={scrollContainerRef}
      className="relative h-full flex-1 overflow-y-auto [scrollbar-gutter:stable]"
    >
      <div className="mx-auto w-full max-w-4xl px-3 py-6 md:px-8 md:py-8">
        <section
          aria-label={t("tasks.detail.title_region")}
          className="min-w-0"
        >
          {titleLazy.active ? (
            <div className={titleLazy.ready ? undefined : "hidden"}>
              <TitleEditor
                key={`title-${task.id}`}
                ref={titleEditorRef}
                defaultValue={task.title}
                placeholder={t("tasks.detail.title_placeholder")}
                className="w-full text-display-sm font-bold leading-snug tracking-tight"
                onReady={titleLazy.onReady}
                onBlur={(value) => {
                  const trimmed = value.trim();
                  if (trimmed && trimmed !== task.title) {
                    onSaveTitle(trimmed);
                  }
                }}
              />
            </div>
          ) : null}
          {!titleLazy.ready ? (
            <div
              role="button"
              tabIndex={0}
              className="w-full cursor-text text-display-sm font-bold leading-snug tracking-tight text-foreground"
              onClick={(e) => {
                const sel = window.getSelection();
                if (sel && !sel.isCollapsed) return;
                titleLazy.activate({ x: e.clientX, y: e.clientY });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  titleLazy.activate();
                }
              }}
            >
              {task.title || t("tasks.detail.title_placeholder")}
            </div>
          ) : null}
        </section>

        <div className="relative mt-5 rounded-lg">
          <ContentEditor
            ref={descEditorRef}
            key={task.id}
            value={task.description ?? ""}
            placeholder={t("tasks.detail.description_placeholder")}
            onUpdate={(md) => {
              if (md !== (task.description ?? "")) {
                onSaveDescription(md);
              }
            }}
            debounceMs={1500}
            flushPendingOnUnmount
            currentTaskId={task.id}
            disableMentions
          />
        </div>

        <TaskDetailAttachmentsSlot />
        <TaskDetailTimelineSlot />
      </div>
    </div>
  );
}
