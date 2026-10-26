// What a person does on the Chat and Settings tabs, through the real router and the fake server of
// test/workspace-server.tsx (audit "thin-coverage-core-chat"): on Chat, the room menu a long press opens (with the
// room's latest messages lifted above it) and its commands, the switch between messages and the workspace's channels
// (where "+" browses channels and the pill switches workspace), an empty list's ways out, and a list that cannot be
// read; on Settings, the workspace switch, the theme, and signing out.
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Platform } from "react-native";
import { useAuthStore } from "@/data/auth/store";
import { viText } from "@/test/render";
import { installWorkspaceServer, latest, message, mount, world } from "@/test/workspace-server";

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

const teardown: (() => void)[] = [];
const onTeardown = (undo: () => void) => teardown.push(undo);
afterEach(() => {
  for (const undo of teardown.splice(0)) undo();
});

const roomRow = async (name: string) => {
  const row = (await screen.findAllByRole("button", { name: new RegExp(`^${name}`) })).at(0);
  if (!row) throw new Error(`no row for ${name}`);
  return row;
};

describe("the Chat tab", () => {
  it("opens a room's menu on a long press, with its latest messages above it, and runs a command from it", async () => {
    world.override = (url, method, path) =>
      method === "GET" && url === "/api/v1/workspaces/w1/chat/rooms/r1/messages" && path.includes("limit=4")
        ? { messages: [latest, message("m9", "ME", "Ok, 3 giờ", 4)] }
        : undefined;
    // Android runs a sheet's choice at once; iOS waits for the closed modal's onDismiss (action-sheet.tsx › useAfterDismiss).
    const os = Platform.OS;
    Platform.OS = "android";
    onTeardown(() => (Platform.OS = os));
    await mount("/acme/hq/chat");
    await fireEvent(await roomRow("Bình Trần"), "longPress");
    expect(await screen.findByLabelText(viText("chat.sidebar_list_menu_aria", { name: "Bình Trần" }))).toBeOnTheScreen();
    expect(await screen.findByText("Ok, 3 giờ", { includeHiddenElements: true })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.settings_mute_notifications") }));
    await waitFor(() => expect(world.requests).toContain("POST /api/v1/workspaces/w1/chat/rooms/r1/mute"));
  });

  it("switches to the workspace's channels, where + browses channels and the pill switches workspace", async () => {
    const routes = await mount("/acme/hq/chat");
    await fireEvent.press(await screen.findByRole("tab", { name: new RegExp(viText("chat.scope.channels_tab")) }));
    expect(screen.getByText(viText("chat.scope.channels_hint"))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.mobile.workspace_pill_aria_quiet", { name: "HQ" }) }));
    expect(await screen.findByLabelText(viText("mobile.settings.switch_workspace"))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.channel.directory_aria") }));
    await waitFor(() => expect(routes.pathname()).toBe("/acme/hq/channels"));
  });

  it("offers a new message and the channel directory when there is no conversation yet", async () => {
    world.override = (url, method) => (method === "GET" && url === "/api/v1/workspaces/w1/chat/rooms" ? { rooms: [] } : undefined);
    const routes = await mount("/acme/hq/chat");
    expect(await screen.findByText(viText("chat.sidebar_empty_title"))).toBeOnTheScreen();
    await fireEvent.press(screen.getByText(viText("chat.start_dm_title")));
    await waitFor(() => expect(routes.pathname()).toBe("/acme/hq/new-chat"));
  });

  it("says when the conversations cannot be read, and reads them again on Retry", async () => {
    let failing = true;
    world.override = (url, method) => {
      if (failing && method === "GET" && url === "/api/v1/workspaces/w1/chat/rooms") throw new Error("down");
      return undefined;
    };
    await mount("/acme/hq/chat");
    expect(await screen.findByText(viText("chat.sidebar_load_failed"))).toBeOnTheScreen();
    failing = false;
    await fireEvent.press(screen.getByText(viText("common.retry")));
    expect(await roomRow("Bình Trần")).toBeOnTheScreen();
  });

  it("says when a search finds no conversation", async () => {
    await mount("/acme/hq/chat");
    await roomRow("Bình Trần");
    await fireEvent.changeText(screen.getByLabelText(viText("chat.search_conversations_label")), "zzz");
    expect(await screen.findByText(viText("chat.search_no_results"))).toBeOnTheScreen();
  });
});

describe("the Settings tab", () => {
  it("opens the workspace switch", async () => {
    await mount("/acme/hq/settings");
    await fireEvent.press(
      await screen.findByRole("button", { name: `${viText("mobile.settings.switch_workspace")}, ${viText("chat.mobile.workspace_at", { name: "HQ" })}` }),
    );
    expect(await screen.findByLabelText(viText("mobile.settings.switch_workspace"))).toBeOnTheScreen();
  });

  // The language row is the root layout's I18nProvider (components/app/i18n-provider.test.tsx), which route tests do not mount.
  it("takes a theme, and puts it back", async () => {
    await mount("/acme/hq/settings");
    const radio = (label: string) => screen.getByRole("radio", { name: new RegExp(label) });
    await fireEvent.press(await screen.findByRole("radio", { name: new RegExp(viText("settings.preferences.themeDark")) }));
    await waitFor(() => expect(radio(viText("settings.preferences.themeDark")).props.accessibilityState).toEqual({ checked: true }));
    await fireEvent.press(radio(viText("settings.preferences.themeSystem")));
    await waitFor(() => expect(radio(viText("settings.preferences.themeSystem")).props.accessibilityState).toEqual({ checked: true }));
  });

  it("signs out", async () => {
    const logout = jest.spyOn(useAuthStore.getState(), "logout").mockResolvedValue();
    await mount("/acme/hq/settings");
    await fireEvent.press(await screen.findByText(viText("auth.logout")));
    await act(async () => undefined);
    expect(logout).toHaveBeenCalled();
  });
});
