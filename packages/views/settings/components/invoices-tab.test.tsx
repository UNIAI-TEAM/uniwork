import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../../test/api-mock";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { InvoicesTab } from "./invoices-tab";

initI18n();

const user: User = {
  id: "u1",
  email: "a@b.c",
  display_name: "An",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const workspace: Workspace = {
  id: "ws1",
  slug: "team",
  name: "Team",
  organization_id: "o1",
  organization_slug: "acme",
  organization_name: "Acme",
};

function mockApi(role: string) {
  requestMock.mockImplementation((path: string) => {
    if (path === "/api/v1/orgs") {
      return Promise.resolve({ organizations: [{ id: "o1", slug: "acme", name: "Acme", role }] });
    }
    if (path.endsWith("/billing/invoices")) return Promise.resolve({ invoices: [] });
    return Promise.resolve({});
  });
}

describe("InvoicesTab", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    setSessionUser(user);
    requestMock.mockReset();
  });

  it("shows forbidden for a plain member", async () => {
    mockApi("member");
    render(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={user}>
          <InvoicesTab />
        </WorkspaceProvider>,
      ),
    );
    expect(await screen.findByText("Bạn không xem được hóa đơn")).toBeTruthy();
  });

  it("lists empty state for owner", async () => {
    mockApi("owner");
    render(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={user}>
          <InvoicesTab />
        </WorkspaceProvider>,
      ),
    );
    expect(await screen.findByText("Chưa có hóa đơn")).toBeTruthy();
  });

  it("shows summary and invoice rows for owner", async () => {
    mockApi("owner");
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/orgs") {
        return Promise.resolve({ organizations: [{ id: "o1", slug: "acme", name: "Acme", role: "owner" }] });
      }
      if (path.includes("/billing/invoices")) {
        return Promise.resolve({
          invoices: [
            {
              id: "inv1",
              number: "UW-2026-TEST",
              status: "paid",
              provider: "vnpay",
              amount_paid: 499000,
              currency: "VND",
              period_start: "2026-10-06T00:00:00Z",
              period_end: "2026-11-06T00:00:00Z",
              paid_at: "2026-10-06T12:00:00Z",
            },
          ],
        });
      }
      return Promise.resolve({});
    });
    render(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={user}>
          <InvoicesTab />
        </WorkspaceProvider>,
      ),
    );
    expect(await screen.findByText("Số hóa đơn")).toBeInTheDocument();
    expect(screen.getByText("UW-2026-TEST")).toBeInTheDocument();
    expect(screen.getByLabelText("Danh sách hóa đơn đã thanh toán")).toBeInTheDocument();
    expect(screen.getByText("VNPay")).toBeInTheDocument();
  });
});
