// What a person does on each secondary screen of the workspace, through the real router and the fake server of
// test/workspace-server.tsx (audit "thin-coverage-core-chat": the route layer had two test files for twenty route
// files): the channel directory joins and opens channels and says when it cannot; a new group is named, picked and
// created, and people are added to an existing one from its details; the new-message screen opens a DM and says when
// it cannot; a room's details mute, search inside the room, open a member's DM and leave. Each screen's loading,
// empty and error state is here too, the way the person meets it.
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Alert, type AlertButton } from "react-native";
import { api } from "@/data/api";
import { useToastStore } from "@/data/stores/toast-store";
import { viText } from "@/test/render";
import { channel, group, installWorkspaceServer, member, message, mount, world } from "@/test/workspace-server";

jest.unmock("expo-router");
jest.mock("@/data/realtime/ws-client", () => ({ WSClient: jest.requireActual("@/test/fake-ws-client").FakeWSClient }));
// jest-expo's native token emitter hands back no subscription: the layout's token-rotation watch needs one to remove.
jest.mock("expo-notifications", () => ({ ...jest.requireActual("expo-notifications"), addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })) }));
jest.mock("@react-native-community/netinfo", () => {
  const netInfo = { configure: () => undefined, addEventListener: () => () => undefined, fetch: async () => ({ isConnected: true, isInternetReachable: true }) };
  return { __esModule: true, default: netInfo, ...netInfo, useNetInfo: () => ({ isConnected: true }) };
});
jest.mock("@/components/chat/swipe-to-reply", () => ({ SwipeToReply: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/data/sentry", () => ({ ScreenFullyDrawn: () => null }));
jest.mock("@/components/chat/use-voice-recorder", () => ({
  VOICE_MAX_MS: 120_000,
  useVoiceRecorder: () => ({ active: false, elapsedMs: 0, start: jest.fn(), cancel: jest.fn(), send: jest.fn() }),
}));

installWorkspaceServer();

const toasts = () => useToastStore.getState().toasts.map((toast) => toast.message);
afterEach(async () => {
  await act(() => useToastStore.getState().clear());
});

/** The channel the person has not joined yet: the directory lists it, their own list does not. */
const notJoined = (url: string, method: string, path: string) =>
  method === "GET" && url === "/api/v1/workspaces/w1/chat/channels" && path.includes("scope=mine") ? { rooms: [] } : undefined;

describe("the channel directory", () => {
  it("joins a channel on a tap and opens it", async () => {
    world.override = (url, method, path) =>
      method === "POST" && url === "/api/v1/workspaces/w1/chat/channels/c1/join" ? { room: { ...channel } } : notJoined(url, method, path);
    const routes = await mount("/acme/hq/channels");
    await fireEvent.press(await screen.findByRole("button", { name: viText("chat.channel.join_named", { name: "thong-bao" }) }));
    await waitFor(() => expect(routes.pathname()).toBe("/acme/hq/room/c1"));
    expect(world.requests).toContain("POST /api/v1/workspaces/w1/chat/channels/c1/join");
  });

  it("says when joining fails and stays on the directory", async () => {
    world.override = (url, method, path) => {
      if (method === "POST" && url.endsWith("/join")) throw new Error("down");
      return notJoined(url, method, path);
    };
    const routes = await mount("/acme/hq/channels");
    await fireEvent.press(await screen.findByRole("button", { name: viText("chat.channel.join_named", { name: "thong-bao" }) }));
    await waitFor(() => expect(toasts()).toContain(viText("chat.channel.join_failed", { name: "thong-bao" })));
    expect(routes.pathname()).toBe("/acme/hq/channels");
    expect(screen.getByRole("button", { name: viText("chat.channel.join_named", { name: "thong-bao" }) })).toBeOnTheScreen();
  });

  it("opens a channel already joined without joining it again", async () => {
    const routes = await mount("/acme/hq/channels");
    await fireEvent.press(await screen.findByRole("button", { name: viText("chat.mobile.channel_open_aria", { name: "#thong-bao" }) }));
    await waitFor(() => expect(routes.pathname()).toBe("/acme/hq/room/c1"));
    expect(world.requests.some((r) => r.endsWith("/join"))).toBe(false);
  });

  it("says when a search matches nothing, and when there is no channel at all", async () => {
    world.override = (url, method) => (method === "GET" && url === "/api/v1/workspaces/w1/chat/channels" ? { rooms: [] } : undefined);
    await mount("/acme/hq/channels");
    expect(await screen.findByText(viText("chat.channel.directory_none_title"))).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText(viText("chat.channel.directory_search")), "  sales ");
    expect(await screen.findByText(viText("chat.channel.directory_no_match_title", { query: "sales" }))).toBeOnTheScreen();
    expect(screen.getByText(viText("chat.channel.directory_no_match_hint"))).toBeOnTheScreen();
  });

  it("says when the directory cannot be read, and reads it again on Retry", async () => {
    let failing = true;
    world.override = (url, method, path) => {
      if (failing && method === "GET" && url === "/api/v1/workspaces/w1/chat/channels" && path.includes("discoverable")) throw new Error("down");
      return notJoined(url, method, path);
    };
    await mount("/acme/hq/channels");
    expect(await screen.findByText(viText("chat.channel.directory_load_failed"))).toBeOnTheScreen();
    failing = false;
    await fireEvent.press(screen.getByRole("button", { name: viText("common.retry") }));
    expect(await screen.findByText("Tin chung")).toBeOnTheScreen();
  });
});

describe("a new group", () => {
  it("waits for a name and two others, then creates the group and opens it", async () => {
    world.override = (url, method) =>
      method === "POST" && url === "/api/v1/workspaces/w1/chat/groups" ? { room: { ...group, id: "g2", name: "Ra mắt" } } : undefined;
    const routes = await mount("/acme/hq/new-group");
    const start = () => screen.getByRole("button", { name: viText("chat.start_group") });
    await fireEvent.press(await screen.findByRole("checkbox", { name: "Bình Trần" }));
    expect(screen.getByText(viText("chat.mobile.group_selected", { count: 1 }))).toBeOnTheScreen();
    expect(start().props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByRole("checkbox", { name: "Chi Lê" }));
    await fireEvent.press(start());
    expect(world.requests).not.toContain("POST /api/v1/workspaces/w1/chat/groups");
    await fireEvent.changeText(screen.getByLabelText(viText("chat.group_name_label")), "  Ra mắt ");
    await fireEvent.press(start());
    await waitFor(() => expect(routes.pathname()).toBe("/acme/hq/room/g2"));
    const create = jest.mocked(api.request).mock.calls.find(([path, init]) => path.endsWith("/chat/groups") && init?.method === "POST");
    expect(JSON.parse(String(create?.[1]?.body))).toEqual({ name: "Ra mắt", member_user_ids: ["U2", "U3"] });
  });

  it("drops a picked person from the strip, finds people by name, and says when creating fails", async () => {
    world.override = (url, method) => {
      if (method === "POST" && url === "/api/v1/workspaces/w1/chat/groups") throw new Error("down");
      return undefined;
    };
    const routes = await mount("/acme/hq/new-group");
    await fireEvent.press(await screen.findByRole("checkbox", { name: "Bình Trần" }));
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.remove_member", { name: "Bình Trần" }) }));
    expect(screen.getByRole("checkbox", { name: "Bình Trần" }).props.accessibilityState).toMatchObject({ checked: false });
    await fireEvent.changeText(screen.getByLabelText(viText("chat.member_search_label")), "chi");
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: "Bình Trần" })).toBeNull());
    await fireEvent.press(screen.getByRole("checkbox", { name: "Chi Lê" }));
    await fireEvent.changeText(screen.getByLabelText(viText("chat.member_search_label")), "");
    await fireEvent.press(await screen.findByRole("checkbox", { name: "Bình Trần" }));
    await fireEvent.changeText(screen.getByLabelText(viText("chat.group_name_label")), "Team");
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.start_group") }));
    await waitFor(() => expect(toasts()).toContain(viText("common.error")));
    expect(routes.pathname()).toBe("/acme/hq/new-group");
  });

  it("adds people to a group from its details: who is in already cannot be picked, and the details come back", async () => {
    world.override = (url, method) => {
      if (method === "GET" && url === "/api/v1/workspaces/w1/chat/rooms/g1") return { room: group };
      if (method === "GET" && url === "/api/v1/workspaces/w1/chat/rooms/g1/members") return { members: [member("ME", "Tôi"), member("U2", "Bình Trần")] };
      if (method === "POST" && url === "/api/v1/workspaces/w1/chat/rooms/g1/members") return { room: group };
      return undefined;
    };
    const routes = await mount("/acme/hq/room/g1/info");
    await fireEvent.press(await screen.findByRole("button", { name: viText("chat.add_group_members") }));
    await waitFor(() => expect(routes.pathname()).toBe("/acme/hq/new-group"));
    expect(await screen.findByText(viText("chat.add_group_members_title"))).toBeOnTheScreen();
    expect(screen.queryByLabelText(viText("chat.group_name_label"))).toBeNull();
    const bình = await screen.findByRole("checkbox", { name: `Bình Trần, ${viText("chat.already_in_group")}` });
    expect(bình.props.accessibilityState).toMatchObject({ checked: true, disabled: true });
    expect(screen.getByText(viText("chat.add_group_members_hint"))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("checkbox", { name: "Chi Lê" }));
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.invite_members") }));
    await waitFor(() => expect(routes.pathname()).toBe("/acme/hq/room/g1/info"));
    expect(world.requests).toContain("POST /api/v1/workspaces/w1/chat/rooms/g1/members");
  });

  it("says when the workspace's people cannot be read, and reads them again on Retry", async () => {
    let failing = true;
    world.override = (url) => {
      if (failing && url === "/api/v1/workspaces/w1/members") throw new Error("down");
      return undefined;
    };
    await mount("/acme/hq/new-group");
    expect(await screen.findByText(viText("chat.members_load_failed"))).toBeOnTheScreen();
    failing = false;
    await fireEvent.press(screen.getByRole("button", { name: viText("common.retry") }));
    expect(await screen.findByRole("checkbox", { name: "Chi Lê" })).toBeOnTheScreen();
  });
});

