import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { copyText } from "@uniwork/ui/lib/clipboard";
import { requestMock, wrapWithNav } from "../../test/api-mock";
import { ConnectedAppsTab } from "./connected-apps-tab";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@uniwork/ui/lib/clipboard", () => ({ copyText: vi.fn(async () => true) }));

const { t } = initI18n();
const g = (key: string, opts?: Record<string, unknown>) => t(`settings.connectedApps.guide.${key}`, opts);

const MCP_URL = "https://api.example.test/mcp";
const grant = (id: string, client_name: string) => ({
  id,
  organization_id: "o1",
  organization_name: "Acme",
  user_id: "u1",
  user_name: "Minh",
  client_id: `c-${id}`,
  client_name,
  verified: true,
  scope: "read write",
  created_at: "2026-10-16T08:00:00Z",
  last_used_at: null,
});

let grants: unknown[] = [];

beforeEach(() => {
  grants = [];
  requestMock.mockReset();
  requestMock.mockImplementation((path: string) =>
    Promise.resolve(path === "/api/v1/me/connected-apps" ? { grants, mcp_url: MCP_URL } : {}),
  );
  vi.mocked(copyText).mockReset();
  vi.mocked(copyText).mockResolvedValue(true);
  resetAuthStoreForTests();
});

async function openGuide() {
  render(wrapWithNav(<ConnectedAppsTab />));
  fireEvent.click(await screen.findByRole("button", { name: g("open") }));
  return screen.findByRole("dialog");
}

const next = (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole("button", { name: g("next") }));

describe("ConnectAssistantDialog", () => {
  it("walks a Claude user from choosing the assistant to the allow page", async () => {
    const dialog = await openGuide();
    expect(within(dialog).getByText(g("step", { n: 1, total: 5 }))).toBeInTheDocument();
    // Choosing acts on its own: no Continue to press on the first step.
    expect(within(dialog).queryByRole("button", { name: g("next") })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: new RegExp(g("claude")) }));

    expect(within(dialog).getByText(g("copyTitle"))).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: t("settings.connectedApps.copy") }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith(MCP_URL));

    next(dialog);
    expect(within(dialog).getByText(g("openTitle", { client: "Claude" }))).toBeInTheDocument();
    expect(within(dialog).getByRole("img", { name: g("artOpenClaude") })).toBeInTheDocument();
    const link = within(dialog).getByRole("link", { name: g("openButton", { client: "Claude" }) });
    expect(link).toHaveAttribute("href", "https://claude.ai/customize/connectors");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");

    next(dialog);
    expect(within(dialog).getByText(g("addClaude"))).toBeInTheDocument();
    expect(within(dialog).getByRole("img", { name: g("artAddClaude") })).toBeInTheDocument();

    next(dialog);
    expect(within(dialog).getByText(g("step", { n: 5, total: 5 }))).toBeInTheDocument();
    expect(within(dialog).getByRole("img", { name: g("artAllow") })).toBeInTheDocument();
    expect(within(dialog).getByText(g("waiting", { client: "Claude" }))).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: g("back") }));
    expect(within(dialog).getByText(g("addClaude"))).toBeInTheDocument();
  });

  it("walks a ChatGPT user through the Plugins page", async () => {
    const dialog = await openGuide();
    fireEvent.click(within(dialog).getByRole("button", { name: new RegExp(g("chatgpt")) }));
    expect(within(dialog).getByText(g("copyTitle"))).toBeInTheDocument();

    next(dialog);
    expect(within(dialog).getByText(g("openChatgpt"))).toBeInTheDocument();
    expect(within(dialog).getByRole("img", { name: g("artOpenChatgpt") })).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: g("openButton", { client: "ChatGPT" }) })).toHaveAttribute(
      "href",
      "https://chatgpt.com/plugins",
    );

    next(dialog);
    expect(within(dialog).getByText(g("addChatgpt"))).toBeInTheDocument();
    expect(within(dialog).getByRole("img", { name: g("artAddChatgpt") })).toBeInTheDocument();
  });

  it("moves to the last step when a new connection appears, not for one that was already there", async () => {
    grants = [grant("g1", "Claude")];
    const dialog = await openGuide();
    fireEvent.click(within(dialog).getByRole("button", { name: new RegExp(g("claude")) }));
    next(dialog);
    next(dialog);
    next(dialog);
    expect(within(dialog).getByText(g("waiting", { client: "Claude" }))).toBeInTheDocument();

    grants = [grant("g1", "Claude"), grant("g2", "Claude Desktop")];
    fireEvent.click(within(dialog).getByRole("button", { name: g("check") }));
    expect(await within(dialog).findByText(g("doneTitle", { client: "Claude Desktop" }))).toBeInTheDocument();
    expect(within(dialog).getByText(g("tryIt", { client: "Claude Desktop" }))).toBeInTheDocument();
    expect(within(dialog).getByText(g("useClaude"))).toBeInTheDocument();
    expect(within(dialog).getByText(g("mobileClaude"))).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: g("done") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("says no new connection was found when the check comes back empty", async () => {
    const dialog = await openGuide();
    fireEvent.click(within(dialog).getByRole("button", { name: new RegExp(g("chatgpt")) }));
    next(dialog);
    next(dialog);
    next(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: g("check") }));
    expect(await within(dialog).findByText(g("notYet", { client: "ChatGPT" }))).toBeInTheDocument();
    expect(within(dialog).queryByText(g("doneTitle", { client: "ChatGPT" }))).toBeNull();
  });

  it("starts over on the first step when it is opened again", async () => {
    const dialog = await openGuide();
    fireEvent.click(within(dialog).getByRole("button", { name: new RegExp(g("claude")) }));
    next(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: g("later") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: g("open") }));
    const again = await screen.findByRole("dialog");
    expect(within(again).getByText(g("chooseTitle"))).toBeInTheDocument();
  });
});
