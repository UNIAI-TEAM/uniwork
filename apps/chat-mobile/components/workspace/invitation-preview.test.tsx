// The preview an invite link opens (invitation-preview.tsx, spec §5.2): what the invitation is to, joined only on
// "Tham gia"; the switch on the web; an invitation that no longer works; and each refusal with its way out.
import { act, fireEvent, screen } from "@testing-library/react-native";
import { configureRuntime, resetRuntimeConfig } from "@uniwork/core/runtime-config";
import type { InvitationPreview as Preview } from "@uniwork/core/types/workspace";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { AccessibilityInfo } from "react-native";
import { useAuthStore } from "@/data/auth/store";
import { invitationsApi } from "@/data/invitations/api";
import { render, viText } from "@/test/render";
import { InvitationPreview } from "./invitation-preview";

jest.mock("@/data/invitations/api", () => ({
  invitationsApi: { mine: jest.fn(), preview: jest.fn(), accept: jest.fn(), organizations: jest.fn() },
}));
jest.mock("@/data/api", () => ({ api: { listWorkspaces: jest.fn(async () => []), request: jest.fn() } }));
jest.mock("@/data/auth/store", () => {
  const { create } = jest.requireActual<typeof import("zustand")>("zustand");
  return { useAuthStore: create(() => ({ user: null as unknown, logout: jest.fn(async () => {}) })) };
});
jest.mock("@react-native-community/netinfo", () => {
  const netInfo = { configure: () => undefined, addEventListener: () => () => undefined, fetch: async () => ({ isConnected: true, isInternetReachable: true }) };
  return { __esModule: true, default: netInfo, ...netInfo, useNetInfo: () => ({ isConnected: true }) };
});
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "dismiss" })) }));

const api = jest.mocked(invitationsApi);
const DAY = 24 * 60 * 60 * 1000;
const preview = (over: Partial<Preview["invitation"]> = {}, conflicts: Preview["conflicts"] = []): Preview => ({
  invitation: {
    id: "i1",
    status: "pending",
    expires_at: new Date(Date.now() + 3 * DAY).toISOString(),
    organization: { id: "o1", slug: "acme", name: "Acme" },
    workspaces: [{ id: "w1", slug: "hq", name: "HQ" }],
    org_role: "admin",
    inviter_name: "Bình",
    ...over,
  },
  conflicts,
});
const refusal = (code: string, status: number) => Object.assign(new Error(code), { status, body: { error: { code } } });
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

