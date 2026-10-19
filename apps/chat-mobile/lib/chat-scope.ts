// Copied from packages/views/chat/chat-scope.ts and chat-sidebar-unified.ts ›
// kindInScope / CHAT_SIDEBAR_TABS_BY_SCOPE: the chat list shows one scope at a
// time. Messages are the organization's DMs and groups, the same in every
// workspace; a workspace holds its own room and channels. Listed together, the
// same DMs and groups repeated in every workspace's list.
import type { RoomListFilter, RoomListRow } from "./room-list";

export type ChatScope = "messages" | "workspace";

export function rowInScope(scope: ChatScope, row: Pick<RoomListRow, "entry">): boolean {
  const kind = row.entry.kind;
  return scope === "messages" ? kind === "dm" || kind === "group" : kind === "workspace" || kind === "channel";
}

/** The scope's rows in list order; a workspace's own room heads its channels, as on the web. */
export function scopeRows<Row extends Pick<RoomListRow, "entry">>(scope: ChatScope, rows: readonly Row[]): Row[] {
  const kept = rows.filter((row) => rowInScope(scope, row));
  if (scope === "messages") return kept;
  return [...kept.filter((row) => row.entry.kind === "workspace"), ...kept.filter((row) => row.entry.kind !== "workspace")];
}

/** Each scope's chips: a kind chip only where the scope holds two kinds to tell apart. */
export const ROOM_LIST_FILTERS_BY_SCOPE: Record<ChatScope, readonly RoomListFilter[]> = {
  messages: ["all", "unread", "mentions", "group"],
  workspace: ["all", "unread", "mentions"],
};
