// The root layout (app/_layout.tsx) as the router runs it, the one route file no test rendered (its floor sat at 0):
// it holds the splash until the first screen knows where it is going, completes the PKCE callback a deep link brings,
// keeps a chat link that arrives signed out for after sign-in, opens the one a notification tap names, and tears the
// session down once — not once per request — when the server answers 401 or ends the session. The native services it
// starts at import (crash reporting, calls, the encrypted store, the app's counters) are their own modules' tests;
// here they are stubs, and the screens behind the gate are stand-ins.
import { act, cleanup, screen, waitFor } from "@testing-library/react-native";
import { configureRuntime } from "@uniwork/core/runtime-config";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import { AppState, Platform, Text } from "react-native";
import RootLayout, { ErrorBoundary } from "@/app/_layout";
import AuthLayout from "@/app/(auth)/_layout";
import Index from "@/app/index";
import { api } from "@/data/api";
import { trackFirstScreen } from "@/data/app-startup";
import { authConfig, session } from "@/data/auth/flow";
import { useAuthStore } from "@/data/auth/store";
import { runChatNotificationAction } from "@/data/chat-notification-actions";
import { queryClient } from "@/data/query-client";
import { useWorkspaceStore } from "@/data/stores/workspace-store";
import { takePendingDeepLink } from "@/lib/deep-link";
import { i18n } from "@/lib/i18n/singleton";
import { renderRoutes } from "@/test/route-render";
import { render } from "@/test/render";

jest.unmock("expo-router");
jest.mock("@/global.css", () => ({}));
// The SDK ships ESM Jest does not load; without a DSN its wrapper is a pass-through anyway.
jest.mock("@sentry/react-native", () => ({ wrap: <T,>(component: T) => component }));
jest.mock("@/data/sentry", () => ({ sentryNavigation: { registerNavigationContainer: jest.fn() }, ScreenFullyDrawn: () => null }));
// Started at import; each has its own test.
jest.mock("@/data/boot", () => ({ bootRuntime: jest.fn() }));
jest.mock("@/data/calls/call-wiring", () => ({ startNativeCalls: jest.fn() }));
// The system's call UI (CallKit): the root layout hands it the URL opener an answered call's room goes through.
jest.mock("@/data/calls/call-session", () => {
  const started: { open: ((url: string) => void) | null } = { open: null };
  return { started, startNativeCallSession: (open: (url: string) => void) => void (started.open = open) };
});
jest.mock("@/data/storage/native-device-store", () => ({ openNativeDeviceStore: jest.fn() }));
jest.mock("@/data/query-persister", () => ({ installAccountCache: jest.fn(), createDevicePersister: jest.fn() }));
jest.mock("@/data/app-startup", () => ({ startAppServices: jest.fn(), trackFirstScreen: jest.fn(), trackPushOpen: jest.fn() }));
// expo-status-bar's component left a handle that kept Jest from finishing the file; it draws nothing a test reads.
jest.mock("expo-status-bar", () => ({ StatusBar: () => null }));
jest.mock("expo-splash-screen", () => ({ preventAutoHideAsync: jest.fn(async () => true), hide: jest.fn() }));
jest.mock("@/data/notification-channels", () => ({ ensureNotificationChannels: jest.fn(async () => undefined) }));
jest.mock("@/data/chat-notification-actions", () => ({ registerChatMessageCategory: jest.fn(async () => undefined), runChatNotificationAction: jest.fn(async () => "read") }));
jest.mock("expo-notifications", () => ({
  ...jest.requireActual("expo-notifications"),
  addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponse: jest.fn(() => null),
  clearLastNotificationResponse: jest.fn(),
}));
// The OS's URLs: the one that launched the app, and the router's URLs built with the build's scheme (Jest's empty
// manifest has none).
jest.mock("expo-linking", () => ({
  ...jest.requireActual("expo-linking"),
  getInitialURL: jest.fn(async () => null),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  createURL: jest.fn((path: string) => `uniworkchat-dev://${path.replace(/^\//, "")}`),
}));
jest.mock("@react-native-community/netinfo", () => {
  const netInfo = { configure: () => undefined, addEventListener: () => () => undefined, fetch: async () => ({ isConnected: true, isInternetReachable: true }) };
  return { __esModule: true, default: netInfo, ...netInfo, useNetInfo: () => ({ isConnected: true }) };
});

const LoginStandIn = () => <Text testID="login">login</Text>;
const PickerStandIn = () => <Text testID="picker">picker</Text>;
const ChatStandIn = () => <Text testID="chat">chat</Text>;

const AppStandInLayout = AuthLayout;

const ROUTES = {
  _layout: RootLayout,
  index: Index,
  "(auth)/_layout": AuthLayout,
  "(auth)/login": LoginStandIn,
  "(app)/_layout": AppStandInLayout,
  "(app)/select-workspace": PickerStandIn,
  "(app)/[org]/[ws]/chat": ChatStandIn,
};

