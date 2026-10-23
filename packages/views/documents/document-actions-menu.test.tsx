import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { usePageExportUnavailable } from "@uniwork/core/documents/hooks";
import { documentKeys } from "@uniwork/core/documents/keys";
import { initI18n } from "@uniwork/core/i18n";
import { DocumentSchema, type Document } from "@uniwork/core/types/document";
import type { User, Workspace } from "@uniwork/core/types";
import { useAiPanelStore } from "@uniwork/core/ai";
import { capabilities } from "../ai/ask-uni-fixtures";
import { WorkspaceProvider } from "../layout/workspace-context";
import { fakeNav, requestMock, wrapWithNav } from "../test/api-mock";
import { FeatureFlagService, FeatureFlagsProvider, StaticProvider } from "@uniwork/core/feature-flags";
import { DropdownMenuItem } from "@uniwork/ui/components/ui/dropdown-menu";
import { HeaderActionsFill, HeaderActionsSlot, HeaderActionsSlotProvider } from "../layout/header-actions-slot";
import { DocumentActionsMenu } from "./document-actions-menu";
import { DocumentFileMenuItems, type DocumentFileActions } from "./document-file-actions";
import { DocumentHeaderActions } from "./document-header-actions";
import { DocumentCommentsHeaderActions, DocumentCommentsProvider, documentCommentsTitleKey } from "./document-comments-context";

const { t } = initI18n();

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), loading: vi.fn(() => "toast-1"), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

/** The labelled action a sonner toast option carries (our shelve undo). */
interface ToastAction {
  label: string;
  onClick?: () => void;
}
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
      kind: "file",
      title: "Báo cáo Q4",
      revision: "3",
      current_version: 1,
      my_level: "manage",
      file: {
        file_id: "f1",
        version_id: "v1",
        version: 1,
        filename: "bao-cao.pdf",
        mime_type: "application/pdf",
        size_bytes: 1024,
        checksum_sha256: "a".repeat(64),
      },
      ...over,
    }),
  );
}

function renderMenu(
  doc: Document = documentFixture(),
  over: { onArchived?: () => void; nav?: ReturnType<typeof fakeNav> } = {},
) {
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <DocumentActionsMenu wsId={WS} doc={doc} onArchived={over.onArchived} />
      </WorkspaceProvider>,
      over.nav,
    ),
  );
}

