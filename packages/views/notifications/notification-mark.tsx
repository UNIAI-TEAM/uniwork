"use client";

import { Bot } from "lucide-react";
import { useMembers } from "@uniwork/core/workspaces";
import type { Notification } from "@uniwork/core/types";
import { IconTile, tintSolidClass } from "@uniwork/ui/components/common/icon-tile";
import { Avatar, AvatarFallback, AvatarImage } from "@uniwork/ui/components/ui/avatar";
import { cn } from "@uniwork/ui/lib/utils";
import { initials } from "../people/actor-chip";
import { useWorkspace } from "../layout/workspace-context";
import { kindIcon } from "./kind-icon";
import { kindTone } from "./kind-tone";

/**
 * Who caused the row, with what kind of thing it is pinned to the corner.
 * A person shows their face (or initials), an agent a bot on the brand wash
 * so it never passes for a colleague, and the system — a reminder, an export
 * — shows only the kind's mark, because there is nobody to show. The corner
 * badge carries the kind's glyph on its module's tint: green for tasks,
 * violet for meetings, the same colours the sidebar uses.
 *
 * Decorative: the sentence beside it already names the actor and the event.
 */
export function NotificationMark({ notification: n, dimmed }: { notification: Notification; dimmed?: boolean }) {
  const { workspace } = useWorkspace();
  const members = useMembers(workspace.id);
  const tone = kindTone(n.kind);
  const Icon = kindIcon(n.kind);
  const name = n.params.actor ?? "";

  if (n.actor_kind === "system" || !name) {
    return (
      <IconTile
        aria-hidden
        icon={Icon}
        shape="circle"
        size="sm"
        tone={tone}
        className={cn("size-9 [&_svg]:size-4", dimmed && "opacity-70")}
      />
    );
  }

  const member = n.actor_kind === "human" ? members.data?.find((m) => m.user_id === n.actor_id) : undefined;
  const avatarUrl = typeof member?.avatar_url === "string" && member.avatar_url ? member.avatar_url : undefined;

  return (
    <span aria-hidden className={cn("relative inline-flex size-9 shrink-0", dimmed && "opacity-70")}>
      {n.actor_kind === "agent" ? (
        <span className="flex size-9 items-center justify-center rounded-full bg-brand-subtle text-brand-subtle-foreground">
          <Bot className="size-4.5" />
        </span>
      ) : (
        <Avatar className="size-9">
          {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
          <AvatarFallback className="text-caption font-semibold">{initials(name)}</AvatarFallback>
        </Avatar>
      )}
      <span
        className={cn(
          // The ring cuts the badge out of the avatar in the colour behind
          // it: the row sets --row-fill for its hover and focus fills, and a
          // host list on another surface (a card, a popover) sets its own.
          "absolute -right-1 -bottom-1 flex size-[18px] items-center justify-center rounded-full ring-2 ring-[var(--row-fill,var(--background))] [&_svg]:size-2.5",
          tintSolidClass[tone],
        )}
      >
        <Icon strokeWidth={2.5} />
      </span>
    </span>
  );
}