const APP_URL = "https://app.example";
const user = { id: "u1", email: "an@example.com", display_name: "An" };
/** A tap on a chat push whose data names `url`, the way the server's Expo sender shapes it. */
const { initialize, adoptSession, logout } = useAuthStore.getState();
const storeCommands = { initialize, adoptSession, logout };

let notificationId = 0;
const notificationFor = (url: string) =>
  ({
    actionIdentifier: Notifications.DEFAULT_ACTION_IDENTIFIER,
    notification: { request: { identifier: `n${++notificationId}`, content: { data: { url } } } },
  }) as unknown as Notifications.NotificationResponse;

/** The session's listener the layout registered: the session calls it with a token, or null when the server ended it. */
let sessionListener: (token: string | null) => void = () => undefined;
let onUnauthorized: () => void = () => undefined;

beforeEach(() => {
  configureRuntime({ appUrl: APP_URL, apiUrl: "https://api.example" });
  jest.spyOn(api, "request").mockResolvedValue({});
  jest.spyOn(api, "listWorkspaces").mockResolvedValue([]);
  jest.spyOn(api, "setOnUnauthorized").mockImplementation((cb) => void (onUnauthorized = cb));
  jest.spyOn(session, "onChange").mockImplementation((cb) => {
    sessionListener = cb;
    return () => undefined;
  });
  jest.spyOn(session, "completeCallback").mockResolvedValue();
  jest.mocked(Linking.getInitialURL).mockResolvedValue(null);
  // The store's own commands are its tests' (data/auth/store.test.ts); here they only record that they were asked.
  useAuthStore.setState({
    initialize: jest.fn(async () => useAuthStore.setState({ isLoading: false })),
    adoptSession: jest.fn(async () => undefined),
    logout: jest.fn(async () => useAuthStore.setState({ user: null })),
  });
});

