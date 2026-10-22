// The app's entry and auth gates as the router runs them (app/index.tsx, app/(auth)/login.tsx,
// app/(app)/_layout.tsx, app/(app)/select-workspace.tsx): who lands where, and what picking a
// workspace opens. The workspace's own screens are stand-ins here; they have their own tests.
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
import { api } from "@/data/api";
import { useAuthStore } from "@/data/auth/store";
import { chatApi } from "@/data/chat-api";
import { useWorkspaceStore } from "@/data/stores/workspace-store";
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

afterEach(async () => {
  // Unmount first: a mounted gate would redirect on the reset below.
  await cleanup();
  useAuthStore.setState({ user: null, isLoading: true });
  useWorkspaceStore.setState({ current: null });
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