async function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: t("documents.actions.menu_label") }));
  await screen.findByRole("menuitem", { name: t("documents.actions.versions") });
}

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation(() => Promise.resolve({}));
  usePageExportUnavailable.setState({ formats: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("DocumentActionsMenu with an embedded editor", () => {
  it("lists the editor's entries and a phone-only Comments entry that toggles the panel", async () => {
    const doc = documentFixture();
    const service = new FeatureFlagService(new StaticProvider({ documents: { default: true } }));
    render(
      wrapWithNav(
        <FeatureFlagsProvider service={service}>
          <WorkspaceProvider workspace={workspace} user={user}>
            <DocumentCommentsProvider wsId={WS} doc={doc}>
              <HeaderActionsSlotProvider>
                <HeaderActionsSlot />
                <HeaderActionsFill
                  actions={<button type="button">office-save</button>}
                  menuItems={<DropdownMenuItem>editor-entry</DropdownMenuItem>}
                />
                <DocumentCommentsHeaderActions />
                <DocumentActionsMenu wsId={WS} doc={doc} />
              </HeaderActionsSlotProvider>
            </DocumentCommentsProvider>
          </WorkspaceProvider>
        </FeatureFlagsProvider>,
      ),
    );
    await screen.findByRole("button", { name: "office-save" });
    // The trigger and the phone menu entry carry the panel's own name (S12/S13).
    const label = t(documentCommentsTitleKey(doc));
    const trigger = screen.getByRole("button", { name: label });
    expect(trigger.closest("[data-document-comments-actions]")).toHaveClass("hidden", "sm:flex");
    await openMenu();
    expect(screen.getByRole("menuitem", { name: "editor-entry" })).toBeInTheDocument();
    const comments = screen.getByRole("menuitem", { name: label });
    expect(comments).toHaveClass("sm:hidden");
    fireEvent.click(comments);
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
  });
});

describe("DocumentHeaderActions", () => {
  function mount(flags: Record<string, { default: boolean }>) {
    requestMock.mockImplementation((path: unknown) =>
      Promise.resolve(String(path).endsWith("/ai/capabilities") ? capabilities() : {}),
    );
    useAiPanelStore.setState({ open: false, pendingFocus: null });
    const doc = documentFixture();
    const service = new FeatureFlagService(new StaticProvider({ ask_uni_stream: { default: true }, ...flags }));
    render(
      wrapWithNav(
        <FeatureFlagsProvider service={service}>
          <WorkspaceProvider workspace={workspace} user={user}>
            <DocumentCommentsProvider wsId={WS} doc={doc}>
              <DocumentHeaderActions />
            </DocumentCommentsProvider>
          </WorkspaceProvider>
        </FeatureFlagsProvider>,
      ),
    );
    return doc;
  }

  it("opens Ask UNI focused on this document", async () => {
    const doc = mount({ documents: { default: true } });
    fireEvent.click(await screen.findByRole("button", { name: "Hỏi UNI về tài liệu này" }));
    expect(useAiPanelStore.getState().pendingFocus).toEqual({ kind: "document", id: doc.id, label: doc.title });
  });

  it("still shows Ask UNI when comments are disabled", async () => {
    const doc = mount({ documents: { default: false } });
    expect(await screen.findByRole("button", { name: "Hỏi UNI về tài liệu này" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t(documentCommentsTitleKey(doc)) })).toBeNull();
  });
});

describe("DocumentActionsMenu", () => {
  it("offers every manage/edit surface on a live file document", async () => {
    renderMenu();
    await openMenu();

    expect(screen.getByRole("menuitem", { name: t("documents.actions.share") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.actions.access_log") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.actions.copy") })).toBeInTheDocument();
    const archive = screen.getByRole("menuitem", { name: t("documents.actions.archive") });
    // The destructive entry sits apart, after a separator.
    expect(archive.previousElementSibling).toHaveAttribute("role", "separator");
    expect(screen.queryByRole("menuitem", { name: t("documents.actions.restore") })).toBeNull();
  });

  it("keeps every item it renders at 44px on coarse pointers", async () => {
    renderMenu();
    await openMenu();
    for (const name of ["share", "access_log", "copy", "archive"]) {
      expect(screen.getByRole("menuitem", { name: t(`documents.actions.${name}`) })).toHaveClass("pointer-coarse:min-h-11");
    }
  });

  it("hides share, links, archive and copy on an owned document", async () => {
    renderMenu(documentFixture({ owner_kind: "work_product", owner_id: "wp1" }));
    await openMenu();

    expect(screen.getByRole("menuitem", { name: t("documents.actions.versions") })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t("documents.actions.share") })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("documents.actions.copy") })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("documents.actions.archive") })).toBeNull();
  });

  it("offers no Share on a folder (UNI-1974: only documents are shared)", async () => {
    const { file: _file, ...rest } = documentFixture() as Document & { file?: unknown };
    void _file;
    renderMenu({ ...rest, kind: "folder" } as Document);
    await openMenu();

    expect(screen.queryByRole("menuitem", { name: t("documents.actions.share") })).toBeNull();
  });

  it("keeps a viewer to the read surfaces plus the read-only Share dialog", async () => {
    renderMenu(documentFixture({ my_level: "view" }));
    await openMenu();

    expect(screen.getByRole("menuitem", { name: t("documents.actions.versions") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.actions.share") })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t("documents.actions.access_log") })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("documents.actions.archive") })).toBeNull();
  });

  // DOC6-W01 (access addendum §2.5, N-01): only Share moves to the
  // canAdminister() gate; logs, archive and copy keep theirs.
  it("opens Share to a break-glass admin (view + admin_scope) and keeps logs and archive at manage", async () => {
    renderMenu(documentFixture({ my_level: "view", admin_scope: true }));
    await openMenu();

    expect(screen.getByRole("menuitem", { name: t("documents.actions.share") })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t("documents.actions.access_log") })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("documents.actions.archive") })).toBeNull();

    fireEvent.click(screen.getByRole("menuitem", { name: t("documents.actions.share") }));
    expect(await screen.findByRole("dialog", { name: t("documents.share.title_named", { title: "Báo cáo Q4" }) })).toBeInTheDocument();
    expect(screen.getByText(t("documents.share.admin_scope_note"))).toBeInTheDocument();
  });

  // E2E-1 / U-SH4 (access addendum §5.2): every reader opens Share. A reader who
  // cannot administer sees "Quyền của bạn" and their own sources, never the add
  // area, other people's rows or links.
  it("opens Share for an editor without admin_scope as a read-only 'Quyền của bạn' card", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/documents/d1/shares") {
        return Promise.resolve({
          my_level: "edit",
          via: "share",
          my_sources: [{ via: "share", principal_type: "user", principal_id: "u1", level: "edit" }],
        });
      }
      return Promise.resolve({});
    });
    renderMenu(documentFixture({ my_level: "edit" }));
    await openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: t("documents.actions.share") }));
    const dialog = await screen.findByRole("dialog", { name: t("documents.share.title_named", { title: "Báo cáo Q4" }) });
    expect(await within(dialog).findByText(t("documents.share.my_level", { level: t("documents.share.level_edit") }))).toBeInTheDocument();
    expect(within(dialog).getByText(t("documents.share.source_item", { level: t("documents.share.level_edit"), source: t("documents.share.via_share") }))).toBeInTheDocument();
    expect(within(dialog).queryByRole("region", { name: t("documents.share.add_title") })).toBeNull();
    expect(within(dialog).queryByRole("region", { name: t("documents.share.links_title") })).toBeNull();
    expect(requestMock.mock.calls.some(([path]) => String(path).endsWith("/documents/settings"))).toBe(false);
  });

  it("offers restore instead of archive in the trash", async () => {
    renderMenu(documentFixture({ archived_at: "2026-09-27T03:00:00Z" }));
    await openMenu();

    expect(screen.getByRole("menuitem", { name: t("documents.actions.restore") })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t("documents.actions.archive") })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("documents.actions.share") })).toBeNull();
  });

  it("opens the version history sheet", async () => {
    renderMenu(documentFixture({ kind: "page" }));
    await openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: t("documents.actions.versions") }));
    expect(await screen.findByText(t("documents.versions.title"))).toBeInTheDocument();
  });

  it("opens the archive dialog with its impact read", async () => {
    requestMock.mockImplementation((path: string) =>
      path.startsWith("/api/v1/workspaces/ws1/documents/tree")
        ? Promise.resolve({ documents: [] })
        : Promise.resolve({}),
    );
    renderMenu();
    await openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: t("documents.actions.archive") }));
    // The title and the confirm button share the trash wording since the rename, so ask for the heading.
    expect(await screen.findByRole("heading", { name: t("documents.archive.archive_title") })).toBeInTheDocument();
  });

  it("drops the copy entry once the deployment answers 404", async () => {
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === "/api/v1/documents/d1/copies" && opts?.method === "POST") {
        return Promise.reject(new ApiError("missing", "not_found", 404));
      }
      return Promise.resolve({});
    });
    renderMenu();
    await openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: t("documents.actions.copy") }));
    fireEvent.click(await screen.findByRole("checkbox", { name: t("documents.copy.consent_label") }));
    fireEvent.click(screen.getByRole("button", { name: t("documents.copy.submit") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(t("documents.copy.unavailable"));

    fireEvent.click(screen.getByRole("button", { name: t("common.cancel") }));
    await waitFor(() => expect(screen.queryByText(t("documents.copy.title"))).toBeNull());

    await openMenu();
    expect(screen.queryByRole("menuitem", { name: t("documents.actions.copy") })).toBeNull();
  });

  // ARCHIVE-01 (UNI-1845) U-4: the header menu's "Lưu trữ" and the pruned set
  // a shelved document keeps.
  it("offers Lưu trữ to a manager on a live document and hides it from an editor, My Folder and a shelved document", async () => {
    const first = renderMenu();
    await openMenu();
    expect(screen.getByRole("menuitem", { name: t("documents.shelved_list.shelve") })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });
    first.unmount();

    const second = renderMenu(documentFixture({ my_level: "edit" }));
    await openMenu();
    expect(screen.queryByRole("menuitem", { name: t("documents.shelved_list.shelve") })).toBeNull();
    fireEvent.keyDown(document.body, { key: "Escape" });
    second.unmount();

    const third = renderMenu(documentFixture({ system_kind: "my_folder" }));
    await openMenu();
    expect(screen.queryByRole("menuitem", { name: t("documents.shelved_list.shelve") })).toBeNull();
    third.unmount();

    renderMenu(documentFixture({ shelved_at: "2026-10-10T03:00:00Z", shelved_by: "u2" }));
    await openMenu();
    expect(screen.queryByRole("menuitem", { name: t("documents.shelved_list.shelve") })).toBeNull();
  });
  it("shelves a live document at once and the toast's undo unshelves it", async () => {
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === "/api/v1/documents/d1/shelve" && opts?.method === "POST") {
        return Promise.resolve({ document: documentFixture({ shelved_at: "2026-10-10T03:00:00Z" }), affected: ["d1"] });
      }
      if (path === "/api/v1/documents/d1/unshelve" && opts?.method === "POST") {
        return Promise.resolve({ document: documentFixture(), affected: ["d1"] });
      }
      return Promise.resolve({});
    });
    renderMenu();
    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: t("documents.shelved_list.shelve") }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        t("documents.shelved_list.toast.shelved", { title: "Báo cáo Q4" }),
        expect.objectContaining({ action: expect.objectContaining({ label: t("documents.shelved_list.undo") }) }),
      ),
    );
    // ExternalToast.action's runtime shape is our ToastAction; the click is the undo.
    const action = vi.mocked(toast.success).mock.calls.at(-1)?.[1]?.action as ToastAction | undefined;
    action?.onClick?.();
    await waitFor(() =>
      expect(requestMock.mock.calls.some(([path, opts]) => path === "/api/v1/documents/d1/unshelve" && (opts as { method?: string })?.method === "POST")).toBe(true),
    );
  });

  it("keeps only open-adjacent, read and manage actions on a shelved document (U-4 keep-list)", async () => {
    renderMenu(documentFixture({ shelved_at: "2026-10-10T03:00:00Z", shelved_by: "u2" }));
    await openMenu();

    // Kept: version history (a read), Share (the revoke surface, U-9), copy,
    // Bỏ lưu trữ and Chuyển vào thùng rác (both manage).
    expect(screen.getByRole("menuitem", { name: t("documents.actions.versions") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.actions.share") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.actions.copy") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.shelved_list.unshelve") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.actions.archive") })).toBeInTheDocument();
    // Hidden: the access log is a manage surface the keep-list does not name,
    // and "Lưu trữ" no longer applies.
    expect(screen.queryByRole("menuitem", { name: t("documents.actions.access_log") })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("documents.shelved_list.shelve") })).toBeNull();
  });
  // RAR-04: the header's Lưu trữ / Bỏ lưu trữ follow canManageTrashed (manage or admin_scope), like the banner and the shelf row.
  it("offers Lưu trữ and Bỏ lưu trữ to a break-glass admin (view + admin_scope)", async () => {
    const live = renderMenu(documentFixture({ my_level: "view", admin_scope: true }));
    await openMenu();
    expect(screen.getByRole("menuitem", { name: t("documents.shelved_list.shelve") })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });
    live.unmount();

    renderMenu(documentFixture({ my_level: "view", admin_scope: true, shelved_at: "2026-10-10T03:00:00Z", shelved_by: "u2" }));
    await openMenu();
    expect(screen.getByRole("menuitem", { name: t("documents.shelved_list.unshelve") })).toBeInTheDocument();
  });

  // F6: a shelved file keeps the editor slot's Tải xuống bản gốc and Sao chép (same gates as live); only the upload goes.
  it("keeps download and copy on a shelved file whose editor fills the menu read-only", async () => {
    const doc = documentFixture({ my_level: "edit", shelved_at: "2026-10-10T03:00:00Z", shelved_by: "u2" });
    const actions: DocumentFileActions = { download: vi.fn(() => Promise.resolve()), downloading: null, openUpload: vi.fn(), uploadDialog: null };
    render(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={user}>
          <HeaderActionsSlotProvider>
            <HeaderActionsFill menuItems={<DocumentFileMenuItems actions={actions} readonly />} />
            <DocumentActionsMenu wsId={WS} doc={doc} />
          </HeaderActionsSlotProvider>
        </WorkspaceProvider>,
      ),
    );
    await openMenu();
    expect(screen.getByRole("menuitem", { name: t("documents.actions.copy") })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t("documents.actions.upload_version") })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: t("documents.actions.download_original") }));
    expect(actions.download).toHaveBeenCalled();
  });
});

