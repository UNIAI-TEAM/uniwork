"use client";

import { useId } from "react";
import { House, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChatSearchScope } from "@uniwork/core/api/endpoints/chat";
import { useSearchChatMessages } from "@uniwork/core/chat";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { tintSolidClass } from "@uniwork/ui/components/common/icon-tile";
import { cn } from "@uniwork/ui/lib/utils";
import { useNavigation } from "../navigation";
import { identityTint } from "../people/identity-tint";
import { initialsOf, roomInitialsOf } from "./chat-initials";
import { chatPersonFaceClass } from "./chat-person-card";
import { formatResultTime, highlightSnippet } from "./chat-search-highlight";
import type { ChatSidebarTarget } from "./chat-sidebar-types";

type ResolvedRoom = { target: ChatSidebarTarget; title: string };

/** Characters kept before the match on a result's one line, so the mark is never cut off. */
const SNIPPET_LEAD = 20;

const ROOM_FACE = "flex size-10 shrink-0 items-center justify-center rounded-[12px] font-display text-body font-bold [&_svg]:size-4.5";

/** The room a result sits in, as the list draws it: a person's circle, a room's square. */
function ResultFace({ room }: { room: ResolvedRoom }) {
  const { target, title } = room;
  switch (target.kind) {
    case "dm":
      return (
        <ActorAvatar
          name={title}
          initials={initialsOf(title)}
          size="fluid"
          className={cn("size-10 text-body font-bold", chatPersonFaceClass(target.contact.user_id))}
        />
      );
    case "workspace":
      return (
        <span aria-hidden className={cn(ROOM_FACE, tintSolidClass.blue)}>
          <House />
        </span>
      );
    case "channel":
      return (
        <span aria-hidden className={cn(ROOM_FACE, tintSolidClass[identityTint(target.channel.id)])}>
          {target.channel.visibility === "private" ? <Lock /> : "#"}
        </span>
      );
    case "group":
      return (
        <span aria-hidden className={cn(ROOM_FACE, tintSolidClass[identityTint(target.group.id)])}>
          {roomInitialsOf(target.group.name)}
        </span>
      );
  }
}

/**
 * "Tin nhắn" under a search's conversations, as Telegram's global search:
 * every text message of the reader's rooms in this scope that matches, newest
 * first, the match marked. A result opens its room at that message
 * (`?room=&message=`, the same jump a notification makes). Rooms the list
 * cannot open are left out.
 */
export function ChatSidebarMessageResults({
  workspaceId,
  scope,
  query,
  currentUserId,
  youLabel,
  resolve,
}: {
  workspaceId: string;
  scope: ChatSearchScope;
  query: string;
  currentUserId: string;
  youLabel: string;
  resolve: (roomId: string) => ResolvedRoom | null;
}) {
  const { t, i18n } = useTranslation();
  const nav = useNavigation();
  const headingId = useId();
  const { data = [], isPending, isError } = useSearchChatMessages(workspaceId, scope, query);
  const hits = data.flatMap((message) => {
    const room = resolve(message.room_id);
    return room ? [{ message, room }] : [];
  });
  const open = (roomId: string, messageId: string) => {
    const params = new URLSearchParams(nav.searchParams);
    params.set("room", roomId);
    params.set("message", messageId);
    nav.push(`${nav.pathname}?${params.toString()}`);
  };
  const note = "px-2.5 py-2 text-caption text-muted-foreground";
  return (
    <section aria-labelledby={headingId} className="pt-2">
      <h3
        id={headingId}
        className="flex items-center justify-between px-2.5 pt-1 pb-1.5 text-caption font-semibold text-muted-foreground"
      >
        <span>{t("chat.sidebar_search_messages_title")}</span>
        {hits.length > 0 ? <span className="tabular-nums">{hits.length}</span> : null}
      </h3>
      {isPending ? (
        <p role="status" className={note}>
          {t("chat.sidebar_search_messages_loading")}
        </p>
      ) : isError ? (
        <p className={note}>{t("chat.sidebar_search_messages_failed")}</p>
      ) : hits.length === 0 ? (
        <p className={note}>{t("chat.sidebar_search_messages_empty")}</p>
      ) : (
        <ul className="flex flex-col gap-px">
          {hits.map(({ message, room }) => {
            const own = message.sender_id.trim().toUpperCase() === currentUserId.trim().toUpperCase();
            // A DM's line needs no name for the other person; a room's names who wrote it.
            const sender = own ? youLabel : room.target.kind === "dm" ? "" : message.sender_display_name?.trim();
            return (
              <li key={message.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors duration-(--duration-fast) hover:bg-surface-hover"
                  onClick={() => open(message.room_id, message.id)}
                >
                  <ResultFace room={room} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-body font-semibold text-foreground">{room.title}</span>
                      <span className="shrink-0 text-caption text-muted-foreground tabular-nums">
                        {formatResultTime(message.created_at, i18n.language)}
                      </span>
                    </span>
                    <span className="truncate text-label text-muted-foreground">
                      {sender ? <span className="font-medium text-foreground">{`${sender}: `}</span> : null}
                      {highlightSnippet(message.body, query, SNIPPET_LEAD)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
