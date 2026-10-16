import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { fakeNav, requestMock, wrapWithNav } from "../test/api-mock";
import { useAdminManageAccess } from "./admin-manage-access";

// DOC6-W01, pure admin (access addendum §2.5, N-01). DocumentLockedCard
// variant="admin" is not on the root yet (W-DOC05), so a stand-in host
// renders the "Manage access" button the card will render.

const { t } = initI18n();
const WS = "ws1";

const user: User = {
  id: "u1",
  email: "an@acme.vn",
  display_name: "An",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};
const workspace: Workspace = {
  id: WS,
  slug: "team",
  name: "Team",
  organization_id: "o1",
  organization_slug: "acme",
  organization_name: "Acme",
};

function Host() {
  const entry = useAdminManageAccess(WS, "d1");
  return (
    <>
      {entry.available ? (
        <button type="button" onClick={entry.open}>
          {t("documents.share.admin_manage_button")}
        </button>
      ) : null}
      {entry.dialog}
    </>
  );
}

function renderHost(url = "/") {
  const nav = fakeNav(url);
  render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <Host />
      </WorkspaceProvider>,
      nav,
    ),
  );
  return nav;
}

function serve(summary: () => Promise<unknown>) {
  requestMock.mockReset();
  requestMock.mockImplementation((path: string) => {
    if (path === "/api/v1/documents/d1/admin-summary") return summary();
    if (path === "/api/v1/documents/d1/access-requests") {
      return Promise.resolve({
        requests: [
          {
            id: "r1",
            requester_id: "u3",
            requester_name: "Chi",
            requested_level: "view",
            message: "Cần xem",
            source: null,
            created_at: "2026-10-15T01:00:00Z",
            expires_at: "2026-11-14T01:00:00Z",
          },
        ],
      });
    }
    if (path === "/api/v1/documents/d1/shares") {
      return Promise.resolve({
        my_level: "",
        admin_scope: true,
        acl_owner: { user_id: "u2", level: "none", via: "member" },
        shares: [],
        links: [],
      });
    }
    if (path.startsWith("/api/v1/orgs/acme/members")) {
      return Promise.resolve({
        members: [{ user_id: "u2", email: "binh@acme.vn", display_name: "Bình", role: "member", created_at: "" }],
        next_cursor: "",
      });
    }
    return Promise.resolve({});
  });
}

beforeEach(() => {
  serve(() =>
    Promise.resolve({
      id: "d1",
      title: "Lương 2026",
      kind: "page",
      visibility: "restricted",
      organization_id: "o1",
      workspace_id: "w1",
      revision: "4",
      acl_owner: { user_id: "u2" },
    }),
  );
});

afterEach(() => vi.restoreAllMocks());

describe("useAdminManageAccess (DOC6-W01, N-01)", () => {
  it("opens the share dialog from admin-summary with the admin note and the owner transfer, never the body", async () => {
    renderHost();
    fireEvent.click(await screen.findByRole("button", { name: t("documents.share.admin_manage_button") }));
    expect(await screen.findByRole("dialog", { name: t("documents.share.title") })).toBeInTheDocument();
    expect(screen.getByText(t("documents.share.admin_scope_note"))).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: t("documents.share.owner.transfer_button") })).toBeInTheDocument();
    // Add-people, visibility and links stay manage-only (W-DOC05 owns them).
    expect(screen.queryByText(t("documents.share.add_title"))).toBeNull();
    expect(requestMock.mock.calls.some(([p]) => p === "/api/v1/documents/d1")).toBe(false);
  });

  it("offers no entry when admin-summary refuses", async () => {
    serve(() => Promise.reject(new ApiError("forbidden", "forbidden", 403)));
    renderHost();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("button", { name: t("documents.share.admin_manage_button") })).toBeNull();
  });
  it("opens at the requests section from ?access=requests once admin-summary answered, then drops the parameter (DOC7-W02, N-01)", async () => {
    const nav = renderHost("/acme/team/documents/d1?access=requests&x=1");
    const dialog = await screen.findByRole("dialog", { name: t("documents.share.title") });
    const heading = await within(dialog).findByRole("heading", {
      name: t("documents.access_request.section_title", { count: 1 }),
    });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(within(dialog).getByText("Chi")).toBeInTheDocument();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/acme/team/documents/d1?x=1"));
  });

  it("drops ?access=requests silently when admin-summary refuses or the document is archived", async () => {
    serve(() => Promise.reject(new ApiError("forbidden", "forbidden", 403)));
    const nav = renderHost("/acme/team/documents/d1?access=requests");
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/acme/team/documents/d1"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not open for an archived document and still drops the parameter", async () => {
    serve(() =>
      Promise.resolve({
        id: "d1",
        title: "Lương 2026",
        kind: "page",
        visibility: "restricted",
        organization_id: "o1",
        revision: "4",
        archived_at: "2026-10-14T00:00:00Z",
        acl_owner: { user_id: "u2" },
      }),
    );
    const nav = renderHost("/acme/team/documents/d1?access=requests");
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/acme/team/documents/d1"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
