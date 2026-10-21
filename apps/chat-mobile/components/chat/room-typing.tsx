// Who is typing in one room, read by the two places that show it on their own
// (audit H1): the typing bubble under the newest message and the status line of
// the conversation's header. Each subscribes to its room's typists only, so a
// typing frame redraws the bubble and the header line, never the message list.
import { useMemo, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { PersonAvatar } from "@/components/people/person-avatar";
import { useSidebarTypingStore } from "@/data/stores/chat-typing-store";
import { senderLabelFor, type NameContextEntry } from "@/lib/people-display";
import { formatTypingLabel } from "@uniwork/core/chat/typing-label";
import { ChatHeader } from "./chat-header";
import { TypingBubble } from "./typing-bubble";

const NOBODY: string[] = [];

interface RoomTyping {
  /** "An đang nhập…", or null while nobody types. */
  label: string | null;
  /** Who is typing, first first. */
  names: string[];
  ids: string[];
}

function useRoomTyping(roomId: string, nameContext: readonly NameContextEntry[]): RoomTyping {
  const { t, i18n } = useTranslation();
  const ids = useSidebarTypingStore((s) => s.byRoomId[roomId] ?? NOBODY);
  return useMemo(() => {
    const names = ids.map((id) => senderLabelFor({ sender: id }, "", "", nameContext));
    return { label: names.length ? formatTypingLabel(names, t, i18n.language) : null, names, ids };
  }, [ids, nameContext, t, i18n.language]);
}

/** The typing bubble under the newest message; the typist's face beside it in a group. */
export function ConversationTyping({ roomId, nameContext, isGroup }: { roomId: string; nameContext: readonly NameContextEntry[]; isGroup: boolean }) {
  const typing = useRoomTyping(roomId, nameContext);
  if (!typing.label) return null;
  // A label means at least one typist.
  return <TypingBubble label={typing.label} avatar={isGroup ? <PersonAvatar name={typing.names[0]!} size={30} seed={typing.ids[0]} /> : undefined} />;
}

/** A room's header: its status line says who is typing, else that a DM's peer is online. */
export function RoomChatHeader({
  roomId,
  nameContext,
  online,
  ...header
}: Omit<ComponentProps<typeof ChatHeader>, "subtitle" | "typing"> & { roomId: string; nameContext: readonly NameContextEntry[]; online: boolean }) {
  const { t } = useTranslation();
  const typing = useRoomTyping(roomId, nameContext);
  return <ChatHeader {...header} subtitle={typing.label ?? (online ? t("chat.presence_online") : null)} typing={typing.label !== null} />;
}
