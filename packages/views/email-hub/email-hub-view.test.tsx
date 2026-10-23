import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import type { User, Workspace } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { WorkspaceProvider } from "../layout/workspace-context";
import { EmailHubView } from "./email-hub-view";

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: (...a: unknown[]) => toastError(...a), success: vi.fn() }),
}));

const user: User = {
  id: "u1", email: "a@b.c", display_name: "An", onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};
const workspace: Workspace = {
  id: "ws1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "acme", organization_name: "Acme",
};
const unreadRow = {
  id: "t1", account_id: "acc1", folder: "INBOX", subject: "Báo giá", snippet: "", from_addr: "minh@example.com",
  to_addrs: [], sent_at: "2026-09-24T09:00:00Z", is_read: false, is_starred: false, has_attachments: false,
  body_cached: true, imap_labels: [],
};

function account(needsReconnect: boolean) {
  return {
    id: "acc1", email_address: "ha.do@unicomhub.com", provider: "gmail", connected_at: "2026-09-01T00:00:00Z",
    auth_kind: "password", needs_reconnect: needsReconnect, auth_failed_reason: needsReconnect ? "imap_auth_failed" : "",
  };
}

const isPatch = ([path, init]: unknown[]) =>
  path === "/api/v1/workspaces/ws1/email-hub/threads/t1" && (init as { method?: string } | undefined)?.method === "PATCH";
const isAccounts = ([path]: unknown[]) => path === "/api/v1/workspaces/ws1/email-hub/accounts";

function renderView(needsReconnect: boolean) {
  requestMock.mockImplementation((path: string, init?: { method?: string }) => {
    if (path === "/api/v1/workspaces/ws1/email-hub/accounts") return Promise.resolve({ accounts: [account(needsReconnect)] });
    if (path.startsWith("/api/v1/workspaces/ws1/email-hub/threads?")) {
      return Promise.resolve({ threads: [unreadRow], counts: { total: 1, unread: 1 } });
    }
    if (init?.method === "PATCH") {
      return Promise.reject(new ApiError("Email Hub account needs to be reconnected", "email_hub_reauth_required", 409));
    }
    return Promise.resolve({});
  });
  render(wrapWithNav(<WorkspaceProvider workspace={workspace} user={user}><EmailHubView /></WorkspaceProvider>));
}

const accountsPath = "/api/v1/workspaces/ws1/email-hub/accounts";

function accountIdFromPath(path: string) {
  return new URL(path, "http://uniwork.test").searchParams.get("account_id");
}

function installDisconnectTransport(onlyAccountB: boolean, accountsRefetchFails = false) {
  const accountA = { ...account(false), id: "acc-a", email_address: "a@unicomhub.com" };
  const accountB = { ...account(false), id: "acc-b", email_address: "b@unicomhub.com" };
  let currentAccounts = onlyAccountB ? [accountB] : [accountA, accountB];
  const disconnectedIds = new Set<string>();
  const staleRequests: string[] = [];
  let finishAccountsRefetch: (() => void) | null = null;

  requestMock.mockImplementation((path: string, init?: { method?: string }) => {
    const method = init?.method ?? "GET";
    if (path === accountsPath) {
      if (disconnectedIds.size === 0) return Promise.resolve({ accounts: currentAccounts });
      return new Promise((resolve, reject) => {
        finishAccountsRefetch = () => {
          if (accountsRefetchFails) reject(new Error("accounts refetch failed"));
          else resolve({ accounts: currentAccounts });
        };
      });
    }
    if (path.startsWith(`${accountsPath}/`) && method === "DELETE") {
      const id = path.slice(accountsPath.length + 1);
      currentAccounts = currentAccounts.filter((item) => item.id !== id);
      disconnectedIds.add(id);
      return Promise.resolve({});
    }
    const isWatchCleanup = path.startsWith("/api/v1/workspaces/ws1/email-hub/inbox-watch?") && method === "DELETE";
    const requestedAccountId = accountIdFromPath(path);
    if (requestedAccountId && disconnectedIds.has(requestedAccountId) && !isWatchCleanup) {
      staleRequests.push(`${method} ${path}`);
    }
    if (path.startsWith("/api/v1/workspaces/ws1/email-hub/threads?")) {
      return Promise.resolve({ threads: [], counts: { total: 0, unread: 0 }, next_cursor: "" });
    }
    return Promise.resolve({});
  });

  render(wrapWithNav(<WorkspaceProvider workspace={workspace} user={user}><EmailHubView /></WorkspaceProvider>));
  return {
    staleRequests,
    finishAccountsRefetch: () => {
      if (!finishAccountsRefetch) throw new Error("accounts refetch has not started");
      finishAccountsRefetch();
    },
  };
}

