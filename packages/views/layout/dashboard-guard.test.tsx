import { render, screen, waitFor } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import type { NavigationAdapter } from "../navigation";
import { DashboardGuard } from "./dashboard-guard";

initI18n();

const user: User = {
  id: "u1", email: "a@b.c", display_name: "A",
  onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};

function nav(): NavigationAdapter {
  return { push: vi.fn(), replace: vi.fn(), back: vi.fn(), pathname: "/acme/team/tasks", searchParams: new URLSearchParams(), getShareableUrl: (p) => p };
}

beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser(user);
  requestMock.mockReset();
});

describe("DashboardGuard when the organization is suspended", () => {
  it("shows the notice instead of redirecting to the picker", async () => {
    requestMock.mockRejectedValue(new ApiError("suspended", "organization_suspended", 403));
    const adapter = nav();
    render(
      wrapWithNav(
        <DashboardGuard orgSlug="acme" wsSlug="team">
          {() => <p>workspace body</p>}
        </DashboardGuard>,
        adapter,
      ),
    );
    // A page heading, not an alert: on a page load the heading is the
    // announcement, as on every other entry screen.
    expect(await screen.findByRole("heading", { level: 1, name: "Tổ chức đang tạm ngưng" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // A suspended organization still holds its members (ADR 0032 D1), so the
    // way out offers joining another, not founding one.
    expect(screen.getByRole("link", { name: "Tham gia tổ chức khác" })).toHaveAttribute(
      "href",
      "/get-started",
    );
    expect(screen.queryByText("workspace body")).not.toBeInTheDocument();
    expect(adapter.replace).not.toHaveBeenCalled();
  });
});

describe("DashboardGuard when the organization was closed", () => {
  // A closed organization is archived (ADR 0032 D4): its routes answer like a
  // suspended one, but GET /orgs no longer lists it, so the notice would be
  // about an organization the person no longer belongs to.
  it("sends a person whose organization is gone to /get-started instead of the suspended notice", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/orgs") return Promise.resolve({ organizations: [] });
      if (path === "/api/v1/workspaces") {
        return Promise.resolve({
          workspaces: [
            {
              id: "w1",
              slug: "team",
              name: "Team",
              organization_id: "o1",
              organization_slug: "acme",
              organization_name: "Acme",
            },
          ],
        });
      }
      return Promise.reject(new ApiError("suspended", "organization_suspended", 403));
    });
    const adapter = nav();
    render(
      wrapWithNav(
        <DashboardGuard orgSlug="acme" wsSlug="team">
          {() => <p>workspace body</p>}
        </DashboardGuard>,
        adapter,
      ),
    );
    await waitFor(() => expect(adapter.replace).toHaveBeenCalledWith("/get-started"));
    expect(screen.queryByText("Tổ chức đang tạm ngưng")).not.toBeInTheDocument();
    expect(screen.queryByText("workspace body")).not.toBeInTheDocument();
  });

  /** A closed organization answers like a suspended one: say nothing until the list tells them apart. */
  it("announces no suspension while the organization list is still loading", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/orgs") return new Promise(() => {});
      if (path === "/api/v1/workspaces") return Promise.resolve({ workspaces: [] });
      return Promise.reject(new ApiError("suspended", "organization_suspended", 403));
    });
    render(
      wrapWithNav(
        <DashboardGuard orgSlug="acme" wsSlug="team">
          {() => <p>workspace body</p>}
        </DashboardGuard>,
        nav(),
      ),
    );
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/orgs"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Tổ chức đang tạm ngưng")).not.toBeInTheDocument();
  });

  it("keeps the suspended notice while the organization is still listed", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/orgs") {
        return Promise.resolve({ organizations: [{ id: "o1", slug: "acme", name: "Acme", status: "suspended" }] });
      }
      if (path === "/api/v1/workspaces") return Promise.resolve({ workspaces: [] });
      return Promise.reject(new ApiError("suspended", "organization_suspended", 403));
    });
    const adapter = nav();
    render(
      wrapWithNav(
        <DashboardGuard orgSlug="acme" wsSlug="team">
          {() => <p>workspace body</p>}
        </DashboardGuard>,
        adapter,
      ),
    );
    expect(await screen.findByRole("heading", { level: 1, name: "Tổ chức đang tạm ngưng" })).toBeInTheDocument();
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/orgs"));
    expect(adapter.replace).not.toHaveBeenCalled();
  });
});

