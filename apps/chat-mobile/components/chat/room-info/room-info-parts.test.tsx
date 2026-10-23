// The parts of a conversation's details screen, as a person hears them: the
// hero line, the quick actions, search hits, the pins row, the members list
// and leaving. The route (room/[roomId]/info.tsx) only wires them.
import { ChatMessageSchema, ChatRoomSchema, type ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import { Alert, type AlertButton } from "react-native";
import { toast } from "@/data/stores/toast-store";
import { render, viText } from "@/test/render";
import { RoomInfoHero, RoomQuickActions } from "./hero";
import { KeptRow } from "./kept-row";
import { LeaveRoomRow } from "./leave-row";
import { MEMBERS_PREVIEW, RoomMembersSection } from "./members-section";
import { Divider } from "./quick-action";
import { RoomSearchResults } from "./search-results";

const room = (extra: Record<string, unknown>): ChatRoomRecord => ChatRoomSchema.parse({ id: "r1", workspace_id: "w1", name: "Thiết kế", kind: "group", member_count: 3, ...extra });

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(toast, "error").mockImplementation(() => 0);
});
afterEach(() => jest.restoreAllMocks());

describe("RoomInfoHero", () => {
  it("says a group's member count, a DM's peer online, and nothing it does not know", async () => {
    const view = await render(<RoomInfoHero room={room({})} roomId="r1" title="Thiết kế" peerOnline={false} memberCount={3} />);
    expect(screen.getByRole("header", { name: "Thiết kế" })).toBeOnTheScreen();
    expect(screen.getByText(viText("chat.group_member_count", { count: 3 }))).toBeOnTheScreen();

    const dm = room({ kind: "dm", name: "", peer_user_id: "u2", peer_display_name: "Bình", member_count: 2 });
    await view.rerender(<RoomInfoHero room={dm} roomId="r1" title="Bình" peerOnline memberCount={2} />);
    expect(screen.getByText(viText("chat.presence_online"))).toBeOnTheScreen();
    await view.rerender(<RoomInfoHero room={dm} roomId="r1" title="Bình" peerOnline={false} memberCount={2} />);
    expect(screen.queryByText(viText("chat.presence_online"))).toBeNull();

    await view.rerender(<RoomInfoHero room={null} roomId="r1" title="" peerOnline={false} memberCount={0} />);
    expect(screen.queryByText(viText("chat.group_member_count", { count: 0 }))).toBeNull();
  });
});

describe("RoomQuickActions", () => {
  const handlers = () => ({ onToggleMute: jest.fn(), onSearch: jest.fn(), onCall: jest.fn(), onAddPeople: jest.fn() });

  it("mutes, searches, calls and adds people where each applies", async () => {
    const h = handlers();
    const view = await render(<RoomQuickActions muted={false} callable isGroup {...h} />);
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.settings_mute_notifications") }));
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.search_messages") }));
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.voice_call_start") }));
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.add_group_members") }));
    for (const fn of Object.values(h)) expect(fn).toHaveBeenCalledTimes(1);

    await view.rerender(<RoomQuickActions muted callable={false} isGroup={false} {...h} />);
    expect(screen.getByRole("button", { name: viText("chat.mobile.unmute_notifications") })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: viText("chat.voice_call_start") })).toBeNull();
    expect(screen.queryByRole("button", { name: viText("chat.add_group_members") })).toBeNull();
  });
});

describe("RoomSearchResults", () => {
  const hit = ChatMessageSchema.parse({ id: "m9", room_id: "r1", workspace_id: "w1", sender_id: "u2", sender_display_name: "Bình", kind: "text", body: "biên bản họp", created_at: "2026-10-20T09:00:00Z" });

  it("shows the spinner while it asks, no results for a real query, and opens a hit at its message", async () => {
    const open = jest.fn();
    const senderName = jest.fn(() => "Bình");
    const view = await render(<RoomSearchResults query="bi" fetching results={undefined} senderName={senderName} onOpen={open} />);
    expect(screen.getByLabelText(viText("chat.search_loading"))).toBeOnTheScreen();
    await view.rerender(<RoomSearchResults query=" b " fetching={false} results={[]} senderName={senderName} onOpen={open} />);
    expect(screen.queryByText(viText("chat.search_messages_no_results"))).toBeNull();
    await view.rerender(<RoomSearchResults query="bie" fetching={false} results={[]} senderName={senderName} onOpen={open} />);
    expect(screen.getByText(viText("chat.search_messages_no_results"))).toBeOnTheScreen();
    await view.rerender(<RoomSearchResults query="bie" fetching={false} results={[hit]} senderName={senderName} onOpen={open} />);
    await fireEvent.press(screen.getByRole("button", { name: /biên bản họp/ }));
    expect(open).toHaveBeenCalledWith("m9");
    expect(senderName).toHaveBeenCalledWith(expect.objectContaining({ id: "m9" }));
  });
});

