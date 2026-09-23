import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../../test/api-mock";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { IntegrationsTab } from "./integrations-tab";

initI18n();

const user: User = {
  id: "u1", email: "a@b.c", display_name: "An", onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};

const workspace: Workspace = {
  id: "ws1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "acme", organization_name: "Acme",
};

function renderTab(accounts: unknown[]) {
  requestMock.mockImplementation((path: string) =>
    path === "/api/v1/workspaces/ws1/email-hub/accounts" ? Promise.resolve({ accounts }) : Promise.resolve({}),
  );
  return render(wrapWithNav(<WorkspaceProvider workspace={workspace} user={user}><IntegrationsTab /></WorkspaceProvider>));
}

beforeEach(() => requestMock.mockReset());

describe("IntegrationsTab", () => {
  it("lists Email Hub as the real connection, linked to the Email screen", async () => {
    renderTab([]);
    const available = screen.getByRole("list", { name: "Dùng được" });
    expect(within(available).getByText("Email Hub")).toBeInTheDocument();
    expect(await within(available).findByText("Bạn chưa kết nối")).toBeInTheDocument();
    expect(within(available).getByRole("link", { name: "Kết nối hộp thư" })).toHaveAttribute("href", "/acme/team/email");
  });

  it("counts the reader's own connected mailboxes", async () => {
    renderTab([{ id: "a1", email_address: "an@gmail.com", provider: "gmail", connected_at: "2026-09-01T00:00:00Z" }]);
    expect(await screen.findByText("Bạn đã kết nối 1 hộp thư")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mở Email Hub" })).toBeInTheDocument();
  });

  it("shows only documented plans, locked, and prints the description once", () => {
    renderTab([]);
    const planned = screen.getByRole("list", { name: "Trong lộ trình" });
    expect(within(planned).getAllByText("Sắp có")).toHaveLength(2);
    expect(within(planned).getByText("Gmail và Microsoft 365")).toBeInTheDocument();
    expect(within(planned).getByText("Webhook")).toBeInTheDocument();
    expect(within(planned).queryByRole("link")).toBeNull();
    expect(within(planned).queryByRole("button")).toBeNull();
    expect(screen.queryByText(/Slack/i)).toBeNull();
    expect(screen.getAllByText(/Nối UniWork với công cụ bạn đang dùng/)).toHaveLength(1);
  });
});
