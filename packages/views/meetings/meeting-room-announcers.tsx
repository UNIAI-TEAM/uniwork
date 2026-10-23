"use client";
import { useEffect, useMemo, useState } from "react";
import {
  useLocalParticipant,
  useParticipants as useLiveKitParticipants,
  useRoomContext,
} from "@livekit/components-react";
import {
  ConnectionState,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type TrackPublication,
} from "livekit-client";
import { useTranslation } from "react-i18next";
import { useMeetingChat } from "@uniwork/core/meetings";
import { chatWatermark, unreadChatSince, type ChatWatermark } from "./meeting-chat";
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
  // Names are all it reads: speaking and quality changes must not re-render it.
  const participants = useLiveKitParticipants({ updateOnlyOn: [RoomEvent.ParticipantNameChanged] });
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
 * "X started presenting" / "X stopped presenting" for other people's screen
 * shares: the stage swaps silently, so a screen reader would not otherwise
 * know. Like the presence announcer, the shares already on when we connect
 * and the re-sync after a reconnect are not news. Nor is a share that starts
 * while ours is on: MeetingSinglePresenter settles it and its toast says who
 * took over. Once ours is off, the share left on stage is news again when it
 * stops; one that gave way to ours in a race stops unsaid.
 */
export function ScreenShareAnnouncer() {
  const { t } = useTranslation();
  const room = useRoomContext();
  const [text, setText] = useState("");

  useEffect(() => {
    let readyAt = room.state === ConnectionState.Connected ? Date.now() + PRESENCE_SETTLE_MS : Infinity;
    let pending: string[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Shares whose start went unsaid: their stop goes unsaid too.
    const unsaid = new Set<string>();
    // MeetingSinglePresenter listens first and may stop ours from inside the
    // same TrackPublished dispatch, so the share that took over finds ours
    // already gone. Held until the dispatch ends.
    let ownJustStopped = false;

    const flush = () => {
      if (pending.length > 0) setText(pending.join(". "));
      pending = [];
    };
    const queue = (key: string, pub: TrackPublication, p: RemoteParticipant) => {
      if (Date.now() < readyAt) return;
      pending.push(t(key, { name: p.name || p.identity }));
      clearTimeout(timer);
      timer = setTimeout(flush, PRESENCE_BATCH_MS);
    };
    const onSettle = () => {
      readyAt = Date.now() + PRESENCE_SETTLE_MS;
    };
    // A full reconnect unpublishes every remote share just before Reconnecting
    // fires, then publishes them again: none of it is news. So does a
    // server-side leave just before Disconnected, ahead of room-view's rejoin.
    const onReconnecting = () => {
      readyAt = Infinity;
      clearTimeout(timer);
      pending = [];
    };
    const onPublished = (pub: TrackPublication, p: RemoteParticipant) => {
      if (pub.source !== Track.Source.ScreenShare) return;
      if (room.localParticipant.getTrackPublication(Track.Source.ScreenShare)) {
        unsaid.add(pub.trackSid);
        return;
      }
      if (ownJustStopped) return;
      queue("meetings.announcePresentingStarted", pub, p);
    };
    // Ours stopped: a share still on has taken the stage (the takeover toast
    // said who), so its stop is news again.
    const onLocalUnpublished = (pub: TrackPublication) => {
      if (pub.source !== Track.Source.ScreenShare) return;
      unsaid.clear();
      ownJustStopped = true;
      queueMicrotask(() => {
        ownJustStopped = false;
      });
    };
    const onUnpublished = (pub: TrackPublication, p: RemoteParticipant) => {
      if (pub.source !== Track.Source.ScreenShare || unsaid.delete(pub.trackSid)) return;
      queue("meetings.announcePresentingStopped", pub, p);
    };

    room
      .on(RoomEvent.Connected, onSettle)
      .on(RoomEvent.Reconnecting, onReconnecting)
      .on(RoomEvent.Disconnected, onReconnecting)
      .on(RoomEvent.Reconnected, onSettle)
      .on(RoomEvent.TrackPublished, onPublished)
      .on(RoomEvent.TrackUnpublished, onUnpublished)
      .on(RoomEvent.LocalTrackUnpublished, onLocalUnpublished);
    return () => {
      clearTimeout(timer);
      room
        .off(RoomEvent.Connected, onSettle)
        .off(RoomEvent.Reconnecting, onReconnecting)
        .off(RoomEvent.Disconnected, onReconnecting)
        .off(RoomEvent.Reconnected, onSettle)
        .off(RoomEvent.TrackPublished, onPublished)
        .off(RoomEvent.TrackUnpublished, onUnpublished)
        .off(RoomEvent.LocalTrackUnpublished, onLocalUnpublished);
    };
  }, [room, t]);

  return (
    <p role="status" aria-live="polite" className="sr-only" data-testid="meeting-presenting-announcer">
      {text}
    </p>
  );
}

/**
 * Messages from others that arrived while the chat was not on screen. The
 * history already there when the room opened counts as read. The count is
 * taken against a watermark, so it reads only the rows past it.
 */
export function useMeetingChatUnread(meetingId: string | undefined, visible: boolean) {
  const { localParticipant } = useLocalParticipant();
  const localIdentity = localParticipant.identity;
  const { data } = useMeetingChat(meetingId ?? "");
  const newest = data ? chatWatermark(data) : null;
  const newestAt = newest?.at;
  const newestId = newest?.id;
  const [mark, setMark] = useState<ChatWatermark | null>(null);

  useEffect(() => {
    if (newestAt === undefined || newestId === undefined) return;
    setMark((prev) => {
      if (prev !== null && !visible) return prev;
      return prev?.at === newestAt && prev.id === newestId ? prev : { at: newestAt, id: newestId };
    });
  }, [newestAt, newestId, visible]);

  const unseen = useMemo(
    () => (data && mark ? unreadChatSince(data, mark, localIdentity) : []),
    [data, mark, localIdentity],
  );
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