afterEach(async () => {
  await cleanup();
  // The app's own client (the root layout provides it): its ten-minute collection timers would hold Jest open.
  queryClient.clear();
  takePendingDeepLink();
  useAuthStore.setState({ ...storeCommands, user: null, isLoading: true });
  useWorkspaceStore.setState({ current: null });
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("the root layout", () => {

  it("lifts the splash once the first screen knows where it goes: sign-in for a signed-out person", async () => {
    await renderRoutes(ROUTES, "/");
    expect(await screen.findByTestId("login")).toBeOnTheScreen();
    await waitFor(() => expect(SplashScreen.hide).toHaveBeenCalled());
    expect(trackFirstScreen).toHaveBeenCalled();
  });

  it("completes the sign-in when the PKCE callback opens the app", async () => {
    jest.mocked(Linking.getInitialURL).mockResolvedValue(`${authConfig.scheme}://auth/callback?code=c&state=s`);
    await renderRoutes(ROUTES, "/");
    await waitFor(() => expect(session.completeCallback).toHaveBeenCalledWith(`${authConfig.scheme}://auth/callback?code=c&state=s`));
  });

  it("keeps a chat link a notification tap brings while signed out for after sign-in, and ignores any other URL", async () => {
    let tap: (response: Notifications.NotificationResponse) => void = () => undefined;
    jest.mocked(Notifications.addNotificationResponseReceivedListener).mockImplementation((cb) => {
      tap = cb;
      return { remove: jest.fn() } as never;
    });
    await renderRoutes(ROUTES, "/");
    await screen.findByTestId("login");
    await act(async () => tap(notificationFor("https://evil.example/x")));
    expect(takePendingDeepLink()).toBeNull();
    await act(async () => tap(notificationFor(`${APP_URL}/acme/hq/chat?room=r1`)));
    expect(takePendingDeepLink()).toMatchObject({ orgSlug: "acme", wsSlug: "hq", roomId: "r1" });
  });

  it("keeps the room of a call answered on CallKit's screen for after sign-in, as a notification tap's", async () => {
    const { started } = jest.requireMock<{ started: { open: ((url: string) => void) | null } }>("@/data/calls/call-session");
    await renderRoutes(ROUTES, "/");
    await screen.findByTestId("login");
    await act(async () => started.open?.(`${authConfig.scheme}://open?url=${encodeURIComponent("/acme/hq/chat?room=r1&call=c1")}`));
    expect(takePendingDeepLink()).toMatchObject({ orgSlug: "acme", wsSlug: "hq", roomId: "r1", callId: "c1" });
  });

  it("opens the room a notification tap names for a signed-in person", async () => {
    useAuthStore.setState({ user: user as never });
    let tap: (response: Notifications.NotificationResponse) => void = () => undefined;
    jest.mocked(Notifications.addNotificationResponseReceivedListener).mockImplementation((cb) => {
      tap = cb;
      return { remove: jest.fn() } as never;
    });
    const routes = await renderRoutes(ROUTES, "/");
    expect(await screen.findByTestId("picker")).toBeOnTheScreen();
    await act(async () => tap(notificationFor(`${APP_URL}/acme/hq/chat?room=r1`)));
    // The chat tab with ?room= opens the room itself (test/routes/workspace.test.tsx).
    expect(await screen.findByTestId("chat")).toBeOnTheScreen();
    expect(routes.pathname()).toBe("/acme/hq/chat");
  });

  it("opens the room of a reply the app lock refused, behind the lock", async () => {
    jest.mocked(runChatNotificationAction).mockResolvedValueOnce("locked");
    useAuthStore.setState({ user: user as never });
    let tap: (response: Notifications.NotificationResponse) => void = () => undefined;
    jest.mocked(Notifications.addNotificationResponseReceivedListener).mockImplementation((cb) => {
      tap = cb;
      return { remove: jest.fn() } as never;
    });
    const routes = await renderRoutes(ROUTES, "/");
    expect(await screen.findByTestId("picker")).toBeOnTheScreen();
    const data = { url: `${APP_URL}/acme/hq/chat?room=r1`, workspace_id: "w1", room_id: "r1", message_id: "m1" };
    const reply = { actionIdentifier: "reply", userText: "hi", notification: { request: { identifier: "n-locked", content: { data } } } };
    await act(async () => tap(reply as unknown as Notifications.NotificationResponse));
    expect(runChatNotificationAction).toHaveBeenCalledWith(expect.objectContaining({ action: "reply", text: "hi" }));
    expect(await screen.findByTestId("chat")).toBeOnTheScreen();
    expect(routes.pathname()).toBe("/acme/hq/chat");
  });

  it("on Android, opens a refused reply's room only in an app in front: a hidden one would read the room for nobody", async () => {
    // Android's Reply does not bring the app forward, yet a live app's listener hears it too
    // (ExpoHandlingDelegate.handleNotificationResponse): opening the room there would mark it read and clear its
    // notifications behind the person's back.
    const os = Platform.OS;
    const state = Object.getOwnPropertyDescriptor(AppState, "currentState");
    Platform.OS = "android";
    Object.defineProperty(AppState, "currentState", { value: "background", configurable: true, writable: true });
    try {
      jest.mocked(runChatNotificationAction).mockResolvedValue("locked");
      useAuthStore.setState({ user: user as never });
      let tap: (response: Notifications.NotificationResponse) => void = () => undefined;
      jest.mocked(Notifications.addNotificationResponseReceivedListener).mockImplementation((cb) => {
        tap = cb;
        return { remove: jest.fn() } as never;
      });
      const routes = await renderRoutes(ROUTES, "/");
      expect(await screen.findByTestId("picker")).toBeOnTheScreen();
      const data = { url: `${APP_URL}/acme/hq/chat?room=r1`, workspace_id: "w1", room_id: "r1", message_id: "m1" };
      const reply = (id: string) => ({ actionIdentifier: "reply", userText: "hi", notification: { request: { identifier: id, content: { data } } } });
      await act(async () => tap(reply("n-hidden") as unknown as Notifications.NotificationResponse));
      expect(runChatNotificationAction).toHaveBeenCalledWith(expect.objectContaining({ action: "reply", text: "hi" }));
      expect(screen.queryByTestId("chat")).toBeNull();
      expect(routes.pathname()).toBe("/select-workspace");
      // The same refusal with the app in front (Reply from a heads-up notification over it) opens the room.
      Object.defineProperty(AppState, "currentState", { value: "active", configurable: true, writable: true });
      await act(async () => tap(reply("n-front") as unknown as Notifications.NotificationResponse));
      expect(await screen.findByTestId("chat")).toBeOnTheScreen();
    } finally {
      jest.mocked(runChatNotificationAction).mockResolvedValue("read");
      Platform.OS = os;
      if (state) Object.defineProperty(AppState, "currentState", state);
    }
  });

  it("signs out once when several requests answer 401 together, and lands on sign-in", async () => {
    useAuthStore.setState({ user: user as never });
    const routes = await renderRoutes(ROUTES, "/");
    await act(async () => {
      onUnauthorized();
      onUnauthorized();
    });
    await waitFor(() => expect(routes.pathname()).toBe("/login"));
    expect(useAuthStore.getState().logout).toHaveBeenCalledTimes(1);
  });

  it("adopts a session a deep link brought, and signs out when the server ends the session of a signed-in person", async () => {
    await renderRoutes(ROUTES, "/");
    expect(useAuthStore.getState().logout).not.toHaveBeenCalled();
    await act(async () => sessionListener("token"));
    expect(useAuthStore.getState().adoptSession).toHaveBeenCalled();
    // Nobody signed in: a null token is the sign-out the app asked for, nothing more to do.
    await act(async () => sessionListener(null));
    expect(useAuthStore.getState().logout).not.toHaveBeenCalled();
    await act(async () => useAuthStore.setState({ user: user as never }));
    await act(async () => sessionListener(null));
    await waitFor(() => expect(useAuthStore.getState().logout).toHaveBeenCalledTimes(1));
  });

  it("shows a retry screen for a render crash instead of a white one", async () => {
    await render(<ErrorBoundary error={new Error("boom")} retry={jest.fn(async () => undefined)} />);
    expect(screen.getByText(i18n.t("mobile.app.error_title"))).toBeOnTheScreen();
  });
});