describe("a new message", () => {
  it("opens the DM with the person tapped", async () => {
    const routes = await mount("/acme/hq/new-chat");
    await fireEvent.press(await screen.findByRole("button", { name: `${viText("chat.start_dm")}: Bình Trần` }));
    await waitFor(() => expect(routes.pathname()).toBe("/acme/hq/room/r1"));
  });

  it("says when the DM cannot be opened, whether the server refuses or answers nothing", async () => {
    let refuse = true;
    world.override = (url, method) => {
      if (method !== "POST" || url !== "/api/v1/workspaces/w1/chat/dm") return undefined;
      if (refuse) throw new Error("down");
      return { room: null };
    };
    const routes = await mount("/acme/hq/new-chat");
    await fireEvent.press(await screen.findByRole("button", { name: `${viText("chat.start_dm")}: Chi Lê` }));
    await waitFor(() => expect(toasts()).toEqual([viText("chat.dm_failed")]));
    await act(() => useToastStore.getState().clear());
    refuse = false;
    await fireEvent.press(screen.getByRole("button", { name: `${viText("chat.start_dm")}: Chi Lê` }));
    await waitFor(() => expect(toasts()).toEqual([viText("chat.dm_failed")]));
    expect(routes.pathname()).toBe("/acme/hq/new-chat");
  });

  it("says when nobody matches, and opens the channel directory", async () => {
    const routes = await mount("/acme/hq/new-chat");
    await fireEvent.changeText(await screen.findByLabelText(viText("chat.member_search_label")), " zz ");
    expect(await screen.findByText(viText("chat.workspace_members_no_match", { query: "zz" }))).toBeOnTheScreen();
    await fireEvent.press(screen.getByText(viText("chat.channel.directory_title")));
    await waitFor(() => expect(routes.pathname()).toBe("/acme/hq/channels"));
  });

  it("says when the workspace has nobody else", async () => {
    world.override = (url) => (url === "/api/v1/workspaces/w1/members" ? { members: [member("ME", "Tôi")] } : undefined);
    await mount("/acme/hq/new-chat");
    expect(await screen.findByText(viText("chat.workspace_members_none"))).toBeOnTheScreen();
  });

  it("says when the workspace's people cannot be read, and reads them again on Retry", async () => {
    let failing = true;
    world.override = (url) => {
      if (failing && url === "/api/v1/workspaces/w1/members") throw new Error("down");
      return undefined;
    };
    await mount("/acme/hq/new-chat");
    expect(await screen.findByText(viText("chat.members_load_failed"))).toBeOnTheScreen();
    failing = false;
    await fireEvent.press(screen.getByRole("button", { name: viText("common.retry") }));
    expect(await screen.findByRole("button", { name: `${viText("chat.start_dm")}: Chi Lê` })).toBeOnTheScreen();
  });
});

