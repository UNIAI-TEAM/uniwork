"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { CheckCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChatRoomMemberRecord, ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import { furthestReadAt, isMessageSeenByPeer } from "@uniwork/core/chat/read-receipt-utils";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import type { ChatMessage } from "./chat-messages";
import { resolveAvatarUrlFromNameContext } from "./chat-member-avatar";
import { chatPersonFaceClass } from "./chat-person-card";
import { initialOf } from "./chat-initials";
import type { NameContextEntry } from "./native-chat-message-mapping";

type SeenBy = { members: readonly ChatRoomMemberRecord[]; nameContext: NameContextEntry[] };

/*
 * The open room's read pointers, for a group or a non-default channel only
 * (null elsewhere). A context, not a row prop: a member reading moves the
 * pointers often, and only an open ⋯ menu reads them, so the memoised rows
 * stay put.
 */
const SeenByContext = createContext<SeenBy | null>(null);

/**
 * Seen-by for the open room: the context value, and the furthest read pointer
 * among the others for the timeline's one "Đã xem" mark. Off (null, null) in
 * a DM, which reads its peer's pointer from the room, and in the workspace's
 * default room, where everyone is a member.
 */
export function useChatSeenBy(
  room: Pick<ChatRoomRecord, "kind" | "is_default"> | undefined,
  members: readonly ChatRoomMemberRecord[],
  nameContext: NameContextEntry[],
  currentUserId: string,
): { value: SeenBy | null; lastReadAt: string | null } {
  const enabled = room?.kind === "group" || (room?.kind === "channel" && !room.is_default);
  const value = useMemo(() => (enabled ? { members, nameContext } : null), [enabled, members, nameContext]);
  const lastReadAt = useMemo(
    () => (enabled ? furthestReadAt(members, currentUserId) : null),
    [currentUserId, enabled, members],
  );
  return { value, lastReadAt };
}

export function ChatSeenByProvider({ value, children }: { value: SeenBy | null; children: ReactNode }) {
  return <SeenByContext.Provider value={value}>{children}</SeenByContext.Provider>;
}

/**
 * "N người đã xem" at the top of an own message's ⋯ menu, opening the readers.
 * Nothing for a thread reply: the pointers follow the main timeline only.
 */
export function ChatSeenByMenuItem({ message }: { message: ChatMessage }) {
  const { t } = useTranslation();
  const seenBy = useContext(SeenByContext);
  if (!seenBy || message.threadRootId) return null;
  const readers = seenBy.members.filter(
    (member) => member.user_id !== message.sender && isMessageSeenByPeer(message.ts, member.last_read_at),
  );
  if (readers.length === 0) return null;
  const names = new Map(seenBy.nameContext.map((entry) => [entry.user_id, entry.display_name.trim()]));
  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <CheckCheck className="size-4 text-brand" aria-hidden />
          {t("chat.seen_by_count", { count: readers.length })}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="max-h-72 min-w-48 overflow-y-auto">
          {readers.map((member) => {
            const name = names.get(member.user_id) || member.display_name.trim() || member.email;
            return (
              <DropdownMenuItem key={member.user_id}>
                <ActorAvatar
                  name={name}
                  initials={initialOf(name)}
                  avatarUrl={resolveAvatarUrlFromNameContext(seenBy.nameContext, member.user_id)}
                  size="md"
                  className={chatPersonFaceClass(member.user_id)}
                />
                <span className="min-w-0 truncate">{name}</span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
    </>
  );
}
