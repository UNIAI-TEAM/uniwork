"use client";

import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { cn } from "@uniwork/ui/lib/utils";
import { initialsOf } from "./chat-initials";
import { resolveAvatarUrlFromNameContext } from "./chat-member-avatar";
import { chatPersonFaceClass } from "./chat-person-card";
import type { ChatNameContextEntry } from "./chat-page-utils";

/**
 * The faces of a thread's latest repliers at the head of its pill, newest
 * first and overlapping, on the pill's own white (WebMessageKinds: 24px with
 * the ring, 17px apart). Words after them say the count, so the faces are
 * decoration for a screen reader.
 */
export function ChatThreadRepliers({
  userIds,
  nameContext,
}: {
  userIds: readonly string[] | undefined;
  nameContext: ChatNameContextEntry[];
}) {
  if (!userIds?.length) return null;
  return (
    <span aria-hidden className="flex -space-x-0.75">
      {userIds.slice(0, 3).map((userId) => {
        const key = userId.toUpperCase();
        const name = nameContext.find((entry) => entry.user_id.toUpperCase() === key)?.display_name?.trim() || userId;
        return (
          <ActorAvatar
            key={userId}
            name={name}
            initials={initialsOf(name)}
            avatarUrl={resolveAvatarUrlFromNameContext(nameContext, userId)}
            size="sm"
            className={cn("ring-2 ring-chat-bubble-other", chatPersonFaceClass(userId))}
          />
        );
      })}
    </span>
  );
}
