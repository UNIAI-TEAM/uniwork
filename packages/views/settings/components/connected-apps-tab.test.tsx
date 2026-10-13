import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { copyText } from "@uniwork/ui/lib/clipboard";
import { requestMock, wrapWithNav } from "../../test/api-mock";
import { ConnectedAppsTab } from "./connected-apps-tab";

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock("@uniwork/ui/lib/clipboard", () => ({ copyText: vi.fn(async () => true) }));

const { t } = initI18n();

const MCP_URL = "https://api.example.test/mcp";
const grant = {
  id: "g1",
  organization_id: "o1",
  organization_name: "Acme",
  user_id: "u1",
  user_name: "Minh",
  client_id: "c1",
  client_name: "Claude",
  verified: true,
  scope: "read",
  created_at: "2026-10-12T08:00:00Z",
  last_used_at: null,
};

function serve(grants: unknown[], extra?: (path: string, init?: { method?: string }) => unknown) {
  requestMock.mockImplementation((path: string, init?: { method?: string }) => {
    const custom = extra?.(path, init);
    if (custom !== undefined) return custom;
    if (path === "/api/v1/me/connected-apps") return Promise.resolve({ grants, mcp_url: MCP_URL });
    return Promise.resolve({});
  });
}

beforeEach(() => {
  requestMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  vi.mocked(copyText).mockReset();
  vi.mocked(copyText).mockResolvedValue(true);
  resetAuthStoreForTests();
});

describe("ConnectedAppsTab", () => {
  it("shows the address to paste and revokes an app only after confirming", async () => {
    let grants = [grant];
    requestMock.mockImplementation((path: string, init?: { method?: string }) => {
      if (path === "/api/v1/me/connected-apps") return Promise.resolve({ grants, mcp_url: MCP_URL });
      if (path === "/api/v1/me/connected-apps/g1" && init?.method === "DELETE") {
        grants = [];
        return Promise.resolve({ status: "ok" });
      }
      return Promise.resolve({});
    });
    render(wrapWithNav(<ConnectedAppsTab />));
    expect(await screen.findByText(MCP_URL)).toBeInTheDocument();
    expect(screen.getByText("Claude")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Thu hồi Claude" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(requestMock).not.toHaveBeenCalledWith("/api/v1/me/connected-apps/g1", { method: "DELETE" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Thu hồi" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/me/connected-apps/g1", { method: "DELETE" }));
    expect(await screen.findByText(t("settings.connectedApps.empty"))).toBeInTheDocument();
    expect(toastSuccess).toHaveBeenCalledWith("Đã thu hồi Claude");
  });

  it("keeps the dialog open and says so when the revoke fails", async () => {
    serve([grant], (path, init) =>
      path === "/api/v1/me/connected-apps/g1" && init?.method === "DELETE" ? Promise.reject(new Error("boom")) : undefined,
    );
    render(wrapWithNav(<ConnectedAppsTab />));
    fireEvent.click(await screen.findByRole("button", { name: "Thu hồi Claude" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Thu hồi" }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("closes the dialog without a request when the reader cancels", async () => {
    serve([grant]);
    render(wrapWithNav(<ConnectedAppsTab />));
    fireEvent.click(await screen.findByRole("button", { name: "Thu hồi Claude" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.cancel") }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(requestMock).not.toHaveBeenCalledWith("/api/v1/me/connected-apps/g1", { method: "DELETE" });
  });

  it("badges a verified client and leaves an unverified one plain, with when each was last used", async () => {
    serve([
      grant,
      { ...grant, id: "g2", client_id: "c2", client_name: "Unknown app", verified: false, last_used_at: "2026-10-13T08:00:00Z" },
    ]);
    render(wrapWithNav(<ConnectedAppsTab />));
    const list = await screen.findByRole("list", { name: t("settings.connectedApps.section") });
    const [verifiedRow, plainRow] = within(list).getAllByRole("listitem");
    expect(within(verifiedRow!).getByText(t("settings.connectedApps.verified"))).toBeInTheDocument();
    expect(within(verifiedRow!).queryByText(/dùng lần cuối/)).not.toBeInTheDocument();
    expect(within(plainRow!).queryByText(t("settings.connectedApps.verified"))).not.toBeInTheDocument();
    expect(within(plainRow!).getByText(/Acme · kết nối .* · dùng lần cuối /)).toBeInTheDocument();
  });

  it("copies the address and confirms it for a screen reader", async () => {
    serve([]);
    render(wrapWithNav(<ConnectedAppsTab />));
    fireEvent.click(await screen.findByRole("button", { name: t("settings.connectedApps.copy") }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith(MCP_URL));
    expect(await screen.findByRole("status")).toHaveTextContent(t("settings.connectedApps.copied"));
    expect(toastError).not.toHaveBeenCalled();
  });

  it("says so when the address could not be copied", async () => {
    vi.mocked(copyText).mockResolvedValue(false);
    serve([]);
    render(wrapWithNav(<ConnectedAppsTab />));
    fireEvent.click(await screen.findByRole("button", { name: t("settings.connectedApps.copy") }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(t("settings.workspace.copy_failed")));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("shows the connect panel above the empty list that points at it", async () => {
    serve([]);
    render(wrapWithNav(<ConnectedAppsTab />));
    const address = await screen.findByText(MCP_URL);
    const empty = screen.getByText(t("settings.connectedApps.empty"));
    expect(address.compareDocumentPosition(empty) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows a retry when the list fails", async () => {
    requestMock.mockRejectedValue(new Error("down"));
    render(wrapWithNav(<ConnectedAppsTab />));
    expect(await screen.findByText(t("settings.connectedApps.error"))).toBeInTheDocument();
    requestMock.mockReset();
    serve([grant]);
    fireEvent.click(screen.getByRole("button", { name: t("settings.state.retry") }));
    expect(await screen.findByText("Claude")).toBeInTheDocument();
  });
});
