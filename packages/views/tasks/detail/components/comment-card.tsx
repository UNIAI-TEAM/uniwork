"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@uniwork/core/auth";
import type { TaskComment } from "@uniwork/core/types";
import { ReactionBar } from "@uniwork/ui/components/common/reaction-bar";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { AgentBadge } from "../../../agents/agent-badge";
import { ReadonlyContent } from "../../../editor";

/**
 * One comment row. Reactions are add/remove only — listComments does not
 * embed reaction rows yet, so the bar starts empty and refreshes after mutate.
 */
export function TaskCommentCard({
  comment,
  highlighted,
  onToggleReaction,
  onEdit,
  onResolveToggle,
  onDelete,
}: {
  comment: TaskComment;
  highlighted?: boolean;
  onToggleReaction: (emoji: string) => void;
  onEdit?: (body: string) => void;
  onResolveToggle?: (resolved: boolean) => void;
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const authorLabel =
    comment.author?.display_name ??
    comment.display_name ??
    comment.author_id;
  const isOwn = currentUserId != null && comment.author_id === currentUserId;
  const resolved = !!comment.resolved_at;

  return (
    <article
      id={`comment-${comment.id}`}
      data-testid={`task-comment-${comment.id}`}
      className={cn(
        "rounded-lg border border-border bg-card p-3 transition-colors duration-700",
        highlighted &&
          "bg-[color-mix(in_srgb,var(--card)_92%,var(--brand)_8%)]",
        resolved && "opacity-80",
      )}
    >
      <header className="mb-1.5 flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
        <span className="font-medium text-foreground">{authorLabel}</span>
        {comment.author_kind === "agent" ? <AgentBadge /> : null}
        {resolved ? (
          <span className="text-micro">{t("tasks.detail.comment_resolved")}</span>
        ) : null}
      </header>
      {editing ? (
        <div className="space-y-2">
          <textarea
            aria-label={t("tasks.detail.comment_edit")}
            className="min-h-20 w-full rounded-md border border-border bg-background p-2 text-body text-foreground"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              aria-disabled={!draft.trim() || undefined}
              onClick={() => {
                if (!draft.trim() || !onEdit) return;
                onEdit(draft.trim());
                setEditing(false);
              }}
            >
              {t("common.save")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(comment.body);
                setEditing(false);
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <ReadonlyContent content={comment.body} className="text-body text-foreground" />
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <ReactionBar
          reactions={[]}
          currentUserId={currentUserId}
          onToggle={onToggleReaction}
          getActorName={() => authorLabel}
        />
        {isOwn && onEdit && !editing ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft(comment.body);
              setEditing(true);
            }}
          >
            {t("tasks.detail.comment_edit")}
          </Button>
        ) : null}
        {isOwn && onResolveToggle ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onResolveToggle(!resolved)}
          >
            {resolved
              ? t("tasks.detail.comment_unresolve")
              : t("tasks.detail.comment_resolve")}
          </Button>
        ) : null}
        {isOwn && onDelete ? (
          <Button type="button" variant="ghost" size="sm" onClick={onDelete}>
            {t("common.delete")}
          </Button>
        ) : null}
      </div>
    </article>
  );
}
