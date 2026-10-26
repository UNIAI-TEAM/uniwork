// The workspace switch: every workspace of the organization with what it holds
// unread, a check on the open one, and a tap that makes another current and
// lands on its chat tab.
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import { Platform } from "react-native";
import { useWorkspaceStore } from "@/data/stores/workspace-store";
import { render, viText } from "@/test/render";
import { WorkspaceSwitchSheet } from "./workspace-switch-sheet";

jest.mock("expo-router", () => ({ router: { replace: jest.fn() } }));
jest.mock("@/data/queries/workspaces", () => ({
  workspaceListOptions: () => ({
    queryKey: ["workspaces"],
    queryFn: async () => [
      { id: "w1", name: "Kỹ thuật", slug: "ky-thuat", organization_slug: "acme", organization_name: "Acme" },
      { id: "w2", name: "Kinh doanh", slug: "kinh-doanh", organization_slug: "acme", organization_name: "Acme" },
      { id: "w3", name: "Nhân sự", slug: "nhan-su", organization_slug: "acme", organization_name: "Acme" },
    ],
  }),
}));
jest.mock("@/data/queries/chat", () => ({
  unreadSummaryOptions: () => ({
    queryKey: ["chat-unread-summary"],
    queryFn: async () => ({
      direct: { unread: 0, mentions: 0 },
      workspaces: [
        { workspace_id: "w2", unread: 120, mentions: 2 },
        { workspace_id: "w3", unread: 3, mentions: 0 },
      ],
    }),
  }),
}));

beforeEach(() => jest.replaceProperty(Platform, "OS", "android"));
afterEach(() => jest.restoreAllMocks());

describe("WorkspaceSwitchSheet", () => {
  it("lists every workspace with its unread line, the open one checked", async () => {
    await render(<WorkspaceSwitchSheet visible onClose={jest.fn()} currentWsId="w1" />);
    expect(await screen.findByText(viText("chat.mobile.workspace_count", { org: "Acme", count: 3 }))).toBeOnTheScreen();
    const open = screen.getByRole("button", { name: `Kỹ thuật, ${viText("chat.mobile.workspace_open", { count: 0 })}` });
    expect(open.props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    await waitFor(() => expect(screen.getByText("99+")).toBeOnTheScreen());
    expect(screen.getByText(viText("chat.mobile.workspace_unread_mentions", { count: 120 }))).toBeOnTheScreen();
    expect(screen.getByText(viText("chat.mobile.workspace_unread", { count: 3 }))).toBeOnTheScreen();
  });

  it("makes another workspace current and opens its chat tab; the open one does nothing", async () => {
    const setCurrent = jest.fn(async () => undefined);
    useWorkspaceStore.setState({ setCurrent });
    const onClose = jest.fn();
    await render(<WorkspaceSwitchSheet visible onClose={onClose} currentWsId="w1" />);
    await fireEvent.press(await screen.findByRole("button", { name: new RegExp("^Kỹ thuật") }));
    expect(setCurrent).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: new RegExp("^Nhân sự") }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(setCurrent).toHaveBeenCalledWith({ orgSlug: "acme", wsSlug: "nhan-su", wsId: "w3" });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/acme/nhan-su/chat"));
  });
});