async function disconnectActiveMailbox(email: string) {
  const [trigger] = await screen.findAllByRole("button", { name: `Hộp thư: ${email}` });
  fireEvent.click(trigger!);
  fireEvent.click(await screen.findByRole("menuitem", { name: `Ngắt kết nối ${email}` }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Ngắt kết nối" }));
}

beforeEach(() => {
  requestMock.mockReset();
  toastError.mockClear();
});

describe("EmailHubView on a mailbox that needs reconnecting", () => {
  it("opens an unread email without a read PATCH the server would refuse", async () => {
    renderView(true);
    fireEvent.click(await screen.findByRole("button", { name: /Báo giá/ }));
    await waitFor(() =>
      expect(requestMock.mock.calls.some(([path]) => String(path).startsWith("/api/v1/workspaces/ws1/email-hub/threads/t1?"))).toBe(true),
    );
    expect(requestMock.mock.calls.some(isPatch)).toBe(false);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("words a refused action in Vietnamese and refetches the accounts so the reconnect banner can appear", async () => {
    renderView(false);
    fireEvent.click(await screen.findByRole("button", { name: /Báo giá/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Hộp thư này cần kết nối lại. Kết nối lại hộp thư rồi thử lại."));
    expect(requestMock.mock.calls.some(isPatch)).toBe(true);
    await waitFor(() => expect(requestMock.mock.calls.filter(isAccounts).length).toBeGreaterThan(1));
  });
});

describe("EmailHubView reconnecting from the banner", () => {
  it.each([
    ["on the account menu", true, "Hộp thư: ha.do@unicomhub.com"],
    ["on the list heading when no account menu is on screen", false, "Hộp đến"],
  ])("puts focus %s once the banner it started from is gone", async (_, triggerShown, focusName) => {
    // jsdom lays nothing out; give the account menu triggers a box when the case has one on screen.
    const rects = Element.prototype.getClientRects;
    vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (this: Element) {
      return triggerShown && this.hasAttribute("data-email-hub-account-trigger")
        ? ([{}] as unknown as DOMRectList)
        : rects.call(this);
    });
    let broken = true;
    requestMock.mockImplementation((path: string, init?: { method?: string }) => {
      if (path === "/api/v1/workspaces/ws1/email-hub/accounts") {
        if (init?.method === "POST") {
          broken = false;
          return Promise.resolve(account(false));
        }
        return Promise.resolve({ accounts: [account(broken)] });
      }
      if (path.startsWith("/api/v1/workspaces/ws1/email-hub/threads?")) {
        return Promise.resolve({ threads: [unreadRow], counts: { total: 1, unread: 1 } });
      }
      return Promise.resolve({});
    });
    render(wrapWithNav(<WorkspaceProvider workspace={workspace} user={user}><EmailHubView /></WorkspaceProvider>));

    const banner = (await screen.findByText("Hộp thư cần kết nối lại")).closest<HTMLElement>("[data-slot=alert]")!;
    fireEvent.click(within(banner).getByRole("button", { name: "Kết nối lại" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("App Password"), { target: { value: "abcd efgh ijkl mnop" } });
    const submit = within(dialog).getByRole("button", { name: "Kết nối lại" });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() => expect(screen.queryByText("Hộp thư cần kết nối lại")).toBeNull());
    await waitFor(() => expect(document.activeElement).toHaveAccessibleName(focusName));
    vi.restoreAllMocks();
  });
});

describe("EmailHubView after disconnecting the active mailbox", () => {
  it("selects the newest remaining mailbox and sends the next list request with its id", async () => {
    const { finishAccountsRefetch, staleRequests } = installDisconnectTransport(false);

    await screen.findAllByRole("button", { name: "Hộp thư: b@unicomhub.com" });
    await waitFor(() =>
      expect(
        requestMock.mock.calls.some(
          ([path]) => String(path).startsWith("/api/v1/workspaces/ws1/email-hub/threads?") && accountIdFromPath(String(path)) === "acc-b",
        ),
      ).toBe(true),
    );
    await disconnectActiveMailbox("b@unicomhub.com");
    await waitFor(() => expect(requestMock.mock.calls.filter(isAccounts)).toHaveLength(2));
    await act(async () => Promise.resolve());
    finishAccountsRefetch();

    await screen.findAllByRole("button", { name: "Hộp thư: a@unicomhub.com" });
    await waitFor(() =>
      expect(
        requestMock.mock.calls.some(
          ([path]) => String(path).startsWith("/api/v1/workspaces/ws1/email-hub/threads?") && accountIdFromPath(String(path)) === "acc-a",
        ),
      ).toBe(true),
    );
    expect(staleRequests).toEqual([]);
  });

  it("shows connect after disconnecting the only mailbox without reusing its id", async () => {
    const { finishAccountsRefetch, staleRequests } = installDisconnectTransport(true);

    await screen.findAllByRole("button", { name: "Hộp thư: b@unicomhub.com" });
    await disconnectActiveMailbox("b@unicomhub.com");
    await waitFor(() => expect(requestMock.mock.calls.filter(isAccounts)).toHaveLength(2));
    await act(async () => Promise.resolve());
    await act(async () => {
      finishAccountsRefetch();
      await Promise.resolve();
    });

    await screen.findByRole("heading", { name: "Kết nối hộp thư để bắt đầu" });
    expect(staleRequests).toEqual([]);
  });

  it("keeps multiple disconnected mailboxes inactive when each accounts refetch fails", async () => {
    const { finishAccountsRefetch, staleRequests } = installDisconnectTransport(false, true);

    await screen.findAllByRole("button", { name: "Hộp thư: b@unicomhub.com" });
    await disconnectActiveMailbox("b@unicomhub.com");
    await waitFor(() => expect(requestMock.mock.calls.filter(isAccounts)).toHaveLength(2));
    await act(async () => Promise.resolve());
    await act(async () => {
      finishAccountsRefetch();
      await Promise.resolve();
    });
    await screen.findAllByRole("button", { name: "Hộp thư: a@unicomhub.com" });
    expect(staleRequests).toEqual([]);

    await disconnectActiveMailbox("a@unicomhub.com");
    await waitFor(() => expect(requestMock.mock.calls.filter(isAccounts)).toHaveLength(3));
    await act(async () => Promise.resolve());
    await act(async () => {
      finishAccountsRefetch();
      await Promise.resolve();
    });

    await screen.findByRole("heading", { name: "Kết nối hộp thư để bắt đầu" });
    expect(staleRequests).toEqual([]);
  });
});
