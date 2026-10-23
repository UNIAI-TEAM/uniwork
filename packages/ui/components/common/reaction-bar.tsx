"use client";

import { Tooltip, TooltipTrigger, TooltipContent } from "@uniwork/ui/components/ui/tooltip";
import { QuickEmojiPicker } from "./quick-emoji-picker";

interface ReactionItem {
  id: string;
  actor_type: string;
  actor_id: string;
  emoji: string;
}

interface GroupedReaction {
  emoji: string;
  count: number;
  reacted: boolean;
  actors: { type: string; id: string }[];
}

function groupReactions(reactions: ReactionItem[], currentUserId?: string): GroupedReaction[] {
  const map = new Map<string, GroupedReaction>();
  for (const r of reactions) {
    let group = map.get(r.emoji);
    if (!group) {
      group = { emoji: r.emoji, count: 0, reacted: false, actors: [] };
      map.set(r.emoji, group);
    }
    group.count++;
    group.actors.push({ type: r.actor_type, id: r.actor_id });
    if (r.actor_type === "member" && r.actor_id === currentUserId) {
      group.reacted = true;
    }
  }
  return Array.from(map.values());
}

interface ReactionBarProps {
  reactions: ReactionItem[];
  currentUserId?: string;
  onToggle: (emoji: string) => void;
  getActorName: (type: string, id: string) => string;
  className?: string;
  /**
   * Read-only surfaces (a viewer reading a document's comments) still see the
   * reactions, but as plain chips: no button semantics, no picker, nothing
   * that looks clickable when the server would refuse the write.
   */
  readOnly?: boolean;
}

function ReactionBar({
  reactions,
  currentUserId,
  onToggle,
  getActorName,
  className,
  readOnly = false,
}: ReactionBarProps) {
  const grouped = groupReactions(reactions, currentUserId);
  const chipClass = (reacted: boolean) =>
    `inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-caption ${
      reacted
        ? "border-brand/30 bg-brand/8 text-brand"
        : "border-brand/10 bg-brand/4 text-muted-foreground"
    }`;

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className ?? ""}`}>
      {grouped.map((g) => {
        const actorNames = g.actors.map((a) => getActorName(a.type, a.id)).join(", ");
        if (readOnly) {
          return (
            <span
              key={g.emoji}
              aria-label={`${g.emoji} ${g.count}: ${actorNames}`}
              title={actorNames}
              className={chipClass(g.reacted)}
            >
              <span>{g.emoji}</span>
              <span>{g.count}</span>
            </span>
          );
        }
        return (
          <Tooltip key={g.emoji}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={`${g.emoji} ${g.count}: ${actorNames}`}
                  onClick={() => onToggle(g.emoji)}
                  className={`${chipClass(g.reacted)} transition-colors hover:bg-brand/15`}
                >
                  <span>{g.emoji}</span>
                  <span>{g.count}</span>
                </button>
              }
            />
            <TooltipContent side="top">{actorNames}</TooltipContent>
          </Tooltip>
        );
      })}
      {readOnly ? null : <QuickEmojiPicker onSelect={onToggle} />}
    </div>
  );
}

export { ReactionBar, type ReactionBarProps, type ReactionItem };
