// The Chat tab's list of conversations (audit P2 Perf). Rows come built
// without typing or presence (lib/room-list.ts); the typing lines are laid over
// them here and each DM row reads its peer's presence itself, so a typing frame
// redraws the row that types and a presence change the row of that person.
// Every cell gets the same handlers object and is skipped while its row draws
// the same, so a new message redraws the rows it moved or changed only.
import { memo, useCallback, useMemo, useRef, type ComponentProps } from "react";
import { FlatList, type ListRenderItem } from "react-native";
import { useIsOnline } from "@/components/people/use-is-online";
import { newestRow, sameRoomListRow, type RoomListRow, type RoomMark } from "@/lib/room-list";
import { RoomRow } from "./room-row";
import { useStableHandlers } from "./use-stable-handlers";

interface RowHandlers {
  onOpen: (row: RoomListRow) => void;
  onMenu: (row: RoomListRow) => void;
}

interface ItemProps {
  row: RoomListRow;
  /** "Chi đang nhập…" over the last message while someone types. */
  typingLine: string | null;
  queued: boolean;
  handlers: RowHandlers;
}

function RoomListItem({ row, typingLine, queued, handlers }: ItemProps) {
  const { mark } = row;
  const online = useIsOnline(mark.kind === "dm" ? mark.userId : undefined);
  // This cell renders only when its row, typing line, send state or presence changed: no memo to keep here.
  const shownMark: RoomMark = mark.kind === "dm" ? { ...mark, online } : mark;
  const typing = typingLine !== null;
  return (
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
      time={row.time}
      unread={row.unread}
      mentionUnread={row.mentionUnread}
      muted={row.muted}
      pinned={row.pinned}
      onPress={() => handlers.onOpen(row)}
      onLongPress={() => handlers.onMenu(row)}
      testID={row.roomId ? `room-row-${row.roomId}` : undefined}
    />
  );
}

/** A cell redraws when its row draws differently, its typing line or send state changed. */
const MemoRoomListItem = memo(
  RoomListItem,
  (a, b) => a.typingLine === b.typingLine && a.queued === b.queued && a.handlers === b.handlers && sameRoomListRow(a.row, b.row),
);

type ListProps = Pick<ComponentProps<typeof FlatList<RoomListRow>>, "ListHeaderComponent" | "ListEmptyComponent" | "refreshControl">;

interface Props extends ListProps {
  rows: RoomListRow[];
  typingLines: Readonly<Record<string, string>>;
  /** Rooms with a message waiting in the send queue for the network. */
  queuedRooms: ReadonlySet<string>;
  onOpen: (row: RoomListRow) => void;
  onMenu: (row: RoomListRow) => void;
}

const keyOf = (row: RoomListRow) => row.key;

export function RoomListView({ rows, typingLines, queuedRooms, onOpen, onMenu, ...list }: Props) {
  // A skipped cell holds the row it last drew; a tap acts on the newest row with that key.
  const latest = useRef(new Map<string, RoomListRow>());
  latest.current = useMemo(() => new Map(rows.map((row) => [row.key, row])), [rows]);
  const handlers = useStableHandlers({
    onOpen: (row: RoomListRow) => onOpen(newestRow(latest.current, row)),
    onMenu: (row: RoomListRow) => onMenu(newestRow(latest.current, row)),
  });
  const renderItem: ListRenderItem<RoomListRow> = useCallback(
    ({ item }) => (
      <MemoRoomListItem
        row={item}
        typingLine={item.roomId ? (typingLines[item.roomId] ?? null) : null}
        queued={item.roomId ? queuedRooms.has(item.roomId) : false}
        handlers={handlers}
      />
    ),
    [typingLines, queuedRooms, handlers],
  );
  return <FlatList data={rows} keyExtractor={keyOf} keyboardShouldPersistTaps="handled" renderItem={renderItem} {...list} />;
}
