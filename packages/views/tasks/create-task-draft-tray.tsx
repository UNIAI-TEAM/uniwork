"use client";

import { useMemo } from "react";
import { FilePenLine, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useCreateTaskDraftStore,
  type CreateTaskDraft,
} from "@uniwork/core/tasks/stores/create-task-draft-store";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";

const EMPTY_DRAFTS: Record<string, CreateTaskDraft> = {};

export function CreateTaskDraftTray({
  workspaceId,
  onOpenDraft,
}: {
  workspaceId: string;
  onOpenDraft: () => void;
}) {
  const { t } = useTranslation();
  const workspaceDrafts = useCreateTaskDraftStore(
    (state) => state.drafts[workspaceId] ?? EMPTY_DRAFTS,
  );
  const activeDraftId = useCreateTaskDraftStore(
    (state) => state.activeDraftIds[workspaceId],
  );
  const activateDraft = useCreateTaskDraftStore((state) => state.activateDraft);
  const clearDraft = useCreateTaskDraftStore((state) => state.clearDraft);
  const drafts = useMemo(
    () => Object.values(workspaceDrafts).filter((draft) => draft.savedAt),
    [workspaceDrafts],
  );

  if (drafts.length === 0) return null;

  return (
    <section
      aria-label={t("tasks.create.drafts")}
      className="flex h-10 w-full min-w-0 shrink-0 items-center border-t border-border bg-background px-2"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {drafts.map((draft) => {
          const title = draft.title.trim() || t("tasks.create.draft_untitled");
          const isActive = draft.idempotencyKey === activeDraftId;
          return (
            <div
              key={draft.idempotencyKey}
              className={cn(
                "group flex h-7 max-w-56 shrink-0 items-center rounded-md border border-border bg-muted/40 text-foreground",
                isActive && "border-primary/40 bg-primary/5",
              )}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-1 pl-2 text-left text-caption font-medium hover:text-primary"
                aria-label={t("tasks.create.draft_open", { title })}
                onClick={() => {
                  activateDraft(workspaceId, draft.idempotencyKey);
                  onOpenDraft();
                }}
              >
                <FilePenLine className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{title}</span>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-6 w-6 shrink-0 rounded-sm opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                aria-label={t("tasks.create.draft_delete", { title })}
                onClick={() => clearDraft(workspaceId, draft.idempotencyKey)}
              >
                <X className="size-3" aria-hidden />
              </Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
