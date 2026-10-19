// Spec §5: the phone's list shows the web's numbers. The counts are the room
// records' own (no local arithmetic); order, titles and previews follow the
// web's sidebar rules.
import { ChatRoomSchema, type ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { describe, expect, it } from "vitest";
import { i18n } from "./i18n/singleton";
import { buildRoomList, filterRoomList, roomTitle, workspaceRoomTitle, type RoomListFilter } from "./room-list";

const room = (raw: Record<string, unknown>): ChatRoomRecord =>
  ChatRoomSchema.parse({ workspace_id: "w1", name: "", member_count: 0, ...raw });

const rooms: ChatRoomRecord[] = [
  room({
    id: "ws-room",
    kind: "channel",
    is_default: true,
    name: "Acme",
    unread_count: 2,
    last_message_body: "chào",
    last_message_sender_id: "u2",
    last_message_sender_name: "Bình",
    last_message_at: "2026-10-17T09:00:00Z",
  }),
  room({
    id: "dm1",
    kind: "dm",
    name: "Bình",
    peer_user_id: "u2",
    peer_display_name: "Bình",
    peer_email: "binh@x.vn",
    unread_count: 3,
    mention_unread_count: 1,
    notifications_muted: true,
    last_message_body: "[@An](mention://member/u1) xem nhé",
    last_message_sender_id: "u2",
    last_message_at: "2026-10-17T10:00:00Z",
  }),
  room({ id: "g1", kind: "group", name: "Thiết kế", member_user_ids: ["u2", "u3"], last_message_at: "2026-10-16T10:00:00Z", last_message_body: "ok", last_message_sender_id: "u1" }),
  room({ id: "c1", kind: "channel", name: "sales", visibility: "private", last_message_kind: "file", last_message_body: "bao-gia.pdf", last_message_at: "2026-10-15T10:00:00Z" }),
  room({ id: "c2", kind: "channel", name: "dev", last_message_kind: "voice_call_log", last_message_at: "2026-10-14T10:00:00Z" }),
];

const base = {
  rooms,
  filterText: "",
  workspaceName: "Acme",
  currentUserId: "u1",
  nicknamesByUserId: {},
  workspaceMembers: [{ user_id: "u3", display_name: "Chi", email: "chi@x.vn" }],
  pinnedByRoomId: {},
  typingByRoomId: {},
  isOnline: (userId: string) => userId === "u2",
  t: i18n.getFixedT("vi"),
  locale: "vi",
};

describe("buildRoomList", () => {
  it("shows each room's own unread and mention counts, newest first", () => {
    const rows = buildRoomList(base);
    expect(rows.map((row) => [row.key, row.unread, row.mentionUnread, row.muted])).toEqual([
      ["dm:u2", 3, 1, true],
      ["workspace", 2, 0, false],
      ["group:g1", 0, 0, false],
      ["channel:c1", 0, 0, false],
      ["channel:c2", 0, 0, false],
    ]);
  });

  it("words titles, marks and previews like the web's rows", () => {
    const rows = Object.fromEntries(buildRoomList(base).map((row) => [row.key, row]));
    expect(rows["dm:u2"]).toMatchObject({ title: "Bình", mark: { kind: "dm", online: true }, subtitle: "@An xem nhé", roomId: "dm1" });
    expect(rows.workspace).toMatchObject({ title: "Chung", mark: { kind: "workspace" }, prefix: "Bình: ", subtitle: "chào" });
    expect(rows["group:g1"]).toMatchObject({ title: "Thiết kế", prefix: "Bạn: ", subtitle: "ok", time: expect.any(String) });
    expect(rows["channel:c1"]).toMatchObject({ title: "sales", mark: { kind: "private-channel" }, subtitle: "bao-gia.pdf" });
    expect(rows["channel:c2"]).toMatchObject({ title: "#dev", mark: { kind: "channel" }, subtitle: "Cuộc gọi thoại" });
  });

  it("puts pinned rooms first and shows who is typing instead of the last message", () => {
    const rows = buildRoomList({
      ...base,
      pinnedByRoomId: { c2: { pinned: true, pinnedAt: 1 } },
      typingByRoomId: { g1: ["U3"] },
    });
    expect(rows[0]).toMatchObject({ key: "channel:c2", pinned: true });
    expect(rows.find((row) => row.key === "group:g1")).toMatchObject({ typing: true, subtitle: "Chi đang nhập…" });
  });

  it("filters by the search field, a workspace room without messages says whose it is, a DM without a room opens none", () => {
    expect(buildRoomList({ ...base, filterText: "thiet" }).map((row) => row.key)).toEqual(["group:g1"]);
    const quiet = buildRoomList({ ...base, rooms: [room({ id: "ws-room", kind: "workspace", name: "Acme" })] });
    expect(quiet[0]).toMatchObject({ title: "Chung", subtitle: "Cả workspace", time: null, unread: 0 });
    const roomless = buildRoomList({ ...base, rooms: [] });
    expect(roomless).toEqual([expect.objectContaining({ key: "workspace", roomId: null, room: null, unread: 0, mentionUnread: 0, pinned: false })]);
  });

  it("keeps a group's own empty preview empty", () => {
    const rows = buildRoomList({ ...base, rooms: [room({ id: "g2", kind: "group", name: "Mới" })] });
    expect(rows.find((row) => row.key === "group:g2")?.subtitle).toBeNull();
  });
});

describe("filterRoomList", () => {
  it("keeps what each chip names, the workspace room among the channels", () => {
    const rows = buildRoomList(base);
    const keys = (filter: RoomListFilter) => filterRoomList(rows, filter).map((row) => row.key);
    expect(keys("all")).toEqual(["dm:u2", "workspace", "group:g1", "channel:c1", "channel:c2"]);
    expect(keys("unread")).toEqual(["dm:u2", "workspace"]);
    expect(keys("mentions")).toEqual(["dm:u2"]);
    expect(keys("group")).toEqual(["group:g1"]);
    expect(keys("channel")).toEqual(["workspace", "channel:c1", "channel:c2"]);
  });

  it("counts a mention without an unread count as unread", () => {
    const rows = buildRoomList({ ...base, rooms: [room({ id: "g3", kind: "group", name: "Nhắc", mention_unread_count: 1 })] });
    expect(filterRoomList(rows, "unread").map((row) => row.key)).toEqual(["group:g3"]);
  });
});

describe("roomTitle", () => {
  it("words a room's header as its row", () => {
    const options = { nicknamesByUserId: { U2: "Anh Bình" }, workspaceName: "Acme", t: i18n.getFixedT("vi") };
    expect(rooms.map((r) => roomTitle(r, options))).toEqual(["Chung", "Anh Bình", "Thiết kế", "sales", "#dev"]);
  });
});

describe("workspaceRoomTitle", () => {
  it("names the room unless it only repeats the workspace", () => {
    expect(workspaceRoomTitle("Acme", "Acme", "Chung")).toBe("Chung");
    expect(workspaceRoomTitle(" ", "Acme", "Chung")).toBe("Chung");
    expect(workspaceRoomTitle(undefined, undefined, "Chung")).toBe("Chung");
    expect(workspaceRoomTitle("Phòng lớn", "Acme", "Chung")).toBe("Phòng lớn");
  });
});
