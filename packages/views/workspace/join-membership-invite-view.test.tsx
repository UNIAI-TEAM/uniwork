import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
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
    render(wrapWithNav(<JoinMembershipInviteView linkId="l1" />));
    expect(await screen.findByRole("heading", { name: "Tham gia Beta" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tham gia" }));
    await waitFor(() => expect(joinBodies).toEqual([{ link_id: "l1", secret: "s3cret" }]));
    expect(sessionStorage.getItem(membershipInviteSecretKey("l1"))).toBe("s3cret");
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
});