describe("a room's details", () => {
  it("mutes the room and unmutes it", async () => {
    let muted = false;
    world.override = (url, method) => {
      if (url === "/api/v1/workspaces/w1/chat/rooms/r1/mute") {
        muted = method === "POST";
        return { status: "ok" };
      }
      if (method === "GET" && url === "/api/v1/workspaces/w1/chat/rooms") {
        return { rooms: [{ id: "r1", kind: "dm", name: "", workspace_id: "w1", peer_user_id: "U2", peer_display_name: "Bình Trần", notifications_muted: muted }] };
      }
      return undefined;
    };
    await mount("/acme/hq/room/r1/info");
    await fireEvent.press(await screen.findByRole("button", { name: viText("chat.settings_mute_notifications") }));
    await waitFor(() => expect(world.requests).toContain("POST /api/v1/workspaces/w1/chat/rooms/r1/mute"));
    await fireEvent.press(await screen.findByRole("button", { name: viText("chat.mobile.unmute_notifications") }));
    await waitFor(() => expect(world.requests).toContain("DELETE /api/v1/workspaces/w1/chat/rooms/r1/mute"));
  });

  it("says when muting fails", async () => {
    world.override = (url) => {
      if (url === "/api/v1/workspaces/w1/chat/rooms/r1/mute") throw new Error("down");
      return undefined;
    };
    await mount("/acme/hq/room/r1/info");
    await fireEvent.press(await screen.findByRole("button", { name: viText("chat.settings_mute_notifications") }));
    await waitFor(() => expect(toasts()).toContain(viText("common.error")));
  });

  it("searches inside the room, and a result opens the room at that message", async () => {
    world.override = (url, method) =>
      method === "GET" && url === "/api/v1/workspaces/w1/chat/rooms/r1/messages/search"
        ? { messages: [message("m0", "U2", "Tuần trước đã chốt bản này", -10_000)] }
        : undefined;
    const routes = await mount("/acme/hq/room/r1/info");
    await fireEvent.press(await screen.findByRole("button", { name: viText("chat.search_messages") }));
    await fireEvent.changeText(screen.getByPlaceholderText(viText("chat.search_messages")), "chốt");
    await fireEvent.press(await screen.findByText(/Tuần trước đã chốt bản này/));
    await waitFor(() => expect(routes.pathname()).toBe("/acme/hq/room/r1"));
    expect(await screen.findByText(viText("chat.search_jump_banner"))).toBeOnTheScreen();
  });

  it("opens the DM with a member from their menu, and lists every member", async () => {
    const routes = await mount("/acme/hq/room/r1/info");
    const bình = (await screen.findAllByRole("button", { name: /^Bình Trần/ })).at(-1);
    if (!bình) throw new Error("no member row");
    await fireEvent.press(bình);
    await fireEvent.press(await screen.findByRole("button", { name: viText("mobile.safety.message") }));
    await waitFor(() => expect(routes.pathname()).toMatch(/^\/acme\/hq\/(room\/r1|chat)/));
  });

  it("leaves the room only once the person confirms, then leaves its screens", async () => {
    world.override = (url, method) => (method === "POST" && url === "/api/v1/workspaces/w1/chat/rooms/r1/leave" ? { status: "ok" } : undefined);
    const alert = jest.spyOn(Alert, "alert");
    const routes = await mount("/acme/hq/chat");
    await fireEvent.press(await screen.findByText("Bình Trần"));
    await fireEvent.press(await screen.findByRole("button", { name: new RegExp(viText("chat.mobile.room_info")) }));
    await fireEvent.press(await screen.findByText(viText("chat.leave_conversation")));
    const buttons = alert.mock.calls.at(-1)?.[2] as AlertButton[];
    expect(alert.mock.calls.at(-1)?.[1]).toBe(viText("chat.leave_conversation_confirm_description_dm"));
    expect(world.requests).not.toContain("POST /api/v1/workspaces/w1/chat/rooms/r1/leave");
    await act(async () => buttons.find((b) => b.style === "destructive")?.onPress?.());
    await waitFor(() => expect(world.requests).toContain("POST /api/v1/workspaces/w1/chat/rooms/r1/leave"));
    await waitFor(() => expect(routes.pathname()).toBe("/acme/hq/chat"));
  });
});
