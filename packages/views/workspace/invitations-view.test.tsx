import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "@uniwork/core";
import { initI18n } from "@uniwork/core/i18n";
import { resolveLoggedInDestination } from "../auth/post-auth-redirect";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { InvitationsView } from "./invitations-view";

initI18n();

const base = {
  role: "member",
  expires_at: "2026-10-20T00:00:00Z",
  organization: { id: "o1", slug: "acme", name: "Acme" },
  invited_by: { display_name: "Lan" },
};

function answer(invitations: unknown[]) {
  requestMock.mockImplementation(async (path: string) => {
    if (path === "/api/v1/me/invitations") return { invitations };
    throw new Error(`unexpected request ${path}`);
  });
}

describe("InvitationsView", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  /**
   * Joining goes through the invitation page, one flow for every join: it is
   * where a person who already belongs to an organization is shown what the
   * switch costs (spec 2026-10-13 §6.2). The list itself joins nothing.
   */
  it("links each invitation to its own page and joins nothing from the list", async () => {
    answer([
      { ...base, id: "i1", token: "t1", org_role: "admin" },
      { ...base, id: "i2", token: "t2", org_role: "member", workspace: { id: "w1", slug: "ops", name: "Ops" } },
    ]);
    render(wrapWithNav(<InvitationsView onEmpty={() => {}} onSkip={() => {}} />));
    const links = await screen.findAllByRole("link", { name: /Xem lời mời/ });
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/invite/t1", "/invite/t2"]);
    expect(screen.queryByRole("button", { name: "Tham gia tất cả" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tham gia" })).not.toBeInTheDocument();
    expect(requestMock.mock.calls.some(([path]) => String(path).includes("/accept"))).toBe(false);
  });

  it("shows an organization-level invitation without a workspace", async () => {
    answer([{ ...base, id: "i1", token: "t1", org_role: "admin" }]);
    render(wrapWithNav(<InvitationsView onEmpty={() => {}} onSkip={() => {}} />));
    const item = within(await screen.findByRole("list", { name: "Lời mời đang chờ bạn" })).getByRole("listitem");
    expect(within(item).getByText("Acme")).toBeInTheDocument();
    expect(within(item).queryByText(/›/)).not.toBeInTheDocument();
    // The link names its organization, so a list of "Xem" reads apart.
    expect(within(item).getByRole("link", { name: "Xem lời mời vào Acme" })).toBeInTheDocument();
  });

  it("hands over once there is nothing to show", async () => {
    answer([]);
    const onEmpty = vi.fn();
    render(wrapWithNav(<InvitationsView onEmpty={onEmpty} onSkip={() => {}} />));
    await waitFor(() => expect(onEmpty).toHaveBeenCalled());
  });

  it("names the organization role and the expiry date on each row", async () => {
    answer([{ ...base, id: "i1", token: "t1", org_role: "admin", expires_at: "2099-03-05T00:00:00Z" }]);
    render(wrapWithNav(<InvitationsView onEmpty={() => {}} onSkip={() => {}} />));
    const item = within(await screen.findByRole("list", { name: "Lời mời đang chờ bạn" })).getByRole("listitem");
    expect(item).toHaveTextContent("Quản trị");
    expect(item).not.toHaveTextContent(/admin|member/);
    const date = new Date(Date.parse("2099-03-05T00:00:00Z")).toLocaleDateString("vi", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    const time = item.querySelector("time");
    expect(time).toHaveAttribute("dateTime", "2099-03-05T00:00:00Z");
    expect(time).toHaveTextContent(date);
    expect(item).toHaveTextContent(`hết hạn ${date}`);
    expect(within(item).queryByText("Sắp hết hạn")).not.toBeInTheDocument();
  });

  it("flags an invitation that lapses within two days", async () => {
    const soon = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
    answer([{ ...base, id: "i1", token: "t1", org_role: "member", expires_at: soon }]);
    render(wrapWithNav(<InvitationsView onEmpty={() => {}} onSkip={() => {}} />));
    const item = within(await screen.findByRole("list", { name: "Lời mời đang chờ bạn" })).getByRole("listitem");
    expect(within(item).getByText("Sắp hết hạn")).toBeInTheDocument();
  });

  it("shows the list's shape and a loading status while the request is out", () => {
    requestMock.mockImplementation(() => new Promise(() => {}));
    render(wrapWithNav(<InvitationsView onEmpty={() => {}} onSkip={() => {}} />));
    expect(screen.getByRole("status")).toHaveTextContent("Đang tải…");
    expect(screen.queryByRole("list", { name: "Lời mời đang chờ bạn" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Lời mời đang chờ bạn" })).toBeInTheDocument();
  });

  it("says the invitations failed to load, with a retry, instead of a blank page", async () => {
    requestMock.mockRejectedValueOnce(new Error("boom"));
    const onEmpty = vi.fn();
    render(wrapWithNav(<InvitationsView onEmpty={onEmpty} onSkip={() => {}} />));
    expect(await screen.findByRole("alert")).toHaveTextContent("Không tải được danh sách lời mời.");
    answer([{ ...base, id: "i1", token: "t1", org_role: "member" }]);
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByRole("link", { name: "Xem lời mời vào Acme" })).toBeInTheDocument();
    expect(onEmpty).not.toHaveBeenCalled();
  });

  it("lets the person put the invitations off without joining any", async () => {
    answer([{ ...base, id: "i1", token: "t1", org_role: "member" }]);
    const onSkip = vi.fn();
    render(wrapWithNav(<InvitationsView onEmpty={() => {}} onSkip={onSkip} />));
    await screen.findByRole("list", { name: "Lời mời đang chờ bạn" });
    fireEvent.click(screen.getByRole("button", { name: "Để sau" }));
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(requestMock.mock.calls.some(([path]) => String(path).includes("/accept"))).toBe(false);
  });

  /**
   * Sign-in already asked for the invitations to choose this page; the page
   * reads that answer from the cache instead of asking the server again.
   */
  it("asks for the invitations once between sign-in and the list", async () => {
    answer([{ ...base, id: "i1", token: "t1", org_role: "member" }]);
    const client = createQueryClient();
    const user = { email_verified_at: "2026-08-27T00:00:00Z", onboarded_at: null };
    expect(await resolveLoggedInDestination(user, [], client)).toBe("/invitations");
    render(wrapWithNav(<InvitationsView onEmpty={() => {}} onSkip={() => {}} />, undefined, client));
    expect(await screen.findByRole("link", { name: "Xem lời mời vào Acme" })).toBeInTheDocument();
    expect(requestMock.mock.calls.filter(([path]) => path === "/api/v1/me/invitations")).toHaveLength(1);
  });

  it("holds the request and keeps its heading while the host resolves the session", () => {
    answer([]);
    render(wrapWithNav(<InvitationsView enabled={false} onEmpty={() => {}} onSkip={() => {}} />));
    expect(screen.getByRole("heading", { level: 1, name: "Lời mời đang chờ bạn" })).toBeInTheDocument();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("waits for the host to know where an empty list leads before leaving, and holds Later until then", async () => {
    answer([]);
    const onEmpty = vi.fn();
    const onSkip = vi.fn();
    const client = createQueryClient();
    const { rerender } = render(
      wrapWithNav(<InvitationsView exitReady={false} onEmpty={onEmpty} onSkip={onSkip} />, undefined, client),
    );
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/me/invitations"));
    const later = screen.getByRole("button", { name: "Để sau" });
    expect(later).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(later);
    expect(onSkip).not.toHaveBeenCalled();
    expect(onEmpty).not.toHaveBeenCalled();
    rerender(wrapWithNav(<InvitationsView exitReady onEmpty={onEmpty} onSkip={onSkip} />, undefined, client));
    await waitFor(() => expect(onEmpty).toHaveBeenCalled());
  });
});
