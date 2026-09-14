"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLinkChatMessage } from "@uniwork/core/chat";
import { useTasks } from "@uniwork/core/tasks";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { cn } from "@uniwork/ui/lib/utils";

export function LinkTaskDialog({
  open,
  onOpenChange,
  workspaceId,
  messageId,
  onLinked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  messageId: string;
  onLinked?: (taskId: string) => void;
}) {
  const { t } = useTranslation();
  const linkTask = useLinkChatMessage(workspaceId);
  const { data: tasks = [], isLoading } = useTasks(workspaceId);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tasks.slice(0, 40);
    return tasks
      .filter((task) => {
        const hay = `${task.title} ${task.identifier} ${task.id}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 40);
  }, [query, tasks]);

  const canSubmit = !!selectedId && !!messageId && !linkTask.isPending;

  const submit = () => {
    if (!canSubmit) return;
    void linkTask
      .mutateAsync({
        messageId,
        target_type: "task",
        target_id: selectedId,
      })
      .then((link) => {
        if (!link) return;
        setQuery("");
        setSelectedId("");
        onOpenChange(false);
        onLinked?.(selectedId);
      });
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setQuery("");
      setSelectedId("");
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md" showCloseButton>
        <DialogHeader className="space-y-1 border-b border-border bg-muted/20 px-5 py-4">
          <DialogTitle>{t("chat.link.link_task_title")}</DialogTitle>
          <DialogDescription>{t("chat.link.link_task_description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 px-5 py-4">
          <div className="space-y-2">
            <Label htmlFor="chat-link-task-search">{t("chat.link.search_label")}</Label>
            <Input
              id="chat-link-task-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("chat.link.search_placeholder")}
              className="rounded-xl"
              autoFocus
            />
          </div>

          <ul
            className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-border p-1"
            role="listbox"
            aria-label={t("chat.link.task_list_aria")}
          >
            {isLoading ? (
              <li className="px-3 py-2 text-caption text-muted-foreground">{t("chat.link.loading")}</li>
            ) : null}
            {!isLoading && filtered.length === 0 ? (
              <li className="px-3 py-2 text-caption text-muted-foreground">{t("chat.link.empty")}</li>
            ) : null}
            {filtered.map((task) => {
              const selected = selectedId === task.id;
              return (
                <li key={task.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={cn(
                      "flex w-full flex-col items-start rounded-lg px-3 py-2 text-left transition-colors",
                      selected ? "bg-brand/10 text-foreground" : "hover:bg-muted/60",
                    )}
                    onClick={() => setSelectedId(task.id)}
                  >
                    <span className="truncate text-body font-medium">{task.title}</span>
                    <span className="truncate text-caption text-muted-foreground">
                      {task.identifier || task.id}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <DialogFooter className="border-t border-border px-5 py-4">
          <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
            {t("chat.link.cancel")}
          </Button>
          <Button type="button" onClick={submit} disabled={!canSubmit}>
            {linkTask.isPending ? t("chat.link.linking") : t("chat.link.link")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
