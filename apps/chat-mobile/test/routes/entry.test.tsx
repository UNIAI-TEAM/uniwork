// The app's entry and auth gates as the router runs them (app/index.tsx, app/(auth)/login.tsx,
// app/(app)/_layout.tsx, app/(app)/select-workspace.tsx): who lands where, and what picking a
// workspace opens. The workspace's own screens are stand-ins here; they have their own tests.
import { onlineManager } from "@tanstack/react-query";
import { act, cleanup, fireEvent, screen } from "@testing-library/react-native";
import { EMPTY_UNREAD_SUMMARY } from "@uniwork/core/api/endpoints/chat-schemas";
import type { Workspace } from "@uniwork/core/types/workspace";
import { Text } from "react-native";
import AppLayout from "@/app/(app)/_layout";
import AccountSettings from "@/app/(app)/account";
import LicensesScreen from "@/app/(app)/licenses";
import SelectWorkspace from "@/app/(app)/select-workspace";
import AuthLayout from "@/app/(auth)/_layout";
import Login from "@/app/(auth)/login";
import Index from "@/app/index";
import { ApiError, api } from "@/data/api";
import { appleSignInOffered } from "@/data/auth/flow";
import { useAuthStore } from "@/data/auth/store";
import { chatApi } from "@/data/chat-api";
import { useWorkspaceStore } from "@/data/stores/workspace-store";
import { SchemaMismatchError } from "@/lib/schema-mismatch";
import { DISPLAY_MAX_FONT_SCALE } from "@/lib/type-scale";
import { renderRoutes } from "@/test/route-render";
import { viText } from "@/test/render";

jest.unmock("expo-router");
// The query client and the account sync read NetInfo; its native module is not in Jest.
// jest-expo's native token emitter hands back no subscription: the layout's token-rotation watch needs one to remove.
jest.mock("expo-notifications", () => ({ ...jest.requireActual("expo-notifications"), addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })) }));
jest.mock("@react-native-community/netinfo", () => {
  const netInfo = { configure: () => undefined, addEventListener: () => () => undefined, fetch: async () => ({ isConnected: true, isInternetReachable: true }) };
  return { __esModule: true, default: netInfo, ...netInfo, useNetInfo: () => ({ isConnected: true }) };
});

// Sign in with Apple (ADR 0041): Apple's system button is a native view, here a pressable stand-in; whether it is
// offered (an iPhone that has it, a server that takes it) is the composition root's answer, off unless a test says.
jest.mock("expo-apple-authentication", () => {
  const { Pressable, Text: RNText } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    AppleAuthenticationButtonType: { SIGN_IN: 0, CONTINUE: 1 },
    AppleAuthenticationButtonStyle: { WHITE: 0, WHITE_OUTLINE: 1, BLACK: 2 },
    AppleAuthenticationButton: ({ onPress }: { onPress: () => void }) => (
      <Pressable accessibilityRole="button" testID="apple-native-button" onPress={onPress}>
        <RNText>Continue with Apple</RNText>
      </Pressable>
    ),
  };
});
jest.mock("@/data/auth/flow", () => ({ ...jest.requireActual("@/data/auth/flow"), appleSignInOffered: jest.fn(async () => false) }));

const ChatStandIn = () => <Text testID="chat-tab">chat</Text>;

const ROUTES = {
  index: Index,
  "(auth)/_layout": AuthLayout,
  "(auth)/login": Login,
  "(app)/_layout": AppLayout,
  "(app)/select-workspace": SelectWorkspace,
  "(app)/account": AccountSettings,
  "(app)/licenses": LicensesScreen,
  "(app)/[org]/[ws]/chat": ChatStandIn,
};

const user = { id: "u1", email: "an@example.com", name: "An" };
const workspace = (id: string, slug: string): Workspace =>
  ({ id, slug, name: `Không gian ${slug}`, organization_id: "o1", organization_slug: "acme", organization_name: "Acme" }) as Workspace;

beforeEach(() => {
  jest.spyOn(api, "listWorkspaces").mockResolvedValue([workspace("w1", "main"), workspace("w2", "sales")]);
  jest.spyOn(chatApi, "unreadSummary").mockResolvedValue(EMPTY_UNREAD_SUMMARY);
});

const realLogin = useAuthStore.getState().login;

