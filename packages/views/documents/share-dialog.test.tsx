import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import { configureRuntime, resetRuntimeConfig } from "@uniwork/core/runtime-config";
import { DocumentSchema, type Document } from "@uniwork/core/types/document";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { ShareDialog } from "./share-dialog";

const { t } = initI18n();

// The candidates endpoint answers 404 here, so the picker uses its local
// fallback directory (a server answer, even an empty one, is never replaced).
const candidatesUnavailable = () => Promise.reject(new ApiError("not found", "not_found", 404));

const WS = "ws1";
const ORG = "o1";

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
  organization_id: ORG,
  organization_slug: "acme",
  organization_name: "Acme",
};

function narrowDocument(parsed: ReturnType<typeof DocumentSchema.parse>): Document {
  return {
    ...parsed,
    kind: parsed.kind as Document["kind"],
    visibility: parsed.visibility as Document["visibility"],
    my_level: parsed.my_level as Document["my_level"],
    via: parsed.via as Document["via"],
    owner_kind: parsed.owner_kind as Document["owner_kind"], system_kind: parsed.system_kind as Document["system_kind"],
  };
}

function documentFixture(over: Record<string, unknown> = {}): Document {
  return narrowDocument(
    DocumentSchema.parse({
      id: "d1",
      workspace_id: WS,
      organization_id: ORG,
      kind: "page",
      title: "Kế hoạch Q4",
      revision: "7",
      my_level: "manage",
      visibility: "workspace",
      updated_at: "2026-09-28T03:00:00Z",
      ...over,
    }),
  );
}

const accessPayload = {
  my_level: "manage",
  via: "member",
  acl_owner: { user_id: "u1", level: "manage", via: "member" },
  shares: [
    {
      id: "s1",
      principal_type: "user",
      principal_id: "u2",
      level: "view",
      active: true,
      effective_level: "edit",
      effective_via: "member",
      granted_by: "u1",
      granted_by_kind: "human",
      created_at: "2026-09-27T03:00:00Z",
    },
    {
      id: "s2",
      principal_type: "workspace",
      principal_id: "w2",
      level: "edit",
      active: false,
      effective_level: null,
      granted_by: "u1",
      granted_by_kind: "human",
      created_at: "2026-09-26T03:00:00Z",
    },
  ],
  links: [
    {
      id: "l1",
      expires_at: "2026-10-04T03:00:00Z",
      view_count: 3,
      created_by: "u1",
      created_by_kind: "human",
      created_at: "2026-09-27T03:00:00Z",
    },
  ],
};

const membersPayload = {
  members: [
    { user_id: "u2", email: "binh@acme.vn", display_name: "Bình", role: "member", created_at: "" },
    { user_id: "u3", email: "chi@acme.vn", display_name: "Chi", role: "member", created_at: "" },
  ],
  next_cursor: "",
};

const threeMembersPayload = {
  members: [
    ...membersPayload.members,
    { user_id: "u4", email: "dung@acme.vn", display_name: "Dũng", role: "member", created_at: "" },
  ],
  next_cursor: "",
};

const workspacesPayload = {
  workspaces: [
    { id: "w2", slug: "design", name: "Design", organization_id: ORG, organization_slug: "acme", organization_name: "Acme" },
  ],
};

interface Options {
  access?: unknown;
  shareFails?: boolean;
  createLink?: () => unknown;
  visibilityFails?: boolean;
}

function okAccessUpdate(
  body: any,
  preview: { users: unknown[]; groups: unknown[]; warnings: unknown[] } = { users: [], groups: [], warnings: [] },
) {
  const items: any[] = body?.items ?? [];
  return {
    batch_id: body?.dry_run ? "" : "01JBATCH1",
    dry_run: Boolean(body?.dry_run),
    results: items.map((item, index) => ({
      index,
      status: item?.level === null ? "revoked" : "granted",
    })),
    preview,
  };
}

function serve(over: Options = {}) {
  requestMock.mockReset();
  requestMock.mockImplementation((path: string, opts?: { method?: string; body?: any }) => {
    if (path === "/api/v1/documents/d1/shares" && !opts?.method) {
      return Promise.resolve(over.access ?? accessPayload);
    }
    if (path === "/api/v1/documents/d1/access" && opts?.method === "PUT") {
      if (over.shareFails) return Promise.reject(new Error("share failed"));
      return Promise.resolve(okAccessUpdate(opts.body));
    }
    if (path === "/api/v1/documents/d1/shares" && opts?.method === "POST") {
      if (over.shareFails) return Promise.reject(new Error("share failed"));
      return Promise.resolve({
        share: {
          id: "s9",
          principal_type: opts.body.principal_type,
          principal_id: opts.body.principal_id,
          level: opts.body.level,
          active: true,
          created_at: "2026-09-28T03:00:00Z",
        },
      });
    }
    if (path === "/api/v1/documents/d1/shares/batch" && opts?.method === "POST") {
      if (over.shareFails) return Promise.reject(new Error("share failed"));
      return Promise.resolve({ shares: [] });
    }
    if (path.startsWith("/api/v1/documents/d1/shares/") && opts?.method === "DELETE") {
      return Promise.resolve({});
    }
    if (path === "/api/v1/documents/d1/links" && opts?.method === "POST") {
      if (over.createLink) return over.createLink();
      return Promise.resolve({
        link: { id: "l9", view_count: 0, created_at: "2026-09-28T03:00:00Z" },
        token: "raw-token",
        url: "https://app.uniwork.vn/share/raw-token",
      });
    }
    if (path.startsWith("/api/v1/documents/d1/links/") && opts?.method === "DELETE") {
      return Promise.resolve({});
    }
    if (path.includes("/share-candidates")) return candidatesUnavailable();
    if (path.startsWith("/api/v1/orgs/acme/members")) {
      return Promise.resolve(membersPayload);
    }
    if (path === `/api/v1/orgs/${ORG}/workspaces`) {
      return Promise.resolve(workspacesPayload);
    }
    if (path === "/api/v1/documents/d1" && opts?.method === "PATCH") {
      if (over.visibilityFails) return Promise.reject(new Error("visibility failed"));
      return Promise.resolve({ document: { ...documentFixture(), visibility: opts.body?.visibility } });
    }
    return Promise.resolve({});
  });
}