function suspendedAs(role: string) {
  requestMock.mockImplementation((path: string) => {
    if (path === "/api/v1/orgs") {
      return Promise.resolve({ organizations: [{ id: "o1", slug: "acme", name: "Acme", role, status: "suspended" }] });
    }
    if (path === "/api/v1/workspaces") return Promise.resolve({ workspaces: [] });
    return Promise.reject(new ApiError("suspended", "organization_suspended", 403));
  });
}

function renderGuard(children: () => React.ReactNode = () => <p>workspace body</p>) {
  return render(
    wrapWithNav(
      <DashboardGuard orgSlug="acme" wsSlug="team">
        {children}
      </DashboardGuard>,
      nav(),
    ),
  );
}

describe("DashboardGuard's suspended notice", () => {
  it("is an entry screen: names the organization, titles the tab and keeps the language switch", async () => {
    suspendedAs("member");
    renderGuard();
    expect(await screen.findByText(/^Acme tạm thời không truy cập được\./)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Tổ chức đang tạm ngưng" })).not.toHaveFocus();
    expect(document.title).toBe("Tổ chức đang tạm ngưng · UniWork");
    expect(screen.getAllByRole("radio", { name: "English" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Tham gia tổ chức khác" })).toHaveAttribute("href", "/get-started");
  });

  /**
   * The owner of a suspended organization can neither transfer nor close it,
   * so the switch into another one refuses them: they are told to contact
   * support, and offered no link that would end at that refusal.
   */
  it("tells the owner to contact support instead of offering to join another organization", async () => {
    suspendedAs("owner");
    renderGuard();
    expect(await screen.findByText(/Bạn là chủ sở hữu: liên hệ bộ phận hỗ trợ/)).toBeInTheDocument();
    expect(screen.queryByText(/Liên hệ chủ sở hữu tổ chức/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Tham gia tổ chức khác" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Đăng xuất" })).toBeInTheDocument();
  });

  it("holds the frame, with a heading, while the organization list loads", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/orgs") return new Promise(() => {});
      if (path === "/api/v1/workspaces") return Promise.resolve({ workspaces: [] });
      return Promise.reject(new ApiError("suspended", "organization_suspended", 403));
    });
    renderGuard();
    expect(await screen.findByRole("heading", { level: 1, name: "Đang tải…" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
  });

  /** Swapped in for a workspace the person was using: the heading takes focus so the change is heard. */
  it("takes focus when the suspension lands after the workspace opened", async () => {
    let suspended = false;
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/orgs/acme/workspaces/team") {
        return Promise.resolve({
          workspace: { id: "w1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "acme", organization_name: "Acme" },
        });
      }
      if (path === "/api/v1/orgs") {
        return Promise.resolve({ organizations: [{ id: "o1", slug: "acme", name: "Acme", role: "member", status: "suspended" }] });
      }
      if (path === "/api/v1/workspaces") return Promise.resolve({ workspaces: [] });
      if (suspended) return Promise.reject(new ApiError("suspended", "organization_suspended", 403));
      return Promise.resolve({});
    });
    function Later() {
      useQuery({ queryKey: ["later"], queryFn: () => Promise.reject(new ApiError("suspended", "organization_suspended", 403)) });
      return <p>workspace body</p>;
    }
    renderGuard(() => {
      suspended = true;
      return <Later />;
    });
    const heading = await screen.findByRole("heading", { level: 1, name: "Tổ chức đang tạm ngưng" });
    await waitFor(() => expect(heading).toHaveFocus());
  });
});

describe("DashboardGuard when the member has been deactivated", () => {
  it("names the account rather than the organization, and does not bounce to the picker", async () => {
    requestMock.mockRejectedValue(new ApiError("deactivated", "member_deactivated", 403));
    const adapter = nav();
    render(
      wrapWithNav(
        <DashboardGuard orgSlug="acme" wsSlug="team">
          {() => <p>workspace body</p>}
        </DashboardGuard>,
        adapter,
      ),
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: "Tài khoản của bạn đã bị vô hiệu hóa trong tổ chức này" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Tổ chức đang tạm ngưng")).not.toBeInTheDocument();
    // A deactivated row no longer counts as belonging (ADR 0032 D1), so the
    // way out is /get-started — as a link, not a redirect away from the notice.
    expect(screen.getByRole("link", { name: "Tạo hoặc tham gia tổ chức khác" })).toHaveAttribute(
      "href",
      "/get-started",
    );
    expect(screen.queryByText("workspace body")).not.toBeInTheDocument();
    expect(adapter.replace).not.toHaveBeenCalled();
  });
});
