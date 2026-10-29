// The empty workspace picker's invitations (pending-invitations.tsx, spec §5.2): each invitation joined in place, a
// workspace opened as soon as one is granted, the organization alone said, another organization in the way sent to
// the web, a refusal said beside its card, and an empty list told apart from one that could not be read.
import { act, fireEvent, screen } from "@testing-library/react-native";
import { configureRuntime, resetRuntimeConfig } from "@uniwork/core/runtime-config";
import type { PendingInvitation } from "@uniwork/core/types/workspace";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { AccessibilityInfo } from "react-native";
import { invitationsApi } from "@/data/invitations/api";
import { useWorkspaceStore } from "@/data/stores/workspace-store";
import { render, viText } from "@/test/render";
import { PendingInvitations } from "./pending-invitations";

/** The testID of the element the reader's focus was last sent to (use-reader-focus.ts). */
const focused = () =>
  (jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mock.calls.at(-1)?.[0] as unknown as { props?: { testID?: string } } | undefined)?.props
    ?.testID;

jest.mock("@/data/invitations/api", () => ({
  invitationsApi: { mine: jest.fn(), preview: jest.fn(), accept: jest.fn(), organizations: jest.fn() },
}));
jest.mock("@/data/api", () => ({ api: { listWorkspaces: jest.fn(async () => []), request: jest.fn() } }));
jest.mock("@react-native-community/netinfo", () => {
  const netInfo = { configure: () => undefined, addEventListener: () => () => undefined, fetch: async () => ({ isConnected: true, isInternetReachable: true }) };
  return { __esModule: true, default: netInfo, ...netInfo, useNetInfo: () => ({ isConnected: true }) };
});
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "dismiss" })) }));

const api = jest.mocked(invitationsApi);
const DAY = 24 * 60 * 60 * 1000;
const invitation = (over: Partial<PendingInvitation> = {}): PendingInvitation => ({
  id: "i1",
  role: "member",
  token: "t1",
  expires_at: new Date(Date.now() + 5 * DAY).toISOString(),
  org_role: "member",
  workspace: { id: "w1", slug: "hq", name: "HQ" },
  workspaces: [{ id: "w1", slug: "hq", name: "HQ" }],
  organization: { id: "o1", slug: "acme", name: "Acme" },
  invited_by: { display_name: "Bình" },
  ...over,
});
const refusal = (code: string, status: number) => Object.assign(new Error(code), { status, body: { error: { code } } });
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

