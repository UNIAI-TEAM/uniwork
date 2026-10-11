import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