it("separates the sections with a band", async () => {
  await render(<Divider />);
  expect(screen.toJSON()).not.toBeNull();
});

describe("KeptRow", () => {
  it("counts the pins, notes and polls and opens the room", async () => {
    const open = jest.fn();
    await render(<KeptRow kept={{ pins: 2, notes: 1, polls: 0 }} onPress={open} />);
    await fireEvent.press(screen.getByRole("button", { name: new RegExp(viText("chat.mobile.shared_notes_row")) }));
    expect(screen.getByText(viText("chat.mobile.shared_notes_counts", { pins: 2, notes: 1, polls: 0 }))).toBeOnTheScreen();
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe("RoomMembersSection", () => {
  const member = (n: number, role = "member") => ({ user_id: `u${n}`, email: `u${n}@uni.vn`, role });
  const nameOf = (m: { user_id: string }) => `Người ${m.user_id}`;

  it("lists the first few with a count and asks for everyone on 'see all'; one's own row does not open", async () => {
    const open = jest.fn();
    const seeAll = jest.fn();
    const members = [member(1, "admin"), ...Array.from({ length: MEMBERS_PREVIEW }, (_, i) => member(i + 2))];
    await render(<RoomMembersSection members={members} currentUserId="u1" nameOf={nameOf} onOpen={open} onSeeAll={seeAll} />);
    expect(screen.getByRole("header", { name: `${viText("chat.members_title")} · ${members.length}` })).toBeOnTheScreen();
    expect(screen.queryByText(`Người u${members.length}`)).toBeNull();
    // Everyone is a screen of their own (room-members-screen.tsx), a recycling list: never mapped in here.
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.mobile.see_all") }));
    expect(seeAll).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(`Người u${members.length}`)).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: /^Người u2,/ }));
    expect(open).toHaveBeenCalledWith({ userId: "u2", name: "Người u2" });
    expect(screen.queryByRole("button", { name: /^Người u1,/ })).toBeNull();
  });

  it("offers no 'see all' while every member fits the preview", async () => {
    await render(<RoomMembersSection members={[member(1), member(2)]} currentUserId="u1" nameOf={nameOf} onOpen={jest.fn()} onSeeAll={jest.fn()} />);
    expect(screen.queryByRole("button", { name: viText("chat.mobile.see_all") })).toBeNull();
  });

  it("titles an empty list without a count", async () => {
    await render(<RoomMembersSection members={[]} currentUserId="u1" nameOf={nameOf} onOpen={jest.fn()} onSeeAll={jest.fn()} />);
    expect(screen.getByRole("header", { name: viText("chat.members_title") })).toBeOnTheScreen();
  });
});

describe("LeaveRoomRow", () => {
  /** Presses the confirm dialog's destructive button. */
  const confirm = async () => {
    const buttons = jest.mocked(Alert.alert).mock.lastCall?.[2] as AlertButton[];
    await act(async () => buttons.find((b) => b.style === "destructive")?.onPress?.());
  };

  it("asks first, telling a DM and a group apart, then closes the stack once left", async () => {
    jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const leave = jest.fn(async () => undefined);
    const view = await render(<LeaveRoomRow dm onLeave={leave} />);
    await fireEvent.press(screen.getByRole("button", { name: new RegExp(viText("chat.leave_conversation")) }));
    expect(Alert.alert).toHaveBeenLastCalledWith(viText("chat.leave_conversation_confirm_title"), viText("chat.leave_conversation_confirm_description_dm"), expect.any(Array));
    expect(leave).not.toHaveBeenCalled();
    await confirm();
    await waitFor(() => expect(router.dismissAll).toHaveBeenCalledTimes(1));

    await view.rerender(<LeaveRoomRow dm={false} onLeave={leave} />);
    await fireEvent.press(screen.getByRole("button", { name: new RegExp(viText("chat.leave_conversation")) }));
    expect(Alert.alert).toHaveBeenLastCalledWith(viText("chat.leave_conversation_confirm_title"), viText("chat.leave_conversation_confirm_description_group"), expect.any(Array));
  });

  it("says so when the server refuses, and stays", async () => {
    jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    await render(<LeaveRoomRow dm={false} onLeave={() => Promise.reject(new Error("409"))} />);
    await fireEvent.press(screen.getByRole("button", { name: new RegExp(viText("chat.leave_conversation")) }));
    await confirm();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(viText("chat.leave_conversation_failed")));
    expect(router.dismissAll).not.toHaveBeenCalled();
  });
});
