import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import { DocumentSchema, type Document } from "@uniwork/core/types/document";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { ShareDialog } from "./share-dialog";

// review_fe r1 (UNI-1784 fe-fix-1): F-W1-01/02/03/04/07/08/09/11/15 through the
// real dialog, the transport mocked.

const { t } = initI18n();
const WS = "ws1";
const ORG = "o1";
const SHARES = "/api/v1/documents/d1/shares";
const ACCESS = "/api/v1/documents/d1/access";
const CANDIDATES = "/api/v1/documents/d1/share-candidates";

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

function documentFixture(over: Record<string, unknown> = {}): Document {
  const parsed = DocumentSchema.parse({
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
  });
  return {
    ...parsed,
    kind: parsed.kind as Document["kind"],
    visibility: parsed.visibility as Document["visibility"],
    my_level: parsed.my_level as Document["my_level"],
    via: parsed.via as Document["via"],
    owner_kind: parsed.owner_kind as Document["owner_kind"],
    system_kind: parsed.system_kind as Document["system_kind"],
  };
}

const managerAccess = {
  my_level: "manage",
  via: "member",
  acl_owner: { user_id: "u1", level: "manage", via: "member" },
  shares: [],
  links: [],
};

const person = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  principal_type: "user",
  principal_id: id,
  name,
  secondary: `${id}@acme.vn`,
  direct_level: null,
  is_home_workspace: false,
  ...over,
});
const design = { principal_type: "workspace", principal_id: "w2", name: "Design", secondary: "", direct_level: null, is_home_workspace: false };
const acme = { principal_type: "organization", principal_id: "o1", name: "Acme", secondary: "", direct_level: null, is_home_workspace: false };

type Handler = (path: string, opts?: { method?: string; body?: any }) => unknown;