afterEach(async () => {
  // Unmount first: a mounted gate would redirect on the reset below.
  await cleanup();
  useAuthStore.setState({ user: null, isLoading: true, login: realLogin });
  jest.mocked(appleSignInOffered).mockResolvedValue(false);
  useWorkspaceStore.setState({ current: null });
  onlineManager.setOnline(true);
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("the entry gate", () => {
  it("sends a signed-out person to sign in", async () => {
    useAuthStore.setState({ user: null, isLoading: false });
    const routes = await renderRoutes(ROUTES, "/");
    expect(await screen.findByTestId("login-screen")).toBeTruthy();
    expect(routes.pathname()).toBe("/login");
  });

  // iOS AX5 (a11y-large-text-dark.yaml): uncapped, the 28 pt title reached 100 pt and broke "Welcome" mid-word.
  it("caps only the welcome title's growth with the text size: the hint and the button keep scaling", async () => {
    useAuthStore.setState({ user: null, isLoading: false });
    await renderRoutes(ROUTES, "/login");
    const title = await screen.findByTestId("login-title");
    expect(title.props.maxFontSizeMultiplier).toBe(DISPLAY_MAX_FONT_SCALE);
    expect(screen.getByText(viText("mobile.login_hint")).props.maxFontSizeMultiplier).toBeUndefined();
    expect(screen.getByText(viText("auth.desktop.unichat_login_button")).props.maxFontSizeMultiplier).toBeUndefined();
  });

  it("offers Sign in with Apple above the browser, and says why a refused one cannot go on", async () => {
    jest.mocked(appleSignInOffered).mockResolvedValue(true);
    const login = jest.fn(async (method?: string) => {
      if (method === "apple") throw Object.assign(new Error("refused"), { code: "apple_account_conflict" });
    });
    useAuthStore.setState({ user: null, isLoading: false, login });
    await renderRoutes(ROUTES, "/login");
    const apple = await screen.findByTestId("apple-native-button");
    const tree = JSON.stringify(screen.toJSON());
    expect(tree.indexOf("apple-native-button")).toBeLessThan(tree.indexOf("login-button"));
    await fireEvent.press(apple);
    expect(login).toHaveBeenCalledWith("apple");
    expect(await screen.findByText(viText("chat.mobile.login_apple_conflict"))).toBeTruthy();
    await fireEvent.press(screen.getByTestId("login-button"));
    expect(login).toHaveBeenLastCalledWith("browser");
    expect(screen.queryByText(viText("chat.mobile.login_apple_conflict"))).toBeNull();
  });

  it("shows no Apple button where it is not offered", async () => {
    useAuthStore.setState({ user: null, isLoading: false });
    await renderRoutes(ROUTES, "/login");
    expect(await screen.findByTestId("login-button")).toBeTruthy();
    expect(screen.queryByTestId("apple-native-button")).toBeNull();
  });

  it("asks a signed-in person with no workspace yet to pick one, and opens the one picked", async () => {
    useAuthStore.setState({ user: user as never, isLoading: false });
    const routes = await renderRoutes(ROUTES, "/");
    const row = await screen.findByRole("button", { name: /Không gian sales/ });
    expect(routes.pathname()).toBe("/select-workspace");
    await act(async () => fireEvent.press(row));
    expect(await screen.findByTestId("chat-tab")).toBeTruthy();
    expect(routes.pathname()).toBe("/acme/sales/chat");
    expect(useWorkspaceStore.getState().current).toMatchObject({ orgSlug: "acme", wsSlug: "sales", wsId: "w2" });
  });

  it("opens the chat of the workspace the phone remembers", async () => {
    useAuthStore.setState({ user: user as never, isLoading: false });
    useWorkspaceStore.setState({ current: { orgSlug: "acme", wsSlug: "main", wsId: "w1" } });
    const routes = await renderRoutes(ROUTES, "/");
    expect(await screen.findByTestId("chat-tab")).toBeTruthy();
    expect(routes.pathname()).toBe("/acme/main/chat");
  });

  it("keeps a signed-out deep link out of the app, and a signed-in person off the sign-in screen", async () => {
    useAuthStore.setState({ user: null, isLoading: false });
    const out = await renderRoutes(ROUTES, "/select-workspace");
    expect(await screen.findByTestId("login-screen")).toBeTruthy();
    expect(out.pathname()).toBe("/login");
    await cleanup();

    useAuthStore.setState({ user: user as never, isLoading: false });
    useWorkspaceStore.setState({ current: { orgSlug: "acme", wsSlug: "main", wsId: "w1" } });
    const signedIn = await renderRoutes(ROUTES, "/login");
    expect(await screen.findByTestId("chat-tab")).toBeTruthy();
    expect(signedIn.pathname()).toBe("/acme/main/chat");
  });

  it("says when the workspaces cannot be read, and reads them again on Retry", async () => {
    jest.mocked(api.listWorkspaces).mockRejectedValueOnce(new Error("offline"));
    useAuthStore.setState({ user: user as never, isLoading: false });
    await renderRoutes(ROUTES, "/select-workspace");
    const retry = await screen.findByRole("button", { name: viText("common.retry") });
    await act(async () => fireEvent.press(retry));
    expect(await screen.findByRole("button", { name: /Không gian main/ })).toBeTruthy();
  });

  // TestFlight build 4 (iOS): NetInfo's probe hit a route production did not serve yet, called a working network
  // offline for good, and the picker said "Bạn chưa ở workspace nào" for a request it never sent.
  it("lists the workspaces even while the reachability probe calls the network offline", async () => {
    onlineManager.setOnline(false);
    useAuthStore.setState({ user: user as never, isLoading: false });
    await renderRoutes(ROUTES, "/select-workspace");
    expect(await screen.findByRole("button", { name: /Không gian sales/ })).toBeTruthy();
    expect(screen.getAllByText("Acme").length).toBeGreaterThan(0);
    expect(screen.queryByText(viText("mobile.account.no_workspace"))).toBeNull();
  });

  it("waits for the network, never says 'no workspace', while no answer has come; Retry asks again now", async () => {
    onlineManager.setOnline(false);
    // Failed once the router is mounted: renderRouter's fake timers would hold the retry's delay for good.
    let fail: (error: unknown) => void = () => undefined;
    jest.mocked(api.listWorkspaces).mockImplementationOnce(() => new Promise((_resolve, reject) => (fail = reject)));
    useAuthStore.setState({ user: user as never, isLoading: false });
    // The app's own retry (data/query-client.ts): the second attempt waits for an online the probe never gives.
    await renderRoutes(ROUTES, "/select-workspace", { retry: 1, retryDelay: 0 });
    await act(async () => fail(new ApiError("Network request failed", 0)));
    expect(await screen.findByText(viText("chat.mobile.offline_banner"))).toBeTruthy();
    expect(screen.queryByText(viText("mobile.account.no_workspace"))).toBeNull();
    await act(async () => fireEvent.press(screen.getByRole("button", { name: viText("common.retry") })));
    expect(await screen.findByRole("button", { name: /Không gian main/ })).toBeTruthy();
    expect(api.listWorkspaces).toHaveBeenCalledTimes(2);
  });

  it("says a list it could not read is an error, not an empty one", async () => {
    jest.mocked(api.listWorkspaces).mockRejectedValueOnce(new SchemaMismatchError("GET /api/v1/workspaces", [{ path: "workspaces", code: "invalid_type" }]));
    useAuthStore.setState({ user: user as never, isLoading: false });
    await renderRoutes(ROUTES, "/select-workspace");
    expect(await screen.findByText(viText("common.error"))).toBeTruthy();
    expect(screen.queryByText(viText("mobile.account.no_workspace"))).toBeNull();
    await act(async () => fireEvent.press(screen.getByRole("button", { name: viText("common.retry") })));
    expect(await screen.findByRole("button", { name: /Không gian main/ })).toBeTruthy();
  });

  // Apple 5.1.1(v), Play's account deletion policy: deletion and the legal pages are reachable from
  // every signed-in state, including a member removed from every workspace (audit
  // "deletion-unreachable-without-workspace"). The policy's "Settings → Delete account" holds here too.
  it("lets a person with no workspace reach Settings: the legal pages, the licenses and account deletion", async () => {
    jest.mocked(api.listWorkspaces).mockResolvedValue([]);
    useAuthStore.setState({ user: user as never, isLoading: false });
    const routes = await renderRoutes(ROUTES, "/");
    expect(await screen.findByText(viText("mobile.account.no_workspace"))).toBeTruthy();
    expect(routes.pathname()).toBe("/select-workspace");
    await act(async () => fireEvent.press(screen.getByTestId("select-workspace-settings")));
    expect(await screen.findByTestId("settings-delete-account")).toBeTruthy();
    expect(routes.pathname()).toBe("/account");
    expect(screen.getByTestId("legal-privacy")).toBeTruthy();
    expect(screen.getByTestId("legal-terms")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("legal-licenses")));
    expect((await screen.findAllByText(viText("mobile.licenses.title"))).length).toBeGreaterThan(0);
    expect(routes.pathname()).toBe("/licenses");
  });

  // ADR 0041: an account made with Apple's Hide My Email has Apple's forwarding address, and an invitation to the
  // person's work email names another account; the empty list says so instead of "ask an admin".
  it("tells a Hide My Email account why an invitation to its work email does not reach it", async () => {
    jest.mocked(api.listWorkspaces).mockResolvedValue([]);
    const relay = "q7x@privaterelay.appleid.com";
    useAuthStore.setState({ user: { ...user, email: relay } as never, isLoading: false });
    await renderRoutes(ROUTES, "/select-workspace");
    expect(await screen.findByText(viText("mobile.account.no_workspace_relay", { email: relay }))).toBeTruthy();
    expect(screen.queryByText(viText("mobile.account.no_workspace"))).toBeNull();
  });

  it("signs out from the account's own Settings", async () => {
    jest.mocked(api.listWorkspaces).mockResolvedValue([]);
    const original = useAuthStore.getState().logout;
    const logout = jest.fn(async () => {});
    useAuthStore.setState({ user: user as never, isLoading: false, logout });
    try {
      await renderRoutes(ROUTES, "/account");
      await act(async () => fireEvent.press(await screen.findByTestId("account-logout")));
      expect(logout).toHaveBeenCalled();
    } finally {
      await act(async () => useAuthStore.setState({ logout: original }));
    }
  });
});