beforeEach(() => {
  configureRuntime({ appUrl: "https://app.example" });
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
});
afterEach(() => {
  resetRuntimeConfig();
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

describe("InvitationPreview", () => {
  it("shows what the invitation is to, its outline first, and joins nothing until asked", async () => {
    let answer: (p: Preview) => void = () => undefined;
    api.preview.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    await render(<InvitationPreview token="t1" />);
    expect(screen.getByTestId("invitation-loading")).toBeOnTheScreen();
    await act(async () => answer(preview()));
    expect(await screen.findByRole("header", { name: viText("invitations.preview.title", { name: "Acme" }) })).toBeOnTheScreen();
    expect(screen.getByText(viText("invitations.preview.description_inviter", { inviter: "Bình" }))).toBeOnTheScreen();
    const rows: [string, string][] = [
      ["invitations.preview.organization", "Acme"],
      ["invitations.preview.workspace", "HQ"],
      ["invitations.preview.role", viText("people.role_admin")],
      ["invitations.preview.inviter", "Bình"],
      ["invitations.preview.expiry", viText("invitations.preview.expires_in", { count: 3 })],
    ];
    for (const [label, value] of rows) {
      expect(screen.getByLabelText(`${viText(label)}: ${value}`)).toBeOnTheScreen();
    }
    expect(api.accept).not.toHaveBeenCalled();
  });

  it("says an organization-level invitation opens no workspace yet, and names no inviter it does not know", async () => {
    api.preview.mockResolvedValueOnce(preview({ workspaces: [], inviter_name: undefined, org_role: "guest" }));
    await render(<InvitationPreview token="t1" />);
    expect(await screen.findByLabelText(`${viText("invitations.preview.workspace")}: ${viText("invitations.preview.no_workspace")}`)).toBeOnTheScreen();
    expect(screen.getByText(viText("invitations.preview.description"))).toBeOnTheScreen();
    expect(screen.getByLabelText(`${viText("invitations.preview.role")}: guest`)).toBeOnTheScreen();
  });

  it("joins on Tham gia and opens the workspace it grants", async () => {
    api.preview.mockResolvedValue(preview());
    const workspace = { id: "w1", slug: "hq", name: "HQ", organization_id: "o1", organization_slug: "acme", organization_name: "Acme" };
    api.accept.mockResolvedValueOnce({ organization: { id: "o1", slug: "acme", name: "Acme" }, workspace });
    await render(<InvitationPreview token="t1" />);
    await fireEvent.press(await screen.findByTestId("invitation-preview-join"));
    await settle();
    expect(api.accept).toHaveBeenCalledWith("t1");
    expect(router.replace).toHaveBeenCalledWith("/acme/hq/chat");
  });

  it("says the organization joined with nowhere to land yet, focused on going on", async () => {
    api.preview.mockResolvedValueOnce(preview({ workspaces: [] })).mockResolvedValue(preview({ status: "accepted" }));
    api.accept.mockResolvedValueOnce({ organization: { id: "o1", slug: "acme", name: "Acme" }, workspace: null });
    await render(<InvitationPreview token="t1" />);
    await fireEvent.press(await screen.findByTestId("invitation-preview-join"));
    await settle();
    expect(screen.getByText(viText("mobile.invitations.joined_no_workspace", { org: "Acme" }))).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("invitation-joined-continue"));
    expect(router.replace).toHaveBeenCalledWith("/");
  });

  it("leaves without joining on Để sau", async () => {
    api.preview.mockResolvedValueOnce(preview());
    await render(<InvitationPreview token="t1" />);
    await fireEvent.press(await screen.findByTestId("invitation-preview-later"));
    expect(router.replace).toHaveBeenCalledWith("/");
    expect(api.accept).not.toHaveBeenCalled();
  });

  it("sends an account in another organization to the web's switch, before and after a join", async () => {
    const conflict = { organization: { id: "o9", slug: "old", name: "Old" }, role: "owner", required_action: "transfer", transfer_candidates_count: 2 };
    api.preview.mockResolvedValueOnce(preview({}, [conflict]));
    await render(<InvitationPreview token="t1" />);
    expect(await screen.findByText(viText("invitations.switch.description", { name: "Acme" }))).toBeOnTheScreen();
    expect(screen.queryByTestId("invitation-preview-join")).toBeNull();
    await fireEvent.press(screen.getByRole("link", { name: viText("mobile.invitations.continue_on_web") }));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://app.example/invitations");
  });

  it("turns to the switch when the join finds another organization in the way", async () => {
    api.preview.mockResolvedValueOnce(preview());
    api.accept.mockRejectedValueOnce(refusal("organization_switch_required", 409));
    await render(<InvitationPreview token="t1" />);
    await fireEvent.press(await screen.findByTestId("invitation-preview-join"));
    await settle();
    expect(screen.getByTestId("invitation-continue-on-web")).toBeOnTheScreen();
  });

  it("says a refused join under the button, which stays", async () => {
    api.preview.mockResolvedValueOnce(preview());
    api.accept.mockRejectedValueOnce(refusal("membership_busy", 409));
    await render(<InvitationPreview token="t1" />);
    await fireEvent.press(await screen.findByTestId("invitation-preview-join"));
    await settle();
    expect(screen.getByText(viText("invitations.switch.busy"))).toBeOnTheScreen();
    expect(screen.getByTestId("invitation-preview-join")).toBeOnTheScreen();
  });

  it.each([
    ["the invitation's own state", () => api.preview.mockResolvedValueOnce(preview({ status: "accepted" }))],
    ["a join that found it used", () => {
      api.preview.mockResolvedValueOnce(preview());
      api.accept.mockRejectedValueOnce(refusal("invitation_accepted", 410));
    }],
  ])("says an invitation that no longer works from %s, with the way home", async (_, arrange) => {
    arrange();
    await render(<InvitationPreview token="t1" />);
    const join = await screen.findByTestId(/invitation-(preview-join|gone)/);
    if (join.props.testID === "invitation-preview-join") {
      await fireEvent.press(join);
      await settle();
    }
    expect(screen.getByText(viText("invitations.gone.accepted"))).toBeOnTheScreen();
    expect(screen.getByText(viText("invitations.gone.hint_accepted"))).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("invitation-home"));
    expect(router.replace).toHaveBeenCalledWith("/");
  });

  it("says an expired invitation the link names by its 410", async () => {
    api.preview.mockRejectedValueOnce(refusal("invitation_expired", 410));
    await render(<InvitationPreview token="t1" />);
    expect(await screen.findByText(viText("invitations.gone.expired"))).toBeOnTheScreen();
  });

  it("offers another account for a link sent to another address", async () => {
    api.preview.mockRejectedValueOnce(refusal("invitation_email_mismatch", 403));
    await render(<InvitationPreview token="t1" />);
    expect(await screen.findByText(viText("workspace.acceptInviteError.wrongAccount"))).toBeOnTheScreen();
    expect(screen.getByText(viText("workspace.acceptInviteError.wrongAccountHint"))).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("invitation-switch-account"));
    expect(useAuthStore.getState().logout).toHaveBeenCalled();
  });

  it("sends an address not proved yet to its code", async () => {
    api.preview.mockRejectedValueOnce(refusal("email_unverified", 403));
    await render(<InvitationPreview token="t1" />);
    await fireEvent.press(await screen.findByRole("button", { name: viText("workspace.acceptInviteError.verifyEmail") }));
    expect(router.replace).toHaveBeenCalledWith("/verify-email");
  });

  it("offers Retry after a blip and a drifted answer, and nothing but home after a verdict", async () => {
    api.preview.mockRejectedValueOnce(refusal("internal", 500)).mockResolvedValueOnce(null).mockResolvedValueOnce(preview());
    await render(<InvitationPreview token="t1" />);
    await fireEvent.press(await screen.findByTestId("invitation-retry"));
    expect(await screen.findByTestId("invitation-refused-failed")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("invitation-retry"));
    expect(await screen.findByTestId("invitation-preview")).toBeOnTheScreen();
  });

  it("names a suspended organization with nothing to retry", async () => {
    api.preview.mockRejectedValueOnce(refusal("organization_suspended", 403));
    await render(<InvitationPreview token="t1" />);
    expect(await screen.findByTestId("invitation-refused-suspended")).toBeOnTheScreen();
    expect(screen.queryByTestId("invitation-retry")).toBeNull();
  });
});
