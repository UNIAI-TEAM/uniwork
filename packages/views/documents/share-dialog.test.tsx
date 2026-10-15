import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { configureRuntime, resetRuntimeConfig } from "@uniwork/core/runtime-config";
import { DocumentSchema, type Document } from "@uniwork/core/types/document";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { ShareDialog } from "./share-dialog";

const { t } = initI18n();

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
    owner_kind: parsed.owner_kind as Document["owner_kind"],
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

function serve(over: Options = {}) {
  requestMock.mockReset();
  requestMock.mockImplementation((path: string, opts?: { method?: string; body?: any }) => {
    if (path === "/api/v1/documents/d1/shares" && !opts?.method) {
      return Promise.resolve(over.access ?? accessPayload);
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
    expect(screen.getByText(t("documents.share.acl_owner"))).toBeInTheDocument();
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

  it("keeps a failed read with a retry", async () => {
    let fail = true;
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === "/api/v1/documents/d1/shares" && !opts?.method) {
        if (fail) return Promise.reject(new Error("offline"));
        return Promise.resolve(accessPayload);
      }
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
    const posts: any[] = [];
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: any }) => {
      if (path === "/api/v1/documents/d1/shares" && !opts?.method) return Promise.resolve(accessPayload);
      if (path === "/api/v1/documents/d1/shares" && opts?.method === "POST") {
        posts.push(opts.body);
        return Promise.resolve({ share: { id: "s9", principal_id: opts.body.principal_id, level: opts.body.level } });
      }
      if (path.startsWith("/api/v1/orgs/acme/members")) return Promise.resolve(membersPayload);
      if (path === `/api/v1/orgs/${ORG}/workspaces`) return Promise.resolve(workspacesPayload);
      return Promise.resolve({});
    });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    await pickOption(t("documents.share.principal_label"), t("documents.share.principal_workspace"));
    await pickOption(t("documents.share.principal_placeholder"), "Design");
    await pickOption(t("documents.share.level_label"), t("documents.share.level_edit"));
    fireEvent.click(screen.getByRole("button", { name: t("documents.share.submit") }));

    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0]).toEqual({ principal_type: "workspace", principal_id: "w2", level: "edit" });
  });

  it("keeps the picked people and shows the message when the batch fails", async () => {
    serve({ shareFails: true });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    await pickPerson("Bình");
    fireEvent.click(screen.getByRole("button", { name: t("documents.share.submit") }));

    expect(await screen.findByRole("alert")).toHaveTextContent("share failed");
    expect(screen.getByRole("button", { name: t("documents.share.people_remove", { name: "Bình" }) })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("documents.share.submit") })).toBeEnabled();
  });

  it("shares three people at one level with ONE batch POST and lists the three grants", async () => {
    const posts: { path: string; body: any }[] = [];
    let granted: unknown[] = [];
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: any }) => {
      if (path === "/api/v1/documents/d1/shares" && !opts?.method) {
        return Promise.resolve({ ...accessPayload, shares: granted });
      }
      if (opts?.method === "POST") {
        posts.push({ path, body: opts.body });
        granted = opts.body.principal_ids.map((id: string, i: number) => ({
          id: `s${i + 10}`,
          principal_type: "user",
          principal_id: id,
          level: opts.body.level,
          active: true,
        }));
        return Promise.resolve({ shares: granted });
      }
      if (path.startsWith("/api/v1/orgs/acme/members")) return Promise.resolve(threeMembersPayload);
      return Promise.resolve({});
    });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    await pickPerson("Bình");
    await pickPerson("Chi");
    await pickPerson("Dũng");
    expect(screen.getByText(t("documents.share.people_selected", { count: 3 }))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("documents.share.submit") }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      path: "/api/v1/documents/d1/shares/batch",
      body: { principal_ids: ["u2", "u3", "u4"], level: "view" },
    });
    const access = screen.getByRole("region", { name: t("documents.share.access_title") });
    for (const name of ["Bình", "Chi", "Dũng"]) {
      expect(
        await within(access).findByRole("button", { name: `${t("documents.share.revoke")} ${name}` }),
      ).toBeInTheDocument();
    }
    // Success clears the selection for the next batch.
    expect(screen.queryByRole("list", { name: t("documents.share.people_chosen") })).toBeNull();
    expect(screen.getByRole("button", { name: t("documents.share.submit") })).toBeDisabled();
  });

  it("names the refused person on a 422 principal_not_in_organization and lists nothing new", async () => {
    const { ApiError } = await import("@uniwork/core/api");
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: any }) => {
      if (path === "/api/v1/documents/d1/shares" && !opts?.method) return Promise.resolve(accessPayload);
      if (path === "/api/v1/documents/d1/shares/batch" && opts?.method === "POST") {
        return Promise.reject(
          new ApiError("not in organization", "principal_not_in_organization", 422, undefined, {
            principal_ids: ["u3"],
          }),
        );
      }
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
    expect(screen.getByRole("button", { name: t("documents.share.submit") })).toBeDisabled();
  });

  it("drops the picked people when the principal type moves away from person", async () => {
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    await pickPerson("Chi");
    await pickOption(t("documents.share.principal_label"), t("documents.share.principal_workspace"));
    await pickOption(t("documents.share.principal_label"), t("documents.share.principal_user"));

    expect(screen.queryByRole("list", { name: t("documents.share.people_chosen") })).toBeNull();
    expect(screen.getByRole("button", { name: t("documents.share.submit") })).toBeDisabled();
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
    await waitFor(() => expect(screen.queryByText(t("documents.share.title"))).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "reopen" }));
    await screen.findByText(t("documents.share.access_title"));

    expect(screen.queryByRole("list", { name: t("documents.share.people_chosen") })).toBeNull();
  });

  it("revokes one grant without touching the others", async () => {
    const calls: string[] = [];
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === "/api/v1/documents/d1/shares" && !opts?.method) return Promise.resolve(accessPayload);
      if (opts?.method === "DELETE") calls.push(path);
      if (path.startsWith("/api/v1/orgs/acme/members")) return Promise.resolve(membersPayload);
      return Promise.resolve({});
    });
    renderDialog();

    fireEvent.click(await screen.findByRole("button", { name: `${t("documents.share.revoke")} Bình` }));
    await waitFor(() => expect(calls).toContain("/api/v1/documents/d1/shares/s1"));
  });

  it("saves a visibility change on the revision it read", async () => {
    const patches: any[] = [];
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: any }) => {
      if (path === "/api/v1/documents/d1/shares" && !opts?.method) return Promise.resolve(accessPayload);
      if (path === "/api/v1/documents/d1" && opts?.method === "PATCH") {
        patches.push(opts.body);
        return Promise.resolve({ document: documentFixture({ visibility: opts.body.visibility }) });
      }
      if (path.startsWith("/api/v1/orgs/acme/members")) return Promise.resolve(membersPayload);
      return Promise.resolve({});
    });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.share.visibility_restricted")) }));
    fireEvent.click(screen.getByRole("button", { name: t("documents.share.visibility_save") }));

    await waitFor(() => expect(patches.length).toBe(1));
    expect(patches[0]).toEqual({ visibility: "restricted", revision: "7" });
  });

  it("keeps a failed visibility change with its message", async () => {
    serve({ visibilityFails: true });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.share.visibility_restricted")) }));
    fireEvent.click(screen.getByRole("button", { name: t("documents.share.visibility_save") }));

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

  it("keeps the organization picked after an organization grant", async () => {
    const posts: any[] = [];
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: any }) => {
      if (path === "/api/v1/documents/d1/shares" && !opts?.method) return Promise.resolve(accessPayload);
      if (path === "/api/v1/documents/d1/shares" && opts?.method === "POST") {
        posts.push(opts.body);
        return Promise.resolve({ share: { id: "s9", principal_id: opts.body.principal_id, level: opts.body.level } });
      }
      if (path.startsWith("/api/v1/orgs/acme/members")) return Promise.resolve(membersPayload);
      if (path === `/api/v1/orgs/${ORG}/workspaces`) return Promise.resolve(workspacesPayload);
      return Promise.resolve({});
    });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    await pickOption(t("documents.share.principal_label"), t("documents.share.principal_organization"));
    fireEvent.click(screen.getByRole("button", { name: t("documents.share.submit") }));

    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0]).toEqual({ principal_type: "organization", principal_id: ORG, level: "view" });
    await waitFor(() => expect(screen.getByRole("button", { name: t("documents.share.submit") })).toBeEnabled());
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

  /** Members split over two pages: page 2 holds Minh (u5) and the ACL owner (u9). */
  function servePagedMembers(onPost?: (body: any) => void) {
    const memberPaths: string[] = [];
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: any }) => {
      if (path === "/api/v1/documents/d1/shares" && !opts?.method) {
        return Promise.resolve({ ...accessPayload, acl_owner: { user_id: "u9", level: "manage", via: "member" } });
      }
      if (path === "/api/v1/documents/d1/shares/batch" && opts?.method === "POST") {
        onPost?.(opts.body);
        return Promise.resolve({ shares: [] });
      }
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

    await waitFor(() => expect(bodies).toEqual([{ principal_ids: ["u5"], level: "view" }]));
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
    // The level/effective text wraps under the name instead of claiming the
    // row's width beside it (the 390px layout lost the name, TV-2).
    const level = within(row).getByText(new RegExp(`^${t("documents.share.level_view")}`));
    expect(level.closest(".shrink-0")).toBeNull();
    expect(level.parentElement).toBe(name.closest(".min-w-0.flex-1"));
  });

  it("gives the people picker the full row when the principal is a person", async () => {
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));
    const input = screen.getByRole("combobox", { name: t("documents.share.principal_placeholder") });
    expect(input.closest(".sm\\:col-span-2")).not.toBeNull();
  });
});