function renderDialog(doc = documentFixture()) {
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <ShareDialog open onOpenChange={() => undefined} wsId={WS} doc={doc} />
      </WorkspaceProvider>,
    ),
  );
}

async function pickOption(label: string, option: string | RegExp) {
  // The previous popup must be gone before the next trigger is clicked, or the
  // exit animation swallows the pointer event.
  await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  const item = await screen.findByRole("option", { name: option });
  // Base UI's select commits on a pointer press, not on a bare click.
  fireEvent.pointerDown(item, { pointerType: "mouse" });
  fireEvent.pointerUp(item, { pointerType: "mouse" });
  fireEvent.click(item);
  await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
}

/** Search the people picker by name and pick the match. */
async function pickPerson(name: string) {
  const input = screen.getByRole("combobox", { name: t("documents.share.principal_placeholder") });
  // Base UI opens the list from the keyboard (ArrowDown), not from a bare
  // change event, so the helper drives it the way a keyboard user would.
  input.focus();
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.change(input, { target: { value: name } });
  const item = await screen.findByRole("option", { name: new RegExp(name) });
  fireEvent.click(item);
  await screen.findByRole("button", { name: t("documents.share.people_remove", { name }) });
}

beforeEach(() => {
  serve();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetRuntimeConfig();
});