describe("DocumentActionsMenu ?access=requests (DOC7-W02)", () => {
  const URL = "/acme/team/documents/d1?access=requests";
  const request = {
    id: "r1",
    requester_id: "u3",
    requester_name: "Chi",
    requested_level: "view",
    message: "",
    source: null,
    created_at: "2026-10-15T01:00:00Z",
    expires_at: "2026-11-14T01:00:00Z",
  };

  beforeEach(() => {
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/documents/d1/access-requests") return Promise.resolve({ requests: [request] });
      if (path === "/api/v1/documents/d1/shares") {
        return Promise.resolve({ my_level: "manage", acl_owner: null, shares: [], links: [] });
      }
      return Promise.resolve({});
    });
  });

  it("opens Share at the requests section for a manager, focuses its heading, then drops the parameter", async () => {
    const nav = fakeNav(URL);
    renderMenu(documentFixture(), { nav });
    const dialog = await screen.findByRole("dialog", { name: t("documents.share.title_named", { title: "Báo cáo Q4" }) });
    const heading = await within(dialog).findByRole("heading", {
      name: t("documents.access_request.section_title", { count: 1 }),
    });
    await waitFor(() => expect(heading).toHaveFocus());
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/acme/team/documents/d1"));
  });

  it("opens for a break-glass admin (view + admin_scope)", async () => {
    renderMenu(documentFixture({ my_level: "view", admin_scope: true }), { nav: fakeNav(URL) });
    const dialog = await screen.findByRole("dialog", { name: t("documents.share.title_named", { title: "Báo cáo Q4" }) });
    expect(await within(dialog).findByText("Chi")).toBeInTheDocument();
  });

  it("drops the parameter silently for someone who cannot administer", async () => {
    const nav = fakeNav(URL);
    renderMenu(documentFixture({ my_level: "edit" }), { nav });
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/acme/team/documents/d1"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("drops the parameter without opening the dialog on an archived document", async () => {
    const nav = fakeNav(URL);
    renderMenu(documentFixture({ archived_at: "2026-09-27T03:00:00Z" }), { nav });
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/acme/team/documents/d1"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});


describe("DocumentActionsMenu page export (UNI-2004)", () => {
  const page = () => documentFixture({ kind: "page", file: null, title: "Biên bản họp", my_level: "view" });
  /** `flags` for the host; the page's organization answers `orgFlags` (by default the same). */
  const renderWithFlags = (
    doc: Document,
    flags: Record<string, { default: boolean }>,
    orgFlags: Record<string, boolean> = Object.fromEntries(Object.entries(flags).map(([key, flag]) => [key, flag.default])),
    served: readonly string[] | null = ["docx", "pdf"],
  ) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["office-public-config", ORG], { flags: orgFlags });
    // The deployment renders both unless a test asks the server (served = null).
    if (served) client.setQueryData(documentKeys.pageExportFormats(WS, doc.id), served);
    return render(
      wrapWithNav(
        <FeatureFlagsProvider service={new FeatureFlagService(new StaticProvider(flags))}>
          <WorkspaceProvider workspace={workspace} user={user}>
            <DocumentActionsMenu wsId={WS} doc={doc} />
          </WorkspaceProvider>
        </FeatureFlagsProvider>,
        undefined,
        client,
      ),
    );
  };
  // follow-6: what the server answers for the formats it renders.
  const formats = (list: unknown) =>
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(path === "/api/v1/documents/d1/export" ? { formats: list } : {}),
    );
  const stubSave = () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:page"), revokeObjectURL: vi.fn() });
    return vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  };

  it("lets a reader export a page as DOCX and saves the file under the server's name", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("PK", { status: 200, headers: { "Content-Disposition": 'attachment; filename="bien-ban.docx"' } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const click = stubSave();
    renderWithFlags(page(), { page_export: { default: true } });
    await openMenu();
    expect(screen.getByRole("menuitem", { name: t("documents.actions.export_pdf") })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: t("documents.actions.export_docx") }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/v1/documents/d1/export");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ format: "docx" });
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe("bien-ban.docx");
    expect(toast.loading).toHaveBeenCalledWith(t("documents.actions.exporting", { format: "DOCX" }));
    expect(toast.dismiss).toHaveBeenCalledWith("toast-1");
  });

  it("names a file the server did not name after the title, without path characters", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("%PDF-", { status: 200 })));
    const click = stubSave();
    renderWithFlags(documentFixture({ kind: "page", file: null, title: 'Q4/2026: "Kế hoạch"', my_level: "view" }), {
      page_export: { default: true },
    });
    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: t("documents.actions.export_pdf") }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe("Q4-2026- -Kế hoạch-.pdf");
  });

  it("runs one export at a time: the items wait while one is under way", async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    toast.loading.mockClear();
    stubSave();
    renderWithFlags(page(), { page_export: { default: true } });
    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: t("documents.actions.export_docx") }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await openMenu();
    const docx = screen.getByRole("menuitem", { name: t("documents.actions.export_docx") });
    expect(docx).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(docx);
    fireEvent.click(screen.getByRole("menuitem", { name: t("documents.actions.export_pdf") }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(toast.loading).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a retryable engine failure says to try again", 503, { code: "engine_overloaded", fields: { retryable: true } }, "export_failed"],
    ["a permanent failure gives a next step, not try-again", 409, { code: "invalid_transition", fields: { retryable: false } }, "export_failed_permanent"],
    ["a page too large to render says so", 413, { code: "upload_bounds", error_class: "quota", fields: { retryable: false } }, "export_too_large"],
  ])("%s", async (_name, status, error, key) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "x", ...error } }), { status, headers: { "Content-Type": "application/json" } }),
      ),
    );
    stubSave();
    renderWithFlags(page(), { page_export: { default: true } });
    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: t("documents.actions.export_docx") }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(t(`documents.actions.${key}`, { format: "DOCX" }), { id: "toast-1" }),
    );
  });

  it("says the server cannot export the format when the PDF renderer is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "engine_incompatible", message: "docs_pdf_assets_missing" } }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    stubSave();
    const { unmount } = renderWithFlags(page(), { page_export: { default: true } });
    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: t("documents.actions.export_pdf") }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(t("documents.actions.export_unavailable", { format: "PDF" }), { id: "toast-1" }),
    );
    // The deployment cannot render that format: the menu stops offering it, and keeps the other.
    await openMenu();
    expect(screen.queryByRole("menuitem", { name: t("documents.actions.export_pdf") })).toBeNull();
    expect(screen.getByRole("menuitem", { name: t("documents.actions.export_docx") })).toBeInTheDocument();
    // For a while: a menu mounted again, on any page, still leaves it out.
    unmount();
    renderWithFlags(page(), { page_export: { default: true } });
    await openMenu();
    expect(screen.queryByRole("menuitem", { name: t("documents.actions.export_pdf") })).toBeNull();
  });

  it("offers PDF only where the engine has the Docs renderer, and DOCX alone on an unreadable answer (follow-6)", async () => {
    formats(["docx"]);
    const { unmount } = renderWithFlags(page(), { page_export: { default: true } }, undefined, null);
    await openMenu();
    expect(await screen.findByRole("menuitem", { name: t("documents.actions.export_docx") })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t("documents.actions.export_pdf") })).toBeNull();
    unmount();
    formats("docx, pdf");
    renderWithFlags(page(), { page_export: { default: true } }, undefined, null);
    await openMenu();
    expect(await screen.findByRole("menuitem", { name: t("documents.actions.export_docx") })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t("documents.actions.export_pdf") })).toBeNull();
  });

  it("reads page_export where the export route does: at the page's organization", async () => {
    const { unmount } = renderWithFlags(page(), { page_export: { default: false } }, { page_export: true });
    await openMenu();
    expect(screen.getByRole("menuitem", { name: t("documents.actions.export_docx") })).toBeInTheDocument();
    unmount();
    renderWithFlags(page(), { page_export: { default: true } }, { page_export: false });
    await openMenu();
    expect(screen.queryByRole("menuitem", { name: t("documents.actions.export_docx") })).toBeNull();
  });

  it("offers no export when page_export is off, or on a file document", async () => {
    const { unmount } = renderWithFlags(page(), { page_export: { default: false } });
    await openMenu();
    expect(screen.queryByRole("menuitem", { name: t("documents.actions.export_docx") })).toBeNull();
    unmount();
    renderWithFlags(documentFixture(), { page_export: { default: true } });
    await openMenu();
    expect(screen.queryByRole("menuitem", { name: t("documents.actions.export_docx") })).toBeNull();
  });
});

describe("DocumentActionsMenu ?panel=versions (UNI-2012)", () => {
  it("opens the version history for any reader, then drops the parameter", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith("/api/v1/documents/d1/versions")) return Promise.resolve({ versions: [], next_cursor: null });
      return Promise.resolve({});
    });
    const nav = fakeNav("/acme/team/documents/d1?panel=versions");
    renderMenu(documentFixture({ my_level: "view" }), { nav });
    expect(await screen.findByText(t("documents.versions.title"))).toBeInTheDocument();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/acme/team/documents/d1"));
  });
});
