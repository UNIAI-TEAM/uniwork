"use client";
import { useEffect, useMemo, useState } from "react";
import {
  useLocalParticipant,
  useParticipants as useLiveKitParticipants,
  useRoomContext,
} from "@livekit/components-react";
import { ConnectionState, RoomEvent, type RemoteParticipant } from "livekit-client";
import { useTranslation } from "react-i18next";
import { useMeetingChat } from "@uniwork/core/meetings";
import { toChatItems } from "./meeting-chat";
import { reactionLabelKey } from "./meeting-signals";
import { useMeetingSignals } from "./use-meeting-signals";

/** People already in the room when we connect are not news; only later arrivals are. */
const PRESENCE_SETTLE_MS = 2000;
/** Arrivals and departures this close together are read out as one sentence. */
const PRESENCE_BATCH_MS = 1200;

/** Reactions pop on a tile for sighted viewers; this says them once, politely, for everyone else. */
export function ReactionAnnouncer() {
  const { t } = useTranslation();
  const { reactions, localIdentity } = useMeetingSignals();
  const participants = useLiveKitParticipants();
  const latest = reactions.at(-1);
  let text = "";
  if (latest) {
    const person = participants.find((p) => p.identity === latest.identity);
    const name =
      latest.identity === localIdentity ? t("meetings.you") : person?.name || person?.identity || latest.identity;
    const key = reactionLabelKey(latest.value);
    text = t("meetings.reactionAnnounce", { name, reaction: key ? t(key) : latest.value });
  }
  return (
    <p role="status" aria-live="polite" className="sr-only">
      {text}
    </p>
  );
}

/**
 * "X joined" / "X left", said politely. The initial roster and the re-sync
 * after a reconnect are skipped, and a burst (a class arriving at once)
 * becomes one count instead of a queue of names.
 */
export function ParticipantPresenceAnnouncer() {
  const { t } = useTranslation();
  const room = useRoomContext();
  const [text, setText] = useState("");

  useEffect(() => {
    let readyAt = room.state === ConnectionState.Connected ? Date.now() + PRESENCE_SETTLE_MS : Infinity;
    let joined: string[] = [];
    let left: string[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;

    const sentence = (names: string[], one: string, many: string) =>
      names.length === 1 ? t(one, { name: names[0] }) : t(many, { count: names.length });

    const flush = () => {
      const parts: string[] = [];
      if (joined.length > 0) {
        parts.push(sentence(joined, "meetings.participantJoinedAnnounce", "meetings.participantsJoinedAnnounce"));
      }
      if (left.length > 0) {
        parts.push(sentence(left, "meetings.participantLeftAnnounce", "meetings.participantsLeftAnnounce"));
      }
      joined = [];
      left = [];
      if (parts.length > 0) setText(parts.join(". "));
    };
    const queue = (list: string[], p: RemoteParticipant) => {
      if (Date.now() < readyAt) return;
      list.push(p.name || p.identity);
      clearTimeout(timer);
      timer = setTimeout(flush, PRESENCE_BATCH_MS);
    };
    const onSettle = () => {
      readyAt = Date.now() + PRESENCE_SETTLE_MS;
    };
    // A full reconnect unwinds every remote participant (ParticipantDisconnected
    // for each) just before Reconnecting fires, then re-adds them. Drop the
    // queued batch and stay quiet until the room settles again.
    const onReconnecting = () => {
      readyAt = Infinity;
      clearTimeout(timer);
      joined = [];
      left = [];
    };
    const onJoin = (p: RemoteParticipant) => queue(joined, p);
    const onLeave = (p: RemoteParticipant) => queue(left, p);

    room
      .on(RoomEvent.Connected, onSettle)
      .on(RoomEvent.Reconnecting, onReconnecting)
      .on(RoomEvent.Reconnected, onSettle)
      .on(RoomEvent.ParticipantConnected, onJoin)
      .on(RoomEvent.ParticipantDisconnected, onLeave);
    return () => {
      clearTimeout(timer);
      room
        .off(RoomEvent.Connected, onSettle)
        .off(RoomEvent.Reconnecting, onReconnecting)
        .off(RoomEvent.Reconnected, onSettle)
        .off(RoomEvent.ParticipantConnected, onJoin)
        .off(RoomEvent.ParticipantDisconnected, onLeave);
    };
  }, [room, t]);

  return (
    <p role="status" aria-live="polite" className="sr-only" data-testid="meeting-presence-announcer">
      {text}
    </p>
  );
}

/**
 * Messages from others that arrived while the chat was not on screen. The
 * history already there when the room opened counts as read.
 */
export function useMeetingChatUnread(meetingId: string | undefined, visible: boolean) {
  const { localParticipant } = useLocalParticipant();
  const localIdentity = localParticipant.identity;
  const { data } = useMeetingChat(meetingId ?? "");
  const incoming = useMemo(
    () => (data ? toChatItems(data, localIdentity).filter((m) => !m.isLocal) : null),
    [data, localIdentity],
  );
  const [seen, setSeen] = useState<ReadonlySet<string> | null>(null);

  useEffect(() => {
    if (!incoming) return;
    setSeen((prev) => (prev === null || visible ? new Set(incoming.map((m) => m.id)) : prev));
  }, [incoming, visible]);

  const unseen = seen && incoming ? incoming.filter((m) => !seen.has(m.id)) : [];
  return { unread: unseen.length, latest: unseen.at(-1) };
}

/** Says a new chat message out loud while the chat tab is not the one on screen. */
export function ChatMessageAnnouncer({
  latest,
  visible,
}: {
  latest?: { id: string; fromName: string; message: string };
  visible: boolean;
}) {
  const { t } = useTranslation();
  return (
    <p role="status" aria-live="polite" className="sr-only" data-testid="meeting-chat-announcer">
      {!visible && latest
        ? t("meetings.chatNewMessageAnnounce", { name: latest.fromName, message: latest.message })
        : ""}
    </p>
  );
}