describe("ShareDialog", () => {
  it("shows the real access list: my level, the ACL owner, grants and links", async () => {
    renderDialog();

    expect(await screen.findByText(t("documents.share.access_title"))).toBeInTheDocument();
    expect(screen.getByText(t("documents.share.my_level", { level: t("documents.share.level_manage") }))).toBeInTheDocument();
    const ownerBadge = screen.getByText(t("documents.share.acl_owner"));
    expect(ownerBadge).toBeInTheDocument();
    const ownerRow = ownerBadge.closest("li")!;
    expect(ownerRow).not.toHaveTextContent(t("documents.share.level_manage"));
    expect(t("documents.share.level_view")).toBe("Chỉ xem");
    expect(t("documents.share.level_edit")).toBe("Chỉnh sửa");
    expect(screen.getByText("Bình")).toBeInTheDocument();
    expect(screen.getByText("Design")).toBeInTheDocument();
    // A revoked/dead grant is marked, not hidden.
    expect(screen.getByText(t("documents.share.inactive"))).toBeInTheDocument();
    // The effective level is shown when it differs from the grant's own level.
    expect(
      screen.getAllByText(new RegExp(t("documents.share.effective", { level: t("documents.share.level_edit") }))).length,
    ).toBeGreaterThan(0);
    // One live link with its view count.
    expect(screen.getByText(/3 lượt xem/)).toBeInTheDocument();
  });

  it("renders Chia sẻ “{{title}}” and Lưu tại: {{workspace}} in the header, falling back when title or workspace name is absent (VIS-SHS1-01)", async () => {
    const { unmount } = renderDialog(documentFixture({ title: "Báo cáo doanh thu Q3", workspace_id: "w2" }));

    const namedDialog = await screen.findByRole("dialog", {
      name: t("documents.share.title_named", { title: "Báo cáo doanh thu Q3" }),
    });
    expect(
      await within(namedDialog).findByText(t("documents.share.stored_in", { workspace: "Design" })),
    ).toBeInTheDocument();
    expect(within(namedDialog).queryByText(t("documents.share.description"))).toBeNull();
    unmount();

    renderDialog(documentFixture({ title: "", workspace_id: "ws-unknown" }));
    const fallbackDialog = await screen.findByRole("dialog", { name: t("documents.share.title") });
    await within(fallbackDialog).findByText(t("documents.share.access_title"));
    expect(within(fallbackDialog).queryByText(/Lưu tại:/)).toBeNull();
    expect(within(fallbackDialog).queryByText(/ws-unknown/)).toBeNull();
    expect(fallbackDialog).not.toHaveAttribute("aria-describedby");
  });

  it("TV1-02/TV1-06: keeps every grid child shrinkable and the title clear of the close button", async () => {
    const { unmount } = renderDialog(documentFixture({ title: "Báo cáo doanh thu Q3 rất dài và không có dấu cáchcuốicùng" }));

    const dialog = await screen.findByRole("dialog", {
      name: t("documents.share.title_named", { title: "Báo cáo doanh thu Q3 rất dài và không có dấu cáchcuốicùng" }),
    });
    // The dialog is a CSS grid; each child must be allowed to shrink below its
    // content width or one long row widens the popup past the 390px viewport.
    expect(dialog).toHaveClass("[&>*]:min-w-0");
    const title = within(dialog).getByRole("heading");
    expect(title).toHaveClass("pr-8");
    expect(title).toHaveClass("break-words");
    unmount();
  });

  it("labels a live comment grant, mine and a row's, as Comment and never as View", async () => {
    const comment = {
      ...accessPayload,
      my_level: "comment",
      shares: [{ ...accessPayload.shares[0], level: "comment", effective_level: "comment" }],
    };
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/documents/d1/shares") return Promise.resolve(comment);
      if (path.includes("/share-candidates")) return candidatesUnavailable();
      if (path.startsWith("/api/v1/orgs/acme/members")) return Promise.resolve(membersPayload);
      if (path === `/api/v1/orgs/${ORG}/workspaces`) return Promise.resolve(workspacesPayload);
      return Promise.resolve({});
    });
    renderDialog();

    expect(await screen.findByText(t("documents.share.my_level", { level: t("documents.share.level_comment") }))).toBeInTheDocument();
    expect(screen.getAllByText(new RegExp(`^${t("documents.share.level_comment")}`)).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(t("documents.share.my_level", { level: t("documents.share.level_view") }))).toBeNull();
  });

  it("omits the my_level line when an admin-only caller has no document level (VIS-SHS1-06)", async () => {
    serve({ access: { ...accessPayload, my_level: "" } });
    renderDialog(documentFixture({ my_level: "", admin_scope: true }));

    expect(await screen.findByText(t("documents.share.access_title"))).toBeInTheDocument();
    expect(screen.getByText(t("documents.share.admin_scope_note"))).toBeInTheDocument();
    expect(screen.queryByText(/Mức của bạn|Your level/)).toBeNull();
  });

  it("keeps a failed read with a retry", async () => {
    let fail = true;
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === "/api/v1/documents/d1/shares" && !opts?.method) {
        if (fail) return Promise.reject(new Error("offline"));
        return Promise.resolve(accessPayload);
      }
      if (path.includes("/share-candidates")) return candidatesUnavailable();
      if (path.startsWith("/api/v1/orgs/acme/members")) return Promise.resolve(membersPayload);
      return Promise.resolve({});
    });
    renderDialog();

    expect(await screen.findByText(t("documents.share.error"))).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: t("documents.share.retry") }));
    expect(await screen.findByText(t("documents.share.access_title"))).toBeInTheDocument();
  });

  it("degrades to the manage-only note when the level drops while open", async () => {
    const { rerender } = renderDialog();
    expect(await screen.findByText(t("documents.share.access_title"))).toBeInTheDocument();

    rerender(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={user}>
          <ShareDialog open onOpenChange={() => undefined} wsId={WS} doc={documentFixture({ my_level: "edit" })} />
        </WorkspaceProvider>,
      ),
    );

    expect(screen.getByText(t("documents.share.manage_only"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("documents.share.submit") })).toBeNull();
  });

  it("renders nothing at all for an owned document", async () => {
    renderDialog(documentFixture({ owner_kind: "work_product", owner_id: "wp1" }));
    await waitFor(() => expect(screen.queryByText(t("documents.share.title"))).toBeNull());
    expect(requestMock).not.toHaveBeenCalledWith("/api/v1/documents/d1/shares", expect.anything());
  });

  it("shares a workspace principal at the chosen level and clears the picker", async () => {
    const puts: any[] = [];
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: any }) => {
      if (path === "/api/v1/documents/d1/shares" && !opts?.method) return Promise.resolve(accessPayload);
      if (path === "/api/v1/documents/d1/access" && opts?.method === "PUT") {
        if (!opts.body?.dry_run) puts.push(opts.body);
        return Promise.resolve(okAccessUpdate(opts.body));
      }
      if (path.includes("/share-candidates")) return candidatesUnavailable();
      if (path.startsWith("/api/v1/orgs/acme/members")) return Promise.resolve(membersPayload);
      if (path === `/api/v1/orgs/${ORG}/workspaces`) return Promise.resolve(workspacesPayload);
      return Promise.resolve({});
    });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    await pickPerson("Design");
    await pickOption(t("documents.share.level_label"), t("documents.share.level_edit"));
    fireEvent.click(screen.getByRole("button", { name: t("documents.share.submit") }));

    await waitFor(() => expect(puts.length).toBe(1));
    expect(puts[0]).toEqual({
      items: [{ principal_type: "workspace", principal_id: "w2", level: "edit" }],
      dry_run: false,
    });
  });

  it("caps the document's own home workspace at edit in the unified picker (Q-S1)", async () => {
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === "/api/v1/documents/d1/shares" && !opts?.method) return Promise.resolve(accessPayload);
      if (path.includes("/share-candidates")) return candidatesUnavailable();
      if (path.startsWith("/api/v1/orgs/acme/members")) return Promise.resolve(membersPayload);
      if (path === `/api/v1/orgs/${ORG}/workspaces`) {
        return Promise.resolve({
          workspaces: [
            { id: WS, slug: "team", name: "Team", organization_id: ORG, organization_slug: "acme", organization_name: "Acme" },
            { id: "w2", slug: "design", name: "Design", organization_id: ORG, organization_slug: "acme", organization_name: "Acme" },
          ],
        });
      }
      return Promise.resolve({});
    });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    await pickPerson("Team");
    fireEvent.click(screen.getByRole("combobox", { name: t("documents.share.level_label") }));
    expect(await screen.findByRole("option", { name: t("documents.share.level_edit") })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: t("documents.share.level_manage") })).toBeNull();
  });

  it("judges the home row by the document's workspace, not the route's (BE-SHS1-20)", async () => {
    let shareReads = 0;
    const puts: any[] = [];
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: any }) => {
      if (path === "/api/v1/documents/d1/shares" && !opts?.method) {
        shareReads += 1;
        return Promise.resolve(accessPayload);
      }
      if (path === "/api/v1/documents/d1/access" && opts?.method === "PUT") {
        if (!opts.body?.dry_run) puts.push(opts.body);
        return Promise.resolve(okAccessUpdate(opts.body));
      }
      if (path.includes("/share-candidates")) return candidatesUnavailable();
      if (path.startsWith("/api/v1/orgs/acme/members")) return Promise.resolve(membersPayload);
      if (path === `/api/v1/orgs/${ORG}/workspaces`) {
        return Promise.resolve({
          workspaces: [
            { id: WS, slug: "team", name: "Team", organization_id: ORG, organization_slug: "acme", organization_name: "Acme" },
            { id: "w2", slug: "design", name: "Design", organization_id: ORG, organization_slug: "acme", organization_name: "Acme" },
          ],
        });
      }
      return Promise.resolve({});
    });
    renderDialog(documentFixture({ workspace_id: "w2" }));
    await screen.findByText(t("documents.share.access_title"));

    await pickPerson("Team");
    const before = shareReads;
    fireEvent.click(screen.getByRole("button", { name: t("documents.share.submit") }));
    await waitFor(() => expect(puts.length).toBe(1));
    await waitFor(() => expect(shareReads).toBeGreaterThan(before));
    expect(screen.queryByText(t("documents.share.submit_failed"))).toBeNull();
  });

  it("words the home-row level refusal with the ceiling the server names", async () => {
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === "/api/v1/documents/d1/shares" && !opts?.method) return Promise.resolve(accessPayload);
      if (path === "/api/v1/documents/d1/access" && opts?.method === "PUT") {
        return Promise.reject(
          new ApiError("dòng Workspace gốc chỉ nhận view, comment hoặc edit", "level_not_allowed", 422, undefined, {
            max: "edit",
          }),
        );
      }
      if (path.includes("/share-candidates")) return candidatesUnavailable();
      if (path.startsWith("/api/v1/orgs/acme/members")) return Promise.resolve(membersPayload);
      if (path === `/api/v1/orgs/${ORG}/workspaces`) return Promise.resolve(workspacesPayload);
      return Promise.resolve({});
    });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    await pickPerson("Design");
    fireEvent.click(screen.getByRole("button", { name: t("documents.share.submit") }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      t("documents.errors.level_not_allowed", { max: t("documents.share.level_edit") }),
    );
  });

  it("keeps the picked people and shows the message when the batch fails", async () => {
    serve({ shareFails: true });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    await pickPerson("Bình");
    fireEvent.click(screen.getByRole("button", { name: t("documents.share.submit") }));

    expect(await screen.findByRole("alert")).toHaveTextContent("share failed");
    expect(screen.getByRole("button", { name: t("documents.share.people_remove", { name: "Bình" }) })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("documents.share.submit") })).not.toHaveAttribute("aria-disabled", "true");
  });

  it("shares three people at one level with ONE batch PUT and lists the three grants", async () => {
    const puts: { path: string; body: any }[] = [];
    let granted: unknown[] = [];
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: any }) => {
      if (path === "/api/v1/documents/d1/shares" && !opts?.method) {
        return Promise.resolve({ ...accessPayload, shares: granted });
      }
      if (path === "/api/v1/documents/d1/access" && opts?.method === "PUT") {
        if (!opts.body?.dry_run) {
          puts.push({ path, body: opts.body });
          granted = opts.body.items.map((item: any, i: number) => ({
            id: `s${i + 10}`,
            principal_type: item.principal_type,
            principal_id: item.principal_id,
            level: item.level,
            active: true,
          }));
        }
        return Promise.resolve(okAccessUpdate(opts.body));
      }
      if (path.includes("/share-candidates")) return candidatesUnavailable();
      if (path.startsWith("/api/v1/orgs/acme/members")) return Promise.resolve(threeMembersPayload);
      return Promise.resolve({});
    });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    await pickPerson("Bình");
    await pickPerson("Chi");
    await pickPerson("Dũng");
    expect(screen.getByText(t("documents.share.selected_count", { count: 3 }))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("documents.share.submit") }));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({
      path: "/api/v1/documents/d1/access",
      body: {
        items: [
          { principal_type: "user", principal_id: "u2", level: "view" },
          { principal_type: "user", principal_id: "u3", level: "view" },
          { principal_type: "user", principal_id: "u4", level: "view" },
        ],
        dry_run: false,
      },
    });
    const access = screen.getByRole("region", { name: t("documents.share.access_title") });
    for (const name of ["Bình", "Chi", "Dũng"]) {
      expect(
        await within(access).findByRole("button", { name: `${t("documents.share.revoke")} ${name}` }),
      ).toBeInTheDocument();
    }
    // Success clears the selection for the next batch.
    expect(screen.queryByRole("list", { name: t("documents.share.people_chosen") })).toBeNull();
    expect(screen.getByRole("button", { name: t("documents.share.submit") })).toHaveAttribute("aria-disabled", "true");
  });

  it("names the refused person on a 422 principal_not_in_organization and lists nothing new", async () => {
    const { ApiError } = await import("@uniwork/core/api");
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: any }) => {
      if (path === "/api/v1/documents/d1/shares" && !opts?.method) return Promise.resolve(accessPayload);
      if (path === "/api/v1/documents/d1/access" && opts?.method === "PUT") {
        return Promise.reject(
          new ApiError("not in organization", "principal_not_in_organization", 422, undefined, {
            principal_ids: ["u3"],
          }),
        );
      }
      if (path.includes("/share-candidates")) return candidatesUnavailable();
      if (path.startsWith("/api/v1/orgs/acme/members")) return Promise.resolve(threeMembersPayload);
      return Promise.resolve({});
    });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    await pickPerson("Bình");
    await pickPerson("Chi");
    fireEvent.click(screen.getByRole("button", { name: t("documents.share.submit") }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(t("documents.share.people_not_in_org", { count: 1, names: "Chi" }));
    expect(alert).not.toHaveTextContent("Bình");
    const access = screen.getByRole("region", { name: t("documents.share.access_title") });
    expect(within(access).queryByRole("button", { name: `${t("documents.share.revoke")} Chi` })).toBeNull();
    // The selection stays so the refused person can be removed.
    expect(screen.getByRole("button", { name: t("documents.share.people_remove", { name: "Chi" }) })).toBeInTheDocument();
  });

  it("removes a picked person with the chip's own button", async () => {
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    await pickPerson("Chi");
    fireEvent.click(screen.getByRole("button", { name: t("documents.share.people_remove", { name: "Chi" }) }));

    expect(screen.queryByRole("list", { name: t("documents.share.people_chosen") })).toBeNull();
    expect(screen.getByRole("button", { name: t("documents.share.submit") })).toHaveAttribute("aria-disabled", "true");
  });

  it("allows mixing person and workspace chips in the unified picker", async () => {
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    await pickPerson("Chi");
    await pickPerson("Design");

    expect(screen.getByRole("button", { name: t("documents.share.people_remove", { name: "Chi" }) })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("documents.share.people_remove", { name: "Design" }) })).toBeInTheDocument();
  });

  it("drops the picked people when the dialog closes and opens again", async () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <WorkspaceProvider workspace={workspace} user={user}>
          <button type="button" onClick={() => setOpen(true)}>
            reopen
          </button>
          <ShareDialog open={open} onOpenChange={setOpen} wsId={WS} doc={documentFixture()} />
        </WorkspaceProvider>
      );
    }
    render(wrapWithNav(<Harness />));
    await screen.findByText(t("documents.share.access_title"));

    await pickPerson("Chi");
    fireEvent.click(screen.getByRole("button", { name: t("common.close") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "reopen" }));
    await screen.findByText(t("documents.share.access_title"));

    expect(screen.queryByRole("list", { name: t("documents.share.people_chosen") })).toBeNull();
  });

  it("revokes one grant via dry_run confirmation without touching the others", async () => {
    const puts: any[] = [];
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: any }) => {
      if (path === "/api/v1/documents/d1/shares" && !opts?.method) return Promise.resolve(accessPayload);
      if (path === "/api/v1/documents/d1/access" && opts?.method === "PUT") {
        puts.push(opts.body);
        return Promise.resolve(
          okAccessUpdate(opts.body, {
            users: [{ user_id: "u2", before: { level: "view", via: "share" }, after: { level: null, via: null } }],
            groups: [],
            warnings: [],
          }),
        );
      }
      if (path.includes("/share-candidates")) return candidatesUnavailable();
      if (path.startsWith("/api/v1/orgs/acme/members")) return Promise.resolve(membersPayload);
      return Promise.resolve({});
    });
    renderDialog();

    fireEvent.click(await screen.findByRole("button", { name: `${t("documents.share.revoke")} Bình` }));
    const confirmRegion = await screen.findByTestId("share-access-confirm");
    fireEvent.click(within(confirmRegion).getByRole("button", { name: t("documents.share.confirm_accept") }));

    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1]).toEqual({
      items: [{ principal_type: "user", principal_id: "u2", level: null }],
      dry_run: false,
    });
  });

  it("updates the home workspace row level via PUT /access", async () => {
    const puts: any[] = [];
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: any }) => {
      if (path === "/api/v1/documents/d1/shares" && !opts?.method) {
        return Promise.resolve({
          ...accessPayload,
          home_workspace: { workspace_id: WS, workspace_name: "Team", level: "edit" },
        });
      }
      if (path === "/api/v1/documents/d1/access" && opts?.method === "PUT") {
        if (!opts.body?.dry_run) puts.push(opts.body);
        return Promise.resolve(okAccessUpdate(opts.body));
      }
      if (path.includes("/share-candidates")) return candidatesUnavailable();
      if (path.startsWith("/api/v1/orgs/acme/members")) return Promise.resolve(membersPayload);
      return Promise.resolve({});
    });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    await pickOption(`${t("documents.share.level_label")} Team`, t("documents.share.level_view"));

    await waitFor(() => expect(puts.length).toBe(1));
    expect(puts[0]).toEqual({
      items: [{ principal_type: "workspace", principal_id: WS, level: "view", on_existing: "update" }],
      dry_run: false,
    });
  });

  it("keeps a failed home-workspace change with its message", async () => {
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === "/api/v1/documents/d1/shares" && !opts?.method) {
        return Promise.resolve({
          ...accessPayload,
          home_workspace: { workspace_id: WS, workspace_name: "Team", level: "edit" },
        });
      }
      if (path === "/api/v1/documents/d1/access" && opts?.method === "PUT") {
        return Promise.reject(new Error("visibility failed"));
      }
      if (path.includes("/share-candidates")) return candidatesUnavailable();
      if (path.startsWith("/api/v1/orgs/acme/members")) return Promise.resolve(membersPayload);
      return Promise.resolve({});
    });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    await pickOption(`${t("documents.share.level_label")} Team`, t("documents.share.level_view"));

    expect(await screen.findByRole("alert")).toHaveTextContent("visibility failed");
  });

  it("shows a freshly minted link URL exactly once, with the lost-token hint", async () => {
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    fireEvent.click(screen.getByRole("button", { name: t("documents.share.link_create") }));
    const url = await screen.findByTestId("share-created-url");
    expect(url).toHaveTextContent("https://app.uniwork.vn/share/raw-token");
    // The only chance to keep the URL takes focus, so it is never missed.
    await waitFor(() => expect(screen.getByRole("button", { name: t("documents.share.link_copy") })).toHaveFocus());
    expect(screen.getByText(t("documents.share.link_url_once"))).toBeInTheDocument();
    expect(screen.getByText(t("documents.share.link_lost_hint"))).toBeInTheDocument();
  });

  it("resolves a path-only link URL on the app origin so the copy works outside the app", async () => {
    configureRuntime({ appUrl: "https://app.uniwork.vn" });
    serve({
      createLink: () =>
        Promise.resolve({
          link: { id: "l9", view_count: 0, created_at: "2026-09-28T03:00:00Z" },
          token: "raw-token",
          url: "/share/raw-token",
        }),
    });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    fireEvent.click(screen.getByRole("button", { name: t("documents.share.link_create") }));
    const url = await screen.findByTestId("share-created-url");
    expect(url).toHaveTextContent("https://app.uniwork.vn/share/raw-token");
  });

  it("shares the organization via PUT /access and clears the picker", async () => {
    const puts: any[] = [];
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: any }) => {
      if (path === "/api/v1/documents/d1/shares" && !opts?.method) return Promise.resolve(accessPayload);
      if (path === "/api/v1/documents/d1/access" && opts?.method === "PUT") {
        if (!opts.body?.dry_run) puts.push(opts.body);
        return Promise.resolve(okAccessUpdate(opts.body));
      }
      if (path.includes("/share-candidates")) return candidatesUnavailable();
      if (path.startsWith("/api/v1/orgs/acme/members")) return Promise.resolve(membersPayload);
      if (path === `/api/v1/orgs/${ORG}/workspaces`) return Promise.resolve(workspacesPayload);
      return Promise.resolve({});
    });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    await pickPerson("Acme");
    fireEvent.click(screen.getByRole("button", { name: t("documents.share.submit") }));

    await waitFor(() => expect(puts.length).toBe(1));
    expect(puts[0]).toEqual({
      items: [{ principal_type: "organization", principal_id: ORG, level: "view" }],
      dry_run: false,
    });
    await waitFor(() => expect(screen.getByRole("button", { name: t("documents.share.submit") })).toHaveAttribute("aria-disabled", "true"));
  });

  it("explains the link limit without leaving the dialog", async () => {
    const { ApiError } = await import("@uniwork/core/api");
    serve({
      createLink: () => Promise.reject(new ApiError("limit", "document_link_limit", 422)),
    });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    fireEvent.click(screen.getByRole("button", { name: t("documents.share.link_create") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(t("documents.share.link_limit"));
  });

  it("points at the settings when the organization switch is off", async () => {
    const { ApiError } = await import("@uniwork/core/api");
    serve({
      createLink: () => Promise.reject(new ApiError("off", "document_links_disabled", 403)),
    });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    fireEvent.click(screen.getByRole("button", { name: t("documents.share.link_create") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(t("documents.share.links_off"));
    expect(screen.getByRole("button", { name: t("documents.share.links_off_action") })).toBeInTheDocument();
  });

  it("revokes a public link", async () => {
    const calls: string[] = [];
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === "/api/v1/documents/d1/shares" && !opts?.method) return Promise.resolve(accessPayload);
      if (opts?.method === "DELETE" && path.includes("/links/")) calls.push(path);
      if (path.includes("/share-candidates")) return candidatesUnavailable();
      if (path.startsWith("/api/v1/orgs/acme/members")) return Promise.resolve(membersPayload);
      return Promise.resolve({});
    });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    const links = screen.getByRole("region", { name: t("documents.share.links_title") });
    const revokeButtons = within(links).getAllByRole("button", { name: new RegExp(`^${t("documents.share.link_revoke")}`) });
    fireEvent.click(revokeButtons[0]!);
    await waitFor(() => expect(calls).toContain("/api/v1/documents/d1/links/l1"));
  });

  it("offers the Comment level in the level picker and submits level='comment'", async () => {
    const puts: any[] = [];
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: any }) => {
      if (path === "/api/v1/documents/d1/shares" && !opts?.method) return Promise.resolve(accessPayload);
      if (path === "/api/v1/documents/d1/access" && opts?.method === "PUT") {
        if (!opts.body?.dry_run) puts.push(opts.body);
        return Promise.resolve(okAccessUpdate(opts.body));
      }
      if (path.includes("/share-candidates")) return candidatesUnavailable();
      if (path.startsWith("/api/v1/orgs/acme/members")) return Promise.resolve(membersPayload);
      if (path === `/api/v1/orgs/${ORG}/workspaces`) return Promise.resolve(workspacesPayload);
      return Promise.resolve({});
    });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    await pickPerson("Bình");
    await pickOption(t("documents.share.level_label"), t("documents.share.level_comment"));
    fireEvent.click(screen.getByRole("button", { name: t("documents.share.submit") }));

    await waitFor(() => expect(puts.length).toBe(1));
    expect(puts[0]).toEqual({
      items: [{ principal_type: "user", principal_id: "u2", level: "comment", on_existing: "keep" }],
      dry_run: false,
    });
  });

  it("shows documents.breakGlass.selfShareError when share fails with 403 break_glass_required", async () => {
    const { ApiError } = await import("@uniwork/core/api");
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === "/api/v1/documents/d1/shares" && !opts?.method) return Promise.resolve(accessPayload);
      if (path === "/api/v1/documents/d1/access" && opts?.method === "PUT") {
        return Promise.reject(new ApiError("break glass required", "break_glass_required", 403));
      }
      if (path.includes("/share-candidates")) return candidatesUnavailable();
      if (path.startsWith("/api/v1/orgs/acme/members")) return Promise.resolve(membersPayload);
      if (path === `/api/v1/orgs/${ORG}/workspaces`) return Promise.resolve(workspacesPayload);
      return Promise.resolve({});
    });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    await pickPerson("Bình");
    fireEvent.click(screen.getByRole("button", { name: t("documents.share.submit") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(t("documents.breakGlass.selfShareError"));
  });

  it("renders active emergency access grants under 'Truy cập khẩn cấp đang mở' and revokes them", async () => {
    const deleted: string[] = [];
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === "/api/v1/documents/d1/shares" && !opts?.method) {
        return Promise.resolve({
          ...accessPayload,
          break_glass: [
            {
              id: "bg1",
              document_id: "d1",
              actor_id: "u9",
              actor_name: "Trần Quản Trị",
              level: "view",
              reason: "Kiểm tra sự cố bảo mật định kỳ",
              granted_at: "2026-10-14T08:00:00Z",
              expires_at: "2026-10-15T08:00:00Z",
            },
          ],
        });
      }
      if (opts?.method === "DELETE" && path.startsWith("/api/v1/documents/d1/break-glass/")) {
        deleted.push(path);
        return Promise.resolve({ status: "ok" });
      }
      if (path.includes("/share-candidates")) return candidatesUnavailable();
      if (path.startsWith("/api/v1/orgs/acme/members")) return Promise.resolve(membersPayload);
      return Promise.resolve({});
    });
    renderDialog();

    const section = await screen.findByTestId("share-break-glass-section");
    expect(within(section).getByText(t("documents.breakGlass.accessPanelSection"))).toBeInTheDocument();
    expect(within(section).getByText(/Trần Quản Trị/)).toBeInTheDocument();
    expect(within(section).getByText(/Kiểm tra sự cố bảo mật định kỳ/)).toBeInTheDocument();

    fireEvent.click(
      within(section).getByRole("button", { name: `${t("documents.breakGlass.revokeButton")} Trần Quản Trị` }),
    );
    await waitFor(() => expect(deleted).toContain("/api/v1/documents/d1/break-glass/bg1"));
  });

  /** Members split over two pages: page 2 holds Minh (u5) and the ACL owner (u9). */
  function servePagedMembers(onPut?: (body: any) => void) {
    const memberPaths: string[] = [];
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: any }) => {
      if (path === "/api/v1/documents/d1/shares" && !opts?.method) {
        return Promise.resolve({ ...accessPayload, acl_owner: { user_id: "u9", level: "manage", via: "member" } });
      }
      if (path === "/api/v1/documents/d1/access" && opts?.method === "PUT") {
        if (!opts.body?.dry_run) onPut?.(opts.body);
        return Promise.resolve(okAccessUpdate(opts.body));
      }
      if (path.includes("/share-candidates")) return candidatesUnavailable();
      if (path.startsWith("/api/v1/orgs/acme/members")) {
        memberPaths.push(path);
        if (path.includes("cursor=c2")) {
          return Promise.resolve({
            members: [
              { user_id: "u5", email: "minh@acme.vn", display_name: "Minh", role: "member", created_at: "" },
              { user_id: "u9", email: "owner@acme.vn", display_name: "Chủ Tài Liệu", role: "owner", created_at: "" },
            ],
            next_cursor: "",
          });
        }
        return Promise.resolve({ ...membersPayload, next_cursor: "c2" });
      }
      if (path === `/api/v1/orgs/${ORG}/workspaces`) return Promise.resolve(workspacesPayload);
      return Promise.resolve({});
    });
    return memberPaths;
  }

  it("loads every member page so a person past the first page is pickable and shared", async () => {
    const bodies: any[] = [];
    const memberPaths = servePagedMembers((body) => bodies.push(body));
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    await pickPerson("Minh");
    fireEvent.click(screen.getByRole("button", { name: t("documents.share.submit") }));

    await waitFor(() =>
      expect(bodies).toEqual([
        {
          items: [{ principal_type: "user", principal_id: "u5", level: "view" }],
          dry_run: false,
        },
      ]),
    );
    expect(memberPaths.some((p) => p.includes("cursor=c2"))).toBe(true);
  });

  it("never shows the ACL owner's raw id, and names them once their page arrives", async () => {
    servePagedMembers();
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    expect(screen.queryByText("u9")).toBeNull();
    expect(await screen.findByText("Chủ Tài Liệu")).toBeInTheDocument();
    expect(screen.queryByText("u9")).toBeNull();
  });

  it("shows a neutral label for an ACL owner who is not a listed member", async () => {
    // accessPayload's owner u1 is not in membersPayload.
    renderDialog();
    expect(await screen.findByText(t("documents.share.person_unknown"))).toBeInTheDocument();
    expect(screen.queryByText("u1")).toBeNull();
  });

  it("keeps a grant row's name in a shrinkable slot with the level text below it", async () => {
    renderDialog();
    const access = await screen.findByRole("region", { name: t("documents.share.access_title") });
    const name = await within(access).findByText("Bình");
    const row = name.closest("li")!;
    expect(name).toHaveClass("truncate");
    // The level/effective caption wraps under the name instead of claiming the
    // row's width beside it (the 390px layout lost the name, TV-2); the
    // Select value shows the same word, so the caption is the span under the
    // name's min-w-0 parent, not a trigger child.
    const level = within(row)
      .getAllByText(new RegExp(`^${t("documents.share.level_view")}`))
      .find((el) => !el.closest("[data-slot='select-trigger']"))!;
    expect(level.closest(".shrink-0")).toBeNull();
    expect(level.parentElement).toBe(name.closest(".min-w-0.flex-1"));
  });

  it("gives the people picker the full row when the principal is a person", async () => {
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));
    const input = screen.getByRole("combobox", { name: t("documents.share.principal_placeholder") });
    expect(input.closest(".sm\\:col-span-2")).not.toBeNull();
  });

  it("keeps disabled submit button in the tab order via aria-disabled and blocks clicks (VIS-SHS1-11)", async () => {
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    const submitBtn = screen.getByRole("button", { name: t("documents.share.submit") });

    expect(submitBtn).not.toBeDisabled();
    expect(submitBtn).toHaveAttribute("aria-disabled", "true");

    const callsBefore = requestMock.mock.calls.length;
    fireEvent.click(submitBtn);
    expect(requestMock.mock.calls.length).toBe(callsBefore);
  });

  it("marks the caller / ACL owner with people_already_shared in the people picker (VIS-SHS1-16)", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/documents/d1/shares") return Promise.resolve(accessPayload);
      if (path.includes("/share-candidates")) return candidatesUnavailable();
      if (path.startsWith("/api/v1/orgs/acme/members")) {
        return Promise.resolve({
          members: [
            { user_id: "u1", email: "an@acme.vn", display_name: "An Chủ Sở Hữu", role: "owner", created_at: "" },
            ...membersPayload.members,
          ],
          next_cursor: "",
        });
      }
      if (path === `/api/v1/orgs/${ORG}/workspaces`) return Promise.resolve(workspacesPayload);
      return Promise.resolve({});
    });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    const input = screen.getByRole("combobox", { name: t("documents.share.principal_placeholder") });
    input.focus();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.change(input, { target: { value: "An Chủ Sở Hữu" } });
    const selfOption = await screen.findByRole("option", { name: /An Chủ Sở Hữu/ });
    expect(selfOption).toHaveTextContent(t("documents.share.people_already_shared"));
  });

  it("translates an unverifiable link-create response via documents.share.link_create_failed instead of raw English (VIS-SHS1-17)", async () => {
    serve({
      // Missing token/url causes useCreateDocumentLink to throw DocumentNotVerifiableError("result not verifiable")
      createLink: () => Promise.resolve({ link: { id: "l9", view_count: 0, created_at: "2026-09-28T03:00:00Z" } }),
    });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    fireEvent.click(screen.getByRole("button", { name: t("documents.share.link_create") }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(t("documents.share.link_create_failed"));
    expect(alert).not.toHaveTextContent(/result not verifiable/i);
  });

  it("renders a generic translated label instead of a raw workspace id when a workspace share is missing from orgWorkspaces (VIS-SHS1-13)", async () => {
    serve({
      access: {
        ...accessPayload,
        shares: [
          {
            id: "s-unknown-ws",
            principal_type: "workspace",
            principal_id: "ws-ns",
            level: "view",
            active: true,
            effective_level: "view",
            granted_by: "u1",
            granted_by_kind: "human",
            created_at: "2026-09-26T03:00:00Z",
          },
        ],
      },
    });
    renderDialog();
    const access = await screen.findByRole("region", { name: t("documents.share.access_title") });
    expect(await within(access).findByText(t("documents.share.workspace_unknown"))).toBeInTheDocument();
    expect(within(access).queryByText("ws-ns")).toBeNull();
  });
});