beforeEach(() => {
  configureRuntime({ appUrl: "https://app.example" });
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  jest.spyOn(AccessibilityInfo, "sendAccessibilityEvent").mockImplementation(() => undefined);
  api.organizations.mockResolvedValue([]);
  useWorkspaceStore.setState({ current: null });
});
afterEach(() => {
  resetRuntimeConfig();
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

describe("PendingInvitations", () => {
  it("shows each invitation's outline while the list loads, then who invited, where to, the role and the days left", async () => {
    let answer: (rows: PendingInvitation[]) => void = () => undefined;
    api.mine.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    await render(<PendingInvitations email="an@acme.vn" />);
    expect(screen.getByTestId("invitations-loading")).toBeOnTheScreen();
    await act(async () => answer([invitation({ workspaces: [{ id: "w1", slug: "hq", name: "HQ" }, { id: "w2", slug: "ops", name: "Ops" }] })]));
    expect(screen.getByRole("header", { name: viText("invitations.list_title") })).toBeOnTheScreen();
    expect(screen.getByText(viText("invitations.invitedBy", { name: "Bình" }))).toBeOnTheScreen();
    expect(screen.getByText("Acme › HQ, Ops")).toBeOnTheScreen();
    expect(screen.getByText(`${viText("people.role_member")} · ${viText("invitations.preview.expires_in", { count: 5 })}`)).toBeOnTheScreen();
    expect(screen.queryByText(viText("invitations.expires_soon"))).toBeNull();
  });

  it("flags one about to lapse, and names no inviter whose name came back empty", async () => {
    api.mine.mockResolvedValueOnce([
      invitation({ expires_at: new Date(Date.now() + DAY / 2).toISOString(), invited_by: { display_name: " " }, workspace: undefined, workspaces: [] }),
    ]);
    await render(<PendingInvitations email="an@acme.vn" />);
    expect(await screen.findByText(viText("invitations.expires_soon"))).toBeOnTheScreen();
    expect(screen.getByText(viText("invitations.invited"))).toBeOnTheScreen();
    expect(screen.getByText("Acme")).toBeOnTheScreen();
  });

  it("joins and opens the workspace it grants, the list read again first", async () => {
    api.mine.mockResolvedValue([invitation()]);
    const workspace = { id: "w1", slug: "hq", name: "HQ", organization_id: "o1", organization_slug: "acme", organization_name: "Acme" };
    api.accept.mockResolvedValueOnce({ organization: { id: "o1", slug: "acme", name: "Acme" }, workspace });
    await render(<PendingInvitations email="an@acme.vn" />);
    await fireEvent.press(await screen.findByTestId("invitation-join-i1"));
    await settle();
    expect(api.accept).toHaveBeenCalledWith("t1");
    expect(useWorkspaceStore.getState().current).toEqual({ orgSlug: "acme", wsSlug: "hq", wsId: "w1" });
    expect(router.replace).toHaveBeenCalledWith("/acme/hq/chat");
  });

  it("says an organization joined with no workspace yet, and waits for an admin", async () => {
    api.mine.mockResolvedValueOnce([invitation({ workspace: undefined, workspaces: [] })]).mockResolvedValue([]);
    api.accept.mockResolvedValueOnce({ organization: { id: "o1", slug: "acme", name: "Acme" }, workspace: null });
    await render(<PendingInvitations email="an@acme.vn" />);
    await fireEvent.press(await screen.findByTestId("invitation-join-i1"));
    await settle();
    expect(await screen.findByText(viText("mobile.invitations.joined_no_workspace", { org: "Acme" }))).toBeOnTheScreen();
    expect(focused()).toBe("invitations-joined-message");
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.queryByTestId("invitations-create-org")).toBeNull();
  });

  it("joins one at a time: the others dim while one runs, and a second press of it does nothing", async () => {
    api.mine.mockResolvedValue([invitation(), invitation({ id: "i2", token: "t2", organization: { id: "o2", slug: "beta", name: "Beta" } })]);
    let finish: () => void = () => undefined;
    api.accept.mockReturnValueOnce(new Promise((resolve) => (finish = () => resolve(null))));
    await render(<PendingInvitations email="an@acme.vn" />);
    await fireEvent.press(await screen.findByTestId("invitation-join-i1"));
    expect(screen.getByTestId("invitation-join-i1")).toBeBusy();
    expect(screen.getByTestId("invitation-join-i2")).toBeDisabled();
    await fireEvent.press(screen.getByTestId("invitation-join-i1"));
    expect(api.accept).toHaveBeenCalledTimes(1);
    await act(async () => finish());
  });

  it("sends a switch to another organization to the web's invitations, never to the invite link", async () => {
    api.mine.mockResolvedValue([invitation()]);
    api.accept.mockRejectedValueOnce(refusal("organization_switch_required", 409));
    await render(<PendingInvitations email="an@acme.vn" />);
    await fireEvent.press(await screen.findByTestId("invitation-join-i1"));
    await settle();
    expect(screen.getByText(viText("invitations.switch.description", { name: "Acme" }))).toBeOnTheScreen();
    expect(screen.queryByTestId("invitation-join-i1")).toBeNull();
    // The button the reader was on is gone: it moves to the words that replaced it.
    expect(focused()).toBe("refusal-switch-note");
    await fireEvent.press(screen.getByRole("link", { name: viText("mobile.invitations.continue_on_web") }));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://app.example/invitations");
  });

  it("says an invitation that lapsed meanwhile, and a refusal beside its card with the button kept", async () => {
    api.mine.mockResolvedValue([invitation(), invitation({ id: "i2", token: "t2" })]);
    api.accept.mockRejectedValueOnce(refusal("invitation_expired", 410)).mockRejectedValueOnce(refusal("organization_suspended", 403));
    await render(<PendingInvitations email="an@acme.vn" />);
    await fireEvent.press(await screen.findByTestId("invitation-join-i1"));
    await settle();
    expect(screen.getByText(viText("invitations.gone.expired"))).toBeOnTheScreen();
    expect(screen.queryByTestId("invitation-join-i1")).toBeNull();
    expect(focused()).toBe("refusal-gone-note");
    await fireEvent.press(screen.getByTestId("invitation-join-i2"));
    await settle();
    expect(screen.getByText(viText("workspace.acceptInviteError.suspended"))).toBeOnTheScreen();
    expect(screen.getByText(viText("workspace.acceptInviteError.askInviterHint"))).toBeOnTheScreen();
    expect(screen.getByTestId("invitation-join-i2")).toBeOnTheScreen();
  });

  it("with none, names the address nobody invited and starts an organization on the web", async () => {
    api.mine.mockResolvedValueOnce([]);
    await render(<PendingInvitations email="an@acme.vn" />);
    expect(await screen.findByText(viText("mobile.invitations.none", { email: "an@acme.vn" }))).toBeOnTheScreen();
    expect(screen.getByText(viText("mobile.invitations.none_hint"))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("link", { name: viText("mobile.invitations.create_org") }));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://app.example/get-started");
  });

  it("tells an Apple relay account why an invitation to its work email misses it", async () => {
    api.mine.mockResolvedValueOnce([]);
    const email = "x1@privaterelay.appleid.com";
    await render(<PendingInvitations email={email} />);
    expect(await screen.findByText(viText("mobile.account.no_workspace_relay", { email }))).toBeOnTheScreen();
  });

  it("tells someone already in an organization to wait for an admin instead of starting one", async () => {
    api.mine.mockResolvedValueOnce([]);
    api.organizations.mockResolvedValueOnce([{ id: "o1", slug: "acme", name: "Acme", status: "active" }]);
    await render(<PendingInvitations email="an@acme.vn" />);
    expect(await screen.findByTestId("invitations-wait-for-admin")).toHaveTextContent(viText("mobile.account.no_workspace"));
    expect(screen.queryByTestId("invitations-create-org")).toBeNull();
  });

  it("says a list it could not read, with Retry, never that nobody invited the account", async () => {
    api.mine.mockResolvedValueOnce(null).mockResolvedValueOnce([invitation()]);
    await render(<PendingInvitations email="an@acme.vn" />);
    expect(await screen.findByText(viText("invitations.load_error"))).toBeOnTheScreen();
    expect(screen.queryByTestId("invitations-none")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: viText("common.retry") }));
    expect(await screen.findByTestId("invitation-join-i1")).toBeOnTheScreen();
  });
});
