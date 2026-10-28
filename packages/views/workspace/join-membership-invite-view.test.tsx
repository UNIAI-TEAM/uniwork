import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import { fakeNav, requestMock, wrapWithNav } from "../test/api-mock";
import { JoinMembershipInviteView } from "./join-membership-invite-view";
import { membershipInviteSecretKey } from "./membership-invite-secret";

initI18n();

beforeEach(() => {
  requestMock.mockReset();
  resetAuthStoreForTests();
  sessionStorage.clear();
  window.location.hash = "";
});

const me: User = {
  id: "u1",
  email: "a@b.co",
  display_name: "A",
  email_verified_at: "2026-01-01T00:00:00Z",
  onboarded_at: "2026-01-01T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const beta = { id: "o2", slug: "beta", name: "Beta" };
const acme = { id: "o1", slug: "acme", name: "Acme" };
const betaWorkspace = {
  id: "w2",
  slug: "ops",
  name: "Ops",
  organization_id: "o2",
  organization_slug: "beta",
  organization_name: "Beta",
};

function preview(conflicts: unknown[] = []) {
  return {
    link_id: "l1",
    status: "active",
    organization: beta,
    workspaces: [{ id: "w2", slug: "ops", name: "Ops", joined: false }],
    needs_join: true,
    already_member: false,
    conflicts,
  };
}

function serve(body: unknown, onJoin?: (init?: { body?: unknown }) => Promise<unknown>) {
  requestMock.mockImplementation(async (path: string, init?: { body?: unknown }) => {
    if (path === "/api/v1/membership-invite-links/preview") return body;
    if (path === "/api/v1/membership-invite-links/join") {
      return onJoin?.(init) ?? { organization: beta, workspace: betaWorkspace, joined_ids: ["w2"] };
    }
    if (path === "/api/v1/orgs") return { organizations: [{ ...acme, role: "member", status: "active" }] };
    if (path === "/api/v1/workspaces") return { workspaces: [] };
    if (path === "/api/v1/me") return { user: me };
    return {};
  });
}

describe("JoinMembershipInviteView", () => {
  it("joins when there is no switch conflict", async () => {
    setSessionUser(me);
    window.location.hash = "secret=s3cret";
    const joinBodies: unknown[] = [];
    serve(preview(), async (init) => {
      joinBodies.push(init?.body);
      return { organization: beta, workspace: betaWorkspace, joined_ids: ["w2"] };
    });
    const nav = fakeNav("/join/l1");
    render(wrapWithNav(<JoinMembershipInviteView linkId="l1" />, nav));
    expect(await screen.findByRole("heading", { name: "Tham gia Beta" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tham gia" }));
    await waitFor(() => expect(joinBodies).toEqual([{ link_id: "l1", secret: "s3cret" }]));
    expect(sessionStorage.getItem(membershipInviteSecretKey("l1"))).toBe("s3cret");
    // The workspace's Home, its root.
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/beta/ops"));
  });

  it("opens the switch wizard when the preview carries conflicts", async () => {
    setSessionUser(me);
    window.location.hash = "secret=s3cret";
    serve(
      preview([
        {
          organization: acme,
          role: "member",
          required_action: "leave",
          transfer_candidates_count: 0,
        },
      ]),
    );
    render(wrapWithNav(<JoinMembershipInviteView linkId="l1" />));
    expect(await screen.findByRole("heading", { name: "Chuyển sang Beta" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bạn đang thuộc Acme" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Tham gia$/ })).toBeNull();
  });

  it("proves a hand-over before joining, and asks again when the server no longer takes the token", async () => {
    setSessionUser(me);
    window.location.hash = "secret=s3cret";
    const joinBodies: unknown[] = [];
    let tokens = 0;
    requestMock.mockImplementation(async (path: string, init?: { body?: unknown }) => {
      if (path === "/api/v1/membership-invite-links/preview") {
        return preview([{ organization: acme, role: "owner", required_action: "transfer", transfer_candidates_count: 1 }]);
      }
      if (path === "/api/v1/membership-invite-links/join") {
        joinBodies.push(init?.body);
        if (joinBodies.length === 1) throw new ApiError("x", "proof_required", 403, undefined, { proofs: ["password"] });
        return { organization: beta, workspace: betaWorkspace, joined_ids: ["w2"] };
      }
      if (path.startsWith("/api/v1/orgs/acme/members")) {
        return { members: [{ user_id: "u2", email: "an@acme.vn", display_name: "Nguyễn Văn An", role: "admin", created_at: "" }] };
      }
      if (path === "/api/v1/me/sign-in-methods") return { proofs: ["password", "email_code"] };
      if (path === "/api/v1/me/step-up") {
        tokens += 1;
        return { step_up_token: `sut-${tokens}`, expires_at: new Date(Date.now() + 600_000).toISOString(), method: "password" };
      }
      if (path === "/api/v1/orgs") return { organizations: [{ ...acme, role: "owner", status: "active" }] };
      if (path === "/api/v1/workspaces") return { workspaces: [] };
      if (path === "/api/v1/me") return { user: me };
      return {};
    });
    render(wrapWithNav(<JoinMembershipInviteView linkId="l1" />));
    const SLOW = { timeout: 5000 };
    expect(await screen.findByRole("heading", { name: "Chuyển sang Beta" }, SLOW)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
    const combobox = await screen.findByRole("combobox", { name: "Chủ sở hữu mới" }, SLOW);
    fireEvent.click(combobox);
    const option = await screen.findByRole("option", { name: "Nguyễn Văn An an@acme.vn" }, SLOW);
    fireEvent.pointerDown(option);
    fireEvent.click(option);
    await waitFor(() => expect(combobox).toHaveTextContent("Nguyễn Văn An"));
    fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
    fireEvent.click(await screen.findByRole("button", { name: "Chuyển sang Beta" }, SLOW));

    const prove = async () => {
      const proof = within(await screen.findByRole("dialog", { name: "Xác nhận là bạn" }, SLOW));
      fireEvent.change(await proof.findByLabelText("Mật khẩu hiện tại", {}, SLOW), { target: { value: "password123" } });
      fireEvent.click(proof.getByRole("button", { name: "Xác nhận" }));
    };
    await prove();
    await waitFor(() => expect(joinBodies).toHaveLength(1), SLOW);
    await prove();
    await waitFor(() => expect(joinBodies).toHaveLength(2), SLOW);
    const transfer = (body: unknown) => (body as { resolve: Record<string, unknown>[] }).resolve[0];
    expect(transfer(joinBodies[0])).toEqual({ organization_id: "o1", action: "transfer", transfer_to_user_id: "u2", step_up_token: "sut-1" });
    expect(transfer(joinBodies[1])).toMatchObject({ step_up_token: "sut-2" });
  });
});
