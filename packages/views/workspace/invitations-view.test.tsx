import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
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
    render(wrapWithNav(<InvitationsView onEmpty={() => {}} />));
    const links = await screen.findAllByRole("link", { name: /Xem lời mời/ });
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/invite/t1", "/invite/t2"]);
    expect(screen.queryByRole("button", { name: "Tham gia tất cả" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tham gia" })).not.toBeInTheDocument();
    expect(requestMock.mock.calls.some(([path]) => String(path).includes("/accept"))).toBe(false);
  });

  it("shows an organization-level invitation without a workspace", async () => {
    answer([{ ...base, id: "i1", token: "t1", org_role: "admin" }]);
    render(wrapWithNav(<InvitationsView onEmpty={() => {}} />));
    const item = await screen.findByRole("listitem");
    expect(within(item).getByText("Acme")).toBeInTheDocument();
    expect(within(item).queryByText(/›/)).not.toBeInTheDocument();
    // The link names its organization, so a list of "Xem" reads apart.
    expect(within(item).getByRole("link", { name: "Xem lời mời vào Acme" })).toBeInTheDocument();
  });

  it("hands over once there is nothing to show", async () => {
    answer([]);
    const onEmpty = vi.fn();
    render(wrapWithNav(<InvitationsView onEmpty={onEmpty} />));
    await waitFor(() => expect(onEmpty).toHaveBeenCalled());
  });
});
