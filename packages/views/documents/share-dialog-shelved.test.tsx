import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { DocumentSchema, type Document } from "@uniwork/core/types/document";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { ShareDialog } from "./share-dialog";

// ARCHIVE-01 (UNI-1845) addendum §8 U-9 / Q-AR2 = a, test UI-AR6: the share
// dialog of a shelved document still lists and revokes access, but every way
// of granting more is aria-disabled (kept in the tab order) with one
// explanation line, and a click on it sends nothing.

const { t } = initI18n();

const WS = "ws1";
const ORG = "o1";
const user: User = {
  id: "u1", email: "an@acme.vn", display_name: "An", onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};
const workspace: Workspace = { id: WS, slug: "team", name: "Team", organization_id: ORG, organization_slug: "acme", organization_name: "Acme" };

function shelvedDoc(over: Record<string, unknown> = {}): Document {
  const parsed = DocumentSchema.parse({
    id: "d1", workspace_id: WS, organization_id: ORG, kind: "page", title: "Kế hoạch Q4", revision: "7",
    my_level: "manage", visibility: "workspace", updated_at: "2026-09-28T03:00:00Z",
    shelved_at: "2026-10-16T03:00:00Z", shelved_by: "u1", ...over,
  });
  return {
    ...parsed,
    kind: parsed.kind as Document["kind"], visibility: parsed.visibility as Document["visibility"],
    my_level: parsed.my_level as Document["my_level"], via: parsed.via as Document["via"],
    owner_kind: parsed.owner_kind as Document["owner_kind"], system_kind: parsed.system_kind as Document["system_kind"],
  };
}

const access = {
  my_level: "manage", via: "member",
  acl_owner: { user_id: "u1", level: "manage", via: "member" },
  shares: [{
    id: "s1", principal_type: "user", principal_id: "u2", level: "view", active: true, effective_level: "view",
    effective_via: "member", granted_by: "u1", granted_by_kind: "human", created_at: "2026-09-27T03:00:00Z",
  }],
  links: [{ id: "l1", expires_at: "2026-12-04T03:00:00Z", view_count: 3, created_by: "u1", created_by_kind: "human", created_at: "2026-09-27T03:00:00Z" }],
};

function serve() {
  requestMock.mockReset();
  requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
    if (path === "/api/v1/documents/d1/shares" && !opts?.method) return Promise.resolve(access);
    if (path.startsWith("/api/v1/documents/d1/shares/") && opts?.method === "DELETE") return Promise.resolve({});
    if (path.startsWith("/api/v1/documents/d1/links/") && opts?.method === "DELETE") return Promise.resolve({});
    if (path.startsWith("/api/v1/orgs/acme/members")) {
      return Promise.resolve({ members: [{ user_id: "u2", email: "binh@acme.vn", display_name: "Bình", role: "member", created_at: "" }], next_cursor: "" });
    }
    if (path === `/api/v1/orgs/${ORG}/workspaces`) return Promise.resolve({ workspaces: [] });
    return Promise.resolve({});
  });
}

const writes = () =>
  requestMock.mock.calls.filter(([, init]) => init && (init as { method?: string }).method && (init as { method?: string }).method !== "GET");

function renderDialog(doc = shelvedDoc()) {
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <ShareDialog open onOpenChange={() => undefined} wsId={WS} doc={doc} />
      </WorkspaceProvider>,
    ),
  );
}

beforeEach(serve);
afterEach(() => vi.restoreAllMocks());

describe("UI-AR6 share dialog on a shelved document", () => {
  it("still lists the access and revokes a person and a link", async () => {
    renderDialog();
    expect(await screen.findByText("Bình")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Thu hồi Bình/ }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/documents/d1/shares/s1", expect.objectContaining({ method: "DELETE" })));

    fireEvent.click(screen.getByRole("button", { name: /^Thu hồi \d/ }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/documents/d1/links/l1", expect.objectContaining({ method: "DELETE" })));
  });

  it("explains itself and disables granting: add, raise level, link on, private settings", async () => {
    renderDialog();
    await screen.findByText("Bình");
    const note = screen.getByText(t("documents.shelved_doc.share_note"));
    expect(note).toBeInTheDocument();

    // Add people: the button keeps its place in the tab order and says why it is off.
    const add = screen.getByRole("button", { name: t("documents.share.submit") });
    expect(add).toHaveAttribute("aria-disabled", "true");
    expect(add).not.toBeDisabled();
    expect(add.getAttribute("aria-describedby")).toBe(note.id);
    // Raise level: the level control cannot be changed.
    expect(screen.getByRole("combobox", { name: t("documents.share.level_label") })).toBeDisabled();
    // Link on.
    const link = screen.getByRole("button", { name: t("documents.share.link_create") });
    expect(link).toHaveAttribute("aria-disabled", "true");
    expect(link).not.toBeDisabled();
    // Private settings (restricted visibility) and its save.
    const restricted = screen.getByRole("button", { name: new RegExp(t("documents.share.visibility_restricted")) });
    expect(restricted).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: t("documents.share.visibility_save") })).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(add);
    fireEvent.click(link);
    fireEvent.click(restricted);
    fireEvent.click(screen.getByRole("button", { name: t("documents.share.visibility_save") }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(writes()).toHaveLength(0);
  });

  it("leaves a live document's dialog as it was", async () => {
    renderDialog(shelvedDoc({ shelved_at: null, shelved_by: null }));
    await screen.findByText("Bình");
    expect(screen.queryByText(t("documents.shelved_doc.share_note"))).toBeNull();
    expect(screen.getByRole("button", { name: t("documents.share.link_create") })).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("combobox", { name: t("documents.share.level_label") })).not.toBeDisabled();
  });
});