// DOC7-W02: the "Yêu cầu truy cập" section is the manager side of access
// requests; it mounts for whoever canAdminister() the document and for nobody
// else, and never for an archived one (its decisions would be 409).
describe("ShareDialog requests section (DOC7-W02)", () => {
  const LIST = "/api/v1/documents/d1/access-requests";
  const request = {
    id: "r1",
    requester_id: "u3",
    requester_name: "Chi",
    requested_level: "view",
    message: "Cần xem",
    source: null,
    created_at: "2026-10-15T01:00:00Z",
    expires_at: "2026-11-14T01:00:00Z",
  };

  function serveRequests() {
    serve();
    const base = requestMock.getMockImplementation()!;
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: any }) =>
      path === LIST ? Promise.resolve({ requests: [request] }) : base(path, opts),
    );
  }
  const listed = () => requestMock.mock.calls.some(([path]) => path === LIST);

  it("orders dialog sections as add -> access list -> access requests -> public links (VIS-SHS1-02)", async () => {
    serveRequests();
    renderDialog();
    const requestsHeading = await screen.findByRole("heading", {
      name: t("documents.access_request.section_title", { count: 1 }),
    });
    expect(await screen.findByText("Chi")).toBeInTheDocument();
    const addSection = screen.getByRole("region", { name: t("documents.share.add_title") });
    const accessSection = screen.getByRole("region", { name: t("documents.share.access_title") });
    const requestsSection = requestsHeading.closest("section")!;
    const linksSection = screen.getByRole("region", { name: t("documents.share.links_title") });

    expect(addSection.compareDocumentPosition(accessSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(accessSection.compareDocumentPosition(requestsSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(requestsSection.compareDocumentPosition(linksSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("is there for a pure admin (admin_scope without a level)", async () => {
    serveRequests();
    renderDialog(documentFixture({ my_level: "", admin_scope: true }));
    expect(await screen.findByRole("heading", { name: t("documents.access_request.section_title", { count: 1 }) })).toBeInTheDocument();
  });

  it("is absent, and never read, for someone who cannot administer", async () => {
    serveRequests();
    renderDialog(documentFixture({ my_level: "edit" }));
    expect(await screen.findByText(t("documents.share.manage_only"))).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Yêu cầu truy cập/ })).toBeNull();
    expect(listed()).toBe(false);
  });

  it("is absent, and never read, on an archived document", async () => {
    serveRequests();
    renderDialog(documentFixture({ archived_at: "2026-10-14T00:00:00Z" }));
    await screen.findByText(t("documents.share.access_title"));
    expect(screen.queryByRole("heading", { name: /Yêu cầu truy cập/ })).toBeNull();
    expect(listed()).toBe(false);
  });

  it("takes focus back from the dialog for the requests section when opened from the link", async () => {
    serveRequests();
    render(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={user}>
          <ShareDialog open onOpenChange={() => undefined} wsId={WS} doc={documentFixture()} focusRequests />
        </WorkspaceProvider>,
      ),
    );
    const heading = await screen.findByRole("heading", { name: t("documents.access_request.section_title", { count: 1 }) });
    await waitFor(() => expect(heading).toHaveFocus());
  });
});
