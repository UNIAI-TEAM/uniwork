// The Chat tab's list of conversations. Rows come built
// without typing or presence (lib/room-list.ts); the typing lines are laid over
// them here (with the drafts left in rooms) and each DM row reads its peer's presence itself, so a typing frame
// redraws the row that types and a presence change the row of that person.
// Every cell gets the same handlers object and is skipped while its row draws
// the same, so a new message redraws the rows it moved or changed only. The
// list recycles its cells (FlashList): a cell keeps no state of
// its own (presence is read per row, by the row's person), so a reused one
// draws its new room, and avatars clear on reuse (PersonAvatar's recyclingKey).
// Unlike FlashList 2's default, it never holds a row in place across a change
// of data: a room bumped to the top shows at the top (PINNED_TO_TOP).
// Given the room commands, each row swipes (room-swipe.tsx: right to mark
// read, left for pin and mute) and offers the same commands to a screen
// reader; one row is open at a time, and a scroll closes it.
import { memo, useCallback, useMemo, useRef, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { FlashList, type ListRenderItem } from "@shopify/flash-list";
import { useIsOnline } from "@/components/people/use-is-online";
import { newestRow, sameRoomListRow, type RoomListRow, type RoomMark } from "@/lib/room-list";
import { RoomRow, type RoomRowAction } from "./room-row";
import { RoomSwipe, type RoomSwipeButton } from "./room-swipe";
import { roomCommandsFor, type RoomCommands } from "./use-room-commands";
import { useStableHandlers } from "./use-stable-handlers";

interface RowHandlers {
  onOpen: (row: RoomListRow) => void;
  onMenu: (row: RoomListRow) => void;
  onRead: (row: RoomListRow) => void;
  onPin: (row: RoomListRow) => void;
  onMute: (row: RoomListRow) => void;
  /** A row's swipe opened its buttons: the list closes the one open before. */
  onSwipeOpen: (close: () => void) => void;
}

interface ItemProps {
  row: RoomListRow;
  /** "Chi đang nhập…" over the last message while someone types. */
  typingLine: string | null;
  queued: boolean;
  /** What the person left unsent in this room, one line. */
  draft: string | null;
  handlers: RowHandlers;
  /** The list was given the room commands: the row swipes and names them to a screen reader. */
  commanded: boolean;
}

const NO_COMMANDS = { read: false, pin: false, mute: false };

function RoomListItem({ row, typingLine, queued, draft, handlers, commanded }: ItemProps) {
  const { t } = useTranslation();
  const { mark } = row;
  const online = useIsOnline(mark.kind === "dm" ? mark.userId : undefined);
  // This cell renders only when its row, typing line, send state or presence changed: no memo to keep here.
  const shownMark: RoomMark = mark.kind === "dm" ? { ...mark, online } : mark;
  const typing = typingLine !== null;
  const can = commanded ? roomCommandsFor(row) : NO_COMMANDS;
  const read = () => handlers.onRead(row);
  const pin = () => handlers.onPin(row);
  const mute = () => handlers.onMute(row);
  const actions: RoomRowAction[] = [];
  const buttons: RoomSwipeButton[] = [];
  if (can.read) actions.push({ name: "mark_read", label: t("mobile.notification_actions.mark_read"), run: read });
  if (can.pin) {
    actions.push({ name: "pin", label: t(row.pinned ? "chat.mobile.unpin_conversation" : "chat.settings_pin_conversation"), run: pin });
    buttons.push({
      key: "pin",
      label: t(row.pinned ? "chat.action_unpin" : "chat.action_pin"),
      icon: row.pinned ? "pin" : "pin-outline",
      tone: "orange",
      onPress: pin,
    });
  }
  if (can.mute) {
    actions.push({ name: "mute", label: t(row.muted ? "chat.mobile.unmute_notifications" : "chat.settings_mute_notifications"), run: mute });
    buttons.push({
      key: "mute",
      label: t(row.muted ? "mobile.room_swipe.unmute" : "mobile.room_swipe.mute"),
      icon: row.muted ? "notifications" : "notifications-off",
      tone: "gray",
      onPress: mute,
    });
  }
  const drawn = (
    <RoomRow
      title={row.title}
      mark={shownMark}
      seed={row.roomId ?? row.key}
      prefix={typing ? null : row.prefix}
      subtitle={typingLine ?? row.subtitle}
      typing={typing}
      missed={!typing && row.missed}
      seen={row.seen}
      queued={queued}
      // Who is typing outranks the draft, as on the web's list.
      draft={typing ? null : draft}
      time={row.time}
      unread={row.unread}
      mentionUnread={row.mentionUnread}
      muted={row.muted}
      pinned={row.pinned}
      onPress={() => handlers.onOpen(row)}
      onLongPress={() => handlers.onMenu(row)}
      actions={actions}
      testID={row.roomId ? `room-row-${row.roomId}` : undefined}
    />
  );
  if (!can.read && buttons.length === 0) return drawn;
  return (
    <RoomSwipe
      rowKey={row.key}
      onRead={can.read ? read : undefined}
      readLabel={t("mobile.room_swipe.read")}
      buttons={buttons}
      onOpen={handlers.onSwipeOpen}
    >
      {drawn}
    </RoomSwipe>
  );
}

/** A cell redraws when its row draws differently, its typing line or send state changed. */
const MemoRoomListItem = memo(
  RoomListItem,
  (a, b) =>
    a.typingLine === b.typingLine &&
    a.queued === b.queued &&
    a.draft === b.draft &&
    a.handlers === b.handlers &&
    a.commanded === b.commanded &&
    sameRoomListRow(a.row, b.row),
);

type ListProps = Pick<ComponentProps<typeof FlashList<RoomListRow>>, "ListHeaderComponent" | "ListEmptyComponent" | "refreshControl">;

interface Props extends ListProps {
  rows: RoomListRow[];
  typingLines: Readonly<Record<string, string>>;
  /** Rooms with a message waiting in the send queue for the network. */
  queuedRooms: ReadonlySet<string>;
  /** Room id → the draft left there (components/chat/use-drafts.ts › useRoomDraftLines). */
  drafts?: Readonly<Record<string, string>>;
  onOpen: (row: RoomListRow) => void;
  onMenu: (row: RoomListRow) => void;
  /** Mark read, pin and mute (use-room-commands.ts): the rows swipe and name them to a screen reader. */
  commands?: RoomCommands;
}

const keyOf = (row: RoomListRow) => row.key;
// FlashList 2 keeps the first visible row where it was across a data change unless this is disabled. The inbox sorts
// by latest activity, so a new message moves its room to index 0 and the list would scroll by a row to keep the old
// top row in place: a reader at the top would never see the room arrive. This list stays pinned to its top.
const PINNED_TO_TOP = { disabled: true } as const;
// A DM row and a group or channel row are laid out alike but carry different avatars: recycled within their kind.
const typeOf = (row: RoomListRow) => row.mark.kind;

const NO_DRAFTS: Readonly<Record<string, string>> = {};

export function RoomListView({ rows, typingLines, queuedRooms, drafts = NO_DRAFTS, onOpen, onMenu, commands, ...list }: Props) {
  // A skipped cell holds the row it last drew; a tap acts on the newest row with that key.
  const latest = useRef(new Map<string, RoomListRow>());
  latest.current = useMemo(() => new Map(rows.map((row) => [row.key, row])), [rows]);
  // The close of the row whose buttons are open, if any.
  const openSwipe = useRef<(() => void) | null>(null);
  const handlers = useStableHandlers({
    onOpen: (row: RoomListRow) => onOpen(newestRow(latest.current, row)),
    onMenu: (row: RoomListRow) => onMenu(newestRow(latest.current, row)),
    onRead: (row: RoomListRow) => commands?.markRead(newestRow(latest.current, row)),
    onPin: (row: RoomListRow) => commands?.togglePin(newestRow(latest.current, row)),
    onMute: (row: RoomListRow) => commands?.toggleMute(newestRow(latest.current, row)),
    onSwipeOpen: (close: () => void) => {
      if (openSwipe.current !== close) openSwipe.current?.();
      openSwipe.current = close;
    },
  });
  const closeSwipe = useCallback(() => {
    openSwipe.current?.();
    openSwipe.current = null;
  }, []);
  const commanded = commands !== undefined;
  const renderItem: ListRenderItem<RoomListRow> = useCallback(
    ({ item }) => (
      <MemoRoomListItem
        row={item}
        typingLine={item.roomId ? (typingLines[item.roomId] ?? null) : null}
        queued={item.roomId ? queuedRooms.has(item.roomId) : false}
        draft={item.roomId ? (drafts[item.roomId] ?? null) : null}
        handlers={handlers}
        commanded={commanded}
      />
    ),
    [typingLines, queuedRooms, drafts, handlers, commanded],
  );
  return (
    <FlashList
      data={rows}
      keyExtractor={keyOf}
      getItemType={typeOf}
      maintainVisibleContentPosition={PINNED_TO_TOP}
      keyboardShouldPersistTaps="handled"
      renderItem={renderItem}
      // A scroll closes the row left open, as Mail's and WhatsApp's lists do.
      onScrollBeginDrag={closeSwipe}
      testID="room-list"
      {...list}
    />
  );
}