/** Serve the dialog's reads; `extra` answers first and returns `undefined` to fall through. */
function serve(extra: Handler, access: unknown = managerAccess) {
  requestMock.mockReset();
  requestMock.mockImplementation((path: string, opts?: { method?: string; body?: any }) => {
    const answered = extra(path, opts);
    if (answered !== undefined) return answered;
    if (path === SHARES && !opts?.method) return Promise.resolve(access);
    if (path.startsWith("/api/v1/orgs/acme/members")) return Promise.resolve({ members: [], next_cursor: "" });
    if (path === `/api/v1/orgs/${ORG}/workspaces`) return Promise.resolve({ workspaces: [] });
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

const combobox = () => screen.getByRole("combobox", { name: t("documents.share.principal_placeholder") });

function openList() {
  const input = combobox();
  input.focus();
  fireEvent.keyDown(input, { key: "ArrowDown" });
  return input;
}

async function pick(name: string | RegExp) {
  openList();
  const before = screen.queryByRole("list", { name: t("documents.share.people_chosen") })?.children.length ?? 0;
  fireEvent.click(await screen.findByRole("option", { name }));
  await waitFor(() =>
    expect(screen.getByRole("list", { name: t("documents.share.people_chosen") }).children.length).toBe(before + 1),
  );
}

async function pickOption(label: string, option: string | RegExp) {
  await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  const item = await screen.findByRole("option", { name: option });
  fireEvent.pointerDown(item, { pointerType: "mouse" });
  fireEvent.pointerUp(item, { pointerType: "mouse" });
  fireEvent.click(item);
  await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
}

const submit = () => screen.getByRole("button", { name: t("documents.share.submit") });
const updateResult = (body: any, preview = { users: [] as unknown[], groups: [] as unknown[], warnings: [] as unknown[] }) => ({
  batch_id: body?.dry_run ? "" : "01JB",
  dry_run: Boolean(body?.dry_run),
  results: (body?.items ?? []).map((_: unknown, index: number) => ({ index, status: "granted" })),
  preview,
});

beforeEach(() => {
  requestMock.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("non-manager through ShareDialog (F-W1-01, E2E-1)", () => {
  it("reads the overview and shows 'Quyền của bạn' with the caller's own sources, read-only", async () => {
    serve(() => undefined, {
      my_level: "comment",
      via: "share",
      my_sources: [
        { via: "share", principal_type: "user", principal_id: "u1", level: "comment" },
        { via: "member", principal_type: "workspace", principal_id: WS, level: "view" },
      ],
    });
    renderDialog(documentFixture({ my_level: "comment" }));

    expect(await screen.findByText(t("documents.share.my_level", { level: t("documents.share.level_comment") }))).toBeInTheDocument();
    expect(screen.getByText(t("documents.share.source_item", { level: t("documents.share.level_comment"), source: t("documents.share.via_share") }))).toBeInTheDocument();
    expect(requestMock.mock.calls.some(([p]) => p === SHARES)).toBe(true);
    expect(screen.queryByRole("region", { name: t("documents.share.add_title") })).toBeNull();
    expect(screen.queryByRole("region", { name: t("documents.share.links_title") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("documents.share.submit") })).toBeNull();
  });

  it("shows the error and retry block when GET /shares fails for a non-manager (N-02)", async () => {
    let failed = true;
    serve((path) => {
      if (path === SHARES) {
        if (failed) return Promise.reject(new ApiError("boom", "internal_error", 500));
        return Promise.resolve({
          my_level: "view",
          via: "share",
          my_sources: [{ via: "share", principal_type: "user", principal_id: "u1", level: "view" }],
        });
      }
      return undefined;
    });
    renderDialog(documentFixture({ my_level: "view" }));

    expect(await screen.findByText(t("documents.share.error"))).toBeInTheDocument();
    failed = false;
    fireEvent.click(screen.getByRole("button", { name: t("documents.share.retry") }));
    expect(await screen.findByText(t("documents.share.my_level", { level: t("documents.share.level_view") }))).toBeInTheDocument();
  });
});

describe("candidate list (F-W1-03, F-W1-04, F-W1-13)", () => {
  it("follows next_cursor from a 'more' row so the groups behind the people are reachable", async () => {
    const paths: string[] = [];
    serve((path) => {
      if (!path.startsWith(CANDIDATES)) return undefined;
      paths.push(path);
      return Promise.resolve(
        path.includes("cursor=c2")
          ? { items: [design, acme], next_cursor: null }
          : { items: [person("u2", "Bình"), person("u3", "Chi")], next_cursor: "c2" },
      );
    });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    openList();
    await screen.findByRole("option", { name: /Bình/ });
    expect(screen.queryByRole("option", { name: /Design/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: t("documents.share.candidates_more") }));
    expect(await screen.findByRole("option", { name: /Design/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Acme/ })).toBeInTheDocument();
    expect(paths.some((p) => p.includes("cursor=c2"))).toBe(true);
    await waitFor(() => expect(screen.queryByRole("button", { name: t("documents.share.candidates_more") })).toBeNull());
  });

  it("shows an empty server answer as 'no result', never the local directory", async () => {
    serve((path) => {
      if (path.startsWith(CANDIDATES)) return Promise.resolve({ items: [], next_cursor: "" });
      if (path.startsWith("/api/v1/orgs/acme/members")) {
        return Promise.resolve({
          members: [{ user_id: "u2", email: "binh@acme.vn", display_name: "Bình", role: "member", created_at: "" }],
          next_cursor: "",
        });
      }
      return undefined;
    });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    openList();
    expect(await screen.findByText(t("documents.share.principal_empty"))).toBeInTheDocument();
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("uses the local directory only when the endpoint is unavailable", async () => {
    serve((path) => {
      if (path.startsWith(CANDIDATES)) return Promise.reject(new ApiError("not found", "not_found", 404));
      if (path.startsWith("/api/v1/orgs/acme/members")) {
        return Promise.resolve({
          members: [{ user_id: "u2", email: "binh@acme.vn", display_name: "Bình", role: "member", created_at: "" }],
          next_cursor: "",
        });
      }
      return undefined;
    });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    openList();
    expect(await screen.findByRole("option", { name: /Bình/ })).toBeInTheDocument();
  });

  it("shows an inline error with retry when the first candidates page fails non-404, never the empty state (R3-01)", async () => {
    let failed = true;
    serve((path) => {
      if (!path.startsWith(CANDIDATES)) return undefined;
      if (failed) return Promise.reject(new ApiError("server error", "internal_error", 500));
      return Promise.resolve({ items: [person("u2", "Bình")], next_cursor: "" });
    });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    expect(await screen.findByText(t("documents.share.candidates_error"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("documents.share.retry") })).toBeInTheDocument();
    const input = combobox();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.queryByText(t("documents.share.principal_empty"))).toBeNull();

    failed = false;
    fireEvent.click(screen.getByRole("button", { name: t("documents.share.retry") }));
    expect(await screen.findByRole("option", { name: /Bình/ })).toBeInTheDocument();
    expect(screen.queryByText(t("documents.share.candidates_error"))).toBeNull();
  });
  it("keeps the loaded first page and offers retry when the second page fails, without swapping to the local list (N-01)", async () => {
    let failNext = true;
    serve((path) => {
      if (path.startsWith("/api/v1/orgs/acme/members")) {
        return Promise.resolve({
          members: [{ user_id: "u9", email: "local@acme.vn", display_name: "Người Cục Bộ", role: "member", created_at: "" }],
          next_cursor: "",
        });
      }
      if (!path.startsWith(CANDIDATES)) return undefined;
      if (path.includes("cursor=c2")) {
        if (failNext) return Promise.reject(new ApiError("server error", "internal_error", 500));
        return Promise.resolve({ items: [design, acme], next_cursor: null });
      }
      return Promise.resolve({ items: [person("u2", "Bình")], next_cursor: "c2" });
    });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    openList();
    await screen.findByRole("option", { name: /Bình/ });
    expect(screen.queryByRole("option", { name: /Người Cục Bộ/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: t("documents.share.candidates_more") }));
    const retryBtn = await screen.findByRole("button", { name: t("documents.share.retry") });
    expect(screen.getByRole("option", { name: /Bình/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Người Cục Bộ/ })).toBeNull();
    // TV1-10: the failed row says what failed, next to its Retry button.
    expect(screen.getByText(t("documents.share.candidates_error"))).toBeInTheDocument();

    failNext = false;
    fireEvent.click(retryBtn);
    expect(await screen.findByRole("option", { name: /Design/ })).toBeInTheDocument();
    // TV1-10: the listbox stayed open while the page retried and loaded.
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Bình/ })).toBeInTheDocument();
  });

  it("does not re-filter the server's hits by the live query (a hit on another field stays)", async () => {
    serve((path) =>
      path.startsWith(CANDIDATES)
        ? Promise.resolve({ items: [person("u2", "Bình", { secondary: "kinhdoanh@acme.vn" })], next_cursor: "" })
        : undefined,
    );
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    const input = openList();
    await screen.findByRole("option", { name: /Bình/ });
    // The query matches neither the name nor the secondary text as typed; the
    // server answered it, so its row stays while the debounce has not fired.
    fireEvent.change(input, { target: { value: "zzz-phòng ban" } });
    expect(screen.getByRole("option", { name: /Bình/ })).toBeInTheDocument();
  });
});

describe("the add section's write (F-W1-02, F-W1-07, F-W1-08, F-W1-09, F-W1-15)", () => {
  it("drops a shown preview when a chip's on_existing changes, and commits what the new preview describes", async () => {
    const bodies: any[] = [];
    serve((path, opts) => {
      if (path.startsWith(CANDIDATES)) return Promise.resolve({ items: [person("u2", "Bình", { direct_level: "view" })], next_cursor: "" });
      if (path === ACCESS && opts?.method === "PUT") {
        bodies.push(opts.body);
        return Promise.resolve(
          updateResult(opts.body, {
            users: [{ user_id: "u2", before: { level: "view", via: "share" }, after: { level: "edit", via: "member" } }],
            groups: [],
            warnings: [{ code: "direct_below_group", index: 0 }],
          }),
        );
      }
      return undefined;
    });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));
    await pick(/Bình/);

    fireEvent.click(submit());
    const box = await screen.findByTestId("share-add-confirm");
    expect(box).toHaveTextContent("vẫn có quyền Chỉnh sửa qua thành viên workspace");

    await pickOption(
      `Bình ${t("documents.share.candidate_has_access", { level: t("documents.share.level_view") })}`,
      t("documents.share.on_existing_update", { level: t("documents.share.level_view") }),
    );
    expect(screen.queryByTestId("share-add-confirm")).toBeNull();
    expect(bodies.filter((b) => !b.dry_run)).toHaveLength(0);

    fireEvent.click(submit());
    await screen.findByTestId("share-add-confirm");
    fireEvent.click(within(screen.getByTestId("share-add-confirm")).getByRole("button", { name: t("documents.share.confirm_accept") }));
    await waitFor(() => expect(bodies.filter((b) => !b.dry_run)).toHaveLength(1));
    expect(bodies.at(-1)).toEqual({
      items: [{ principal_type: "user", principal_id: "u2", level: "view", on_existing: "update" }],
      dry_run: false,
    });
  });

  it("runs one dry_run and one write for two fast clicks on Chia sẻ", async () => {
    const bodies: any[] = [];
    serve((path, opts) => {
      if (path.startsWith(CANDIDATES)) return Promise.resolve({ items: [person("u2", "Bình")], next_cursor: "" });
      if (path === ACCESS && opts?.method === "PUT") {
        bodies.push(opts.body);
        return Promise.resolve(updateResult(opts.body));
      }
      return undefined;
    });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));
    await pick(/Bình/);

    // Both clicks land before React renders `isPending`, as in the gap between
    // the dry_run resolving and the write starting.
    const button = submit();
    act(() => {
      button.click();
      button.click();
    });
    await waitFor(() => expect(bodies.filter((b) => !b.dry_run)).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(bodies.filter((b) => b.dry_run)).toHaveLength(1);
    expect(bodies.filter((b) => !b.dry_run)).toHaveLength(1);
  });

  it("says at the level choice that the home workspace and the organization get Edit when Manage is picked", async () => {
    serve((path) =>
      path.startsWith(CANDIDATES) ? Promise.resolve({ items: [person("u2", "Bình"), acme], next_cursor: "" }) : undefined,
    );
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));
    await pick(/Bình/);
    await pick(/Acme/);

    expect(screen.queryByText(t("documents.share.level_manage_capped_hint"))).toBeNull();
    await pickOption(t("documents.share.level_label"), t("documents.share.level_manage"));
    expect(screen.getByText(t("documents.share.level_manage_capped_hint"))).toBeInTheDocument();
  });

  it("words a downgrade (or an unknown warning code) on a workspace as the group sentence", async () => {
    serve((path, opts) => {
      if (path.startsWith(CANDIDATES)) return Promise.resolve({ items: [{ ...design, direct_level: "edit" }], next_cursor: "" });
      if (path === ACCESS && opts?.method === "PUT") {
        return Promise.resolve(
          updateResult(opts.body, {
            users: [],
            groups: [{ principal_type: "workspace", principal_id: "w2", member_count: 12, losing_count: 3 }],
            warnings: [{ code: "brand_new_code", index: 0 }],
          }),
        );
      }
      return undefined;
    });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));
    await pick(/Design/);

    fireEvent.click(submit());
    expect(await screen.findByTestId("share-add-confirm")).toHaveTextContent(
      t("documents.share.warning_downgrade_group", {
        name: "Design",
        before: t("documents.share.level_edit"),
        after: t("documents.share.level_view"),
        count: 12,
      }),
    );
  });

  it("marks only the chip the 422 names when its index is not the principal's list position", async () => {
    serve((path, opts) => {
      if (path.startsWith(CANDIDATES)) {
        return Promise.resolve({ items: [person("u2", "Bình"), person("u3", "Chi")], next_cursor: "" });
      }
      if (path === ACCESS && opts?.method === "PUT") {
        return Promise.reject(
          new ApiError("rejected", "document_access_rejected", 422, undefined, {
            rejected: [{ index: 1, principal_type: "user", principal_id: "u2", code: "level_not_allowed" }],
          }),
        );
      }
      return undefined;
    });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));
    // Chi first, Bình second: the rejected item is request index 1 and is Bình.
    await pick(/Chi/);
    await pick(/Bình/);

    fireEvent.click(submit());
    expect(await screen.findByTestId("rejected-reason-u2")).toHaveTextContent(t("documents.share.rejected_level_not_allowed"));
    expect(screen.queryByTestId("rejected-reason-u3")).toBeNull();
  });

  it("labels a rejection code a newer server adds with a neutral sentence", async () => {
    serve((path, opts) => {
      if (path.startsWith(CANDIDATES)) return Promise.resolve({ items: [person("u2", "Bình")], next_cursor: "" });
      if (path === ACCESS && opts?.method === "PUT") {
        return Promise.reject(
          new ApiError("rejected", "document_access_rejected", 422, undefined, {
            rejected: [{ index: 0, principal_type: "user", principal_id: "u2", code: "quota_exceeded" }],
          }),
        );
      }
      return undefined;
    });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));
    await pick(/Bình/);

    fireEvent.click(submit());
    expect(await screen.findByTestId("rejected-reason-u2")).toHaveTextContent(t("documents.share.rejected_unknown"));
  });
});

describe("dialog order (F-W1-11)", () => {
  it("places the emergency-access section after the access list, inside Area 2", async () => {
    serve(() => undefined, {
      ...managerAccess,
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
    renderDialog();
    const breakGlass = await screen.findByTestId("share-break-glass-section");
    const addSection = screen.getByRole("region", { name: t("documents.share.add_title") });
    const accessSection = screen.getByRole("region", { name: t("documents.share.access_title") });
    const linksSection = screen.getByRole("region", { name: t("documents.share.links_title") });

    expect(addSection.compareDocumentPosition(accessSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(accessSection.compareDocumentPosition(breakGlass) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(breakGlass.compareDocumentPosition(linksSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
