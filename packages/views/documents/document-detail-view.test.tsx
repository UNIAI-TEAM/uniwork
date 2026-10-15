import { useQueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import {
  FeatureFlagsProvider,
  FeatureFlagService,
  StaticProvider,
} from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import { DocumentSchema, type Document } from "@uniwork/core/types/document";
import { fakeNav, requestMock, wrapWithNav } from "../test/api-mock";
import { useReportFrameComments } from "./document-comments-context";
import { DocumentDetailView } from "./document-detail-view";

const { t } = initI18n();

const WS = "ws1";
const LIBRARY = "/acme/doi/documents";

function withFlag(ui: React.ReactElement, on = true, nav?: ReturnType<typeof fakeNav>) {
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: on } }));
  return wrapWithNav(<FeatureFlagsProvider service={service}>{ui}</FeatureFlagsProvider>, nav);
}

/** The wire schema parses server enums leniently; the exported type narrows them. */
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

function pageDocument(over: Record<string, unknown> = {}): Document {
  return narrowDocument(DocumentSchema.parse({
    id: "d1",
    workspace_id: WS,
    organization_id: "org1",
    kind: "page",
    title: "Kế hoạch Q3",
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Nội dung A" }] }],
    },
    content_text: "Nội dung A",
    revision: "3",
    current_version: 1,
    my_level: "edit",
    created_at: "2026-09-28T03:00:00Z",
    updated_at: "2026-09-28T03:00:00Z",
    ...over,
  }));
}

/** The editor arrives through React.lazy; the first TipTap import is slow. */
function findEditor() {
  return screen.findByRole("textbox", { name: t("documents.editor.aria_label") }, { timeout: 15_000 });
}

function renderView(
  documentId = "d1",
  onBackToList = vi.fn(),
  on = true,
  hrefs: {
    documentHref?: (id: string) => string;
    ownerHref?: (id: string) => string;
  } = {},
) {
  return {
    onBackToList,
    ...render(
      withFlag(
        <DocumentDetailView
          wsId={WS}
          documentId={documentId}
          libraryHref={LIBRARY}
          documentHref={hrefs.documentHref}
          ownerHref={hrefs.ownerHref}
          onBackToList={onBackToList}
        />,
        on,
      ),
    ),
  };
}

beforeEach(() => {
  requestMock.mockReset();
});

describe("DocumentDetailView", () => {
  it("stays behind its flag once the config answered that it is off", async () => {
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(path.startsWith("/api/v1/config") ? { flags: { documents: false }, rum_sample_rate: 0 } : { document: pageDocument() }),
    );
    renderView("d1", vi.fn(), false);
    expect(await screen.findByText(t("documents.page.off_title"))).toBeInTheDocument();
    expect(requestMock.mock.calls.filter(([path]) => !String(path).startsWith("/api/v1/config"))).toHaveLength(0);
  });

  it("says it could not check when the config call fails", async () => {
    requestMock.mockRejectedValue(new ApiError("boom", "internal", 500));
    renderView("d1", vi.fn(), false);
    expect(await screen.findByText(t("documents.page.unknown_title"))).toBeInTheDocument();
    expect(screen.queryByText(t("documents.page.off_title"))).toBeNull();
    expect(screen.getByRole("button", { name: t("documents.page.unknown_retry") })).toBeInTheDocument();
  });

  it("shows a skeleton while the working copy is loading", async () => {
    requestMock.mockImplementation(() => new Promise(() => {}));
    renderView();
    await waitFor(() => expect(document.querySelector("[aria-busy='true']")).toBeTruthy());
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("says a document is not found without confirming the id exists", async () => {
    requestMock.mockRejectedValue(new ApiError("not found", "not_found", 404));
    const { onBackToList } = renderView();

    expect(await screen.findByText(t("documents.detail.not_found"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("documents.detail.retry") })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: t("documents.detail.back_to_library") }));
    expect(onBackToList).toHaveBeenCalled();
  });

  it("offers a failed load again instead of calling the document missing", async () => {
    requestMock.mockRejectedValue(new ApiError("boom", "internal", 500));
    renderView();

    expect(await screen.findByText(t("documents.detail.load_error"))).toBeInTheDocument();
    expect(screen.queryByText(t("documents.detail.not_found"))).toBeNull();

    const before = requestMock.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: t("documents.detail.retry") }));
    await waitFor(() => expect(requestMock.mock.calls.length).toBeGreaterThan(before));
  });

  it("hides the content when read access is gone", async () => {
    requestMock.mockRejectedValue(new ApiError("forbidden", "forbidden", 403));
    renderView();

    expect(await screen.findByText(t("documents.detail.revoked_title"))).toBeInTheDocument();
    expect(screen.queryByText("Kế hoạch Q3")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("opens a page in the editor, on the working copy the server returned", async () => {
    requestMock.mockResolvedValue({ document: pageDocument() });
    renderView();

    expect(await screen.findByRole("textbox", { name: t("documents.page_ui.title_label") })).toHaveValue("Kế hoạch Q3");
    const surface = await findEditor();
    expect(surface).toHaveAttribute("contenteditable", "true");
    expect(surface).toHaveTextContent("Nội dung A");
    // The breadcrumb points at the library, never at invented ancestors.
    expect(screen.getByRole("link", { name: t("documents.detail.breadcrumb_library") })).toHaveAttribute(
      "href",
      LIBRARY,
    );
  });

  it("links every readable ancestor the server sent, and invents none", async () => {
    // The server truncates the chain at the first unreadable ancestor: the
    // client renders exactly that list, so an unreadable page never leaks a
    // title—and a readable page above it is not guessed back in either.
    requestMock.mockResolvedValue({
      document: pageDocument({
        breadcrumbs: [
          { id: "p1", title: "Mục lục" },
          { id: "p2", title: "Quý 3" },
        ],
      }),
    });
    renderView("d1", vi.fn(), true, { documentHref: (id) => `/acme/doi/documents/${id}` });

    expect(await screen.findByRole("link", { name: "Tài liệu" })).toHaveAttribute("href", LIBRARY);
    expect(await screen.findByRole("link", { name: "Mục lục" })).toHaveAttribute(
      "href",
      "/acme/doi/documents/p1",
    );
    expect(screen.getByRole("link", { name: "Quý 3" })).toHaveAttribute(
      "href",
      "/acme/doi/documents/p2",
    );
    expect(screen.queryByRole("link", { name: "Cấp trên bị ẩn" })).toBeNull();
  });

  it("starts a Work Product document at its owner instead of the library", async () => {
    requestMock.mockResolvedValue({
      document: pageDocument({
        owner_kind: "work_product",
        owner_id: "wp1",
        // An owned document is not in the tree; the server has no ancestors.
        breadcrumbs: [],
      }),
    });
    renderView("d1", vi.fn(), true, { ownerHref: (id) => `/acme/doi/projects/${id}` });

    expect(await screen.findByRole("link", { name: t("documents.detail.breadcrumb_work_product") }))
      .toHaveAttribute("href", "/acme/doi/projects/wp1");
    expect(screen.queryByRole("link", { name: t("documents.detail.breadcrumb_library") })).toBeNull();
    expect(
      screen.getByRole("button", { name: t("documents.detail.back_to_owner") }),
    ).toBeInTheDocument();
  });

  it("never guesses a URL for an owned document's owner chain", async () => {
    requestMock.mockResolvedValue({
      document: pageDocument({ owner_kind: "work_product", owner_id: "wp1", breadcrumbs: [] }),
    });
    // Until C-14 ships a work-product route the app passes no ownerHref.
    renderView();

    const crumb = await screen.findByText(t("documents.detail.breadcrumb_work_product"));
    expect(crumb.closest("a")).toBeNull();
    expect(
      screen.queryByRole("link", { name: t("documents.detail.breadcrumb_library") }),
    ).toBeNull();
    // The library does not list owned documents, so it is not offered as a
    // way back either.
    expect(
      screen.queryByRole("button", { name: t("documents.detail.back_to_library") }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: t("documents.detail.back_to_owner") })).toBeNull();
  });

  it("keeps a view-only document readable but not editable", async () => {
    requestMock.mockResolvedValue({ document: pageDocument({ my_level: "view" }) });
    renderView();

    expect(await screen.findByText(t("documents.detail.readonly_description"))).toBeInTheDocument();
    const surface = await findEditor();
    expect(surface).toHaveAttribute("contenteditable", "false");
  });

  it("never writes one document's bytes into the document the user switched to", async () => {
    const pendingPatch: { resolve: ((value: unknown) => void) | null } = { resolve: null };
    const patches: string[] = [];
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (opts?.method === "PATCH") {
        patches.push(path);
        return new Promise((resolve) => {
          pendingPatch.resolve = resolve;
        });
      }
      if (path === "/api/v1/documents/d2") {
        return Promise.resolve({
          document: pageDocument({
            id: "d2",
            title: "Tài liệu B",
            revision: "7",
            content: {
              type: "doc",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Nội dung B" }] }],
            },
          }),
        });
      }
      return Promise.resolve({ document: pageDocument() });
    });

    const view = renderView("d1");
    const surface = await findEditor();
    fireEvent.paste(surface, {
      clipboardData: { files: [], getData: (type: string) => (type === "text/plain" ? "A" : "") },
    });
    // Autosave debounces for two seconds before it patches.
    await waitFor(() => expect(patches).toEqual(["/api/v1/documents/d1"]), { timeout: 8_000 });

    // Switch documents while the first document's save is still in flight.
    view.rerender(
      withFlag(
        <DocumentDetailView
          wsId={WS}
          documentId="d2"
          libraryHref={LIBRARY}
          onBackToList={vi.fn()}
        />,
      ),
    );
    const next = await screen.findByRole("textbox", { name: t("documents.page_ui.title_label") });
    await waitFor(() => expect(next).toHaveValue("Tài liệu B"));

    // The answer to the abandoned save arrives late; it must not be written
    // anywhere, and nothing may be sent for the new document.
    pendingPatch.resolve?.({ document: pageDocument({ revision: "4" }) });
    await waitFor(() => expect(screen.getByRole("textbox", { name: t("documents.editor.aria_label") })).toHaveTextContent("Nội dung B"), {
      timeout: 8_000,
    });
    expect(patches).toEqual(["/api/v1/documents/d1"]);
  });

  it("mounts the comments rail and its header trigger when the flag is on", async () => {
    // Desktop rail, not the modal sheet: a modal marks the rest of the page
    // aria-hidden, which would hide the header controls from role queries.
    window.innerWidth = 1400;
    requestMock.mockResolvedValue({ document: pageDocument() });
    renderView();
    await screen.findByRole("textbox", { name: t("documents.page_ui.title_label") });

    // The header owns the trigger; the panel is closed until it is used.
    // A page has no anchored comments: the panel is the Discussion alone (Foundation G8).
    const trigger = screen.getByRole("button", { name: t("documents.collab.collabDiscussion") });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("document-comments-pane")).toBeNull();

    fireEvent.click(trigger);

    expect(await screen.findByTestId("document-comments-pane")).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    // The favorite star rides the same header actions and reads the server list.
    expect(
      await screen.findByRole("button", { name: t("documents.comments.favorite_add") }),
    ).toBeInTheDocument();
  });

  it("renders no DocumentCommentsPanel once the editor frame serves comments (invariant 8)", async () => {
    window.innerWidth = 1400;
    const file = pageDocument({
      kind: "file",
      title: "Báo cáo",
      content: undefined,
      file: { file_id: "f1", version_id: "v2", version: 2, filename: "bao-cao.docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size_bytes: 1024, checksum_sha256: "a".repeat(64) },
    });
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/documents/d1") return Promise.resolve({ document: file });
      if (path.startsWith("/api/v1/config")) return Promise.resolve({ flags: { office_engine: true, office_docx: true } });
      if (path.startsWith("/api/v1/documents/d1/comments")) return Promise.resolve({ comments: [], mentions: [], list_token: "lt1:a" });
      return Promise.resolve({ versions: [], next_cursor: null, favorites: [] });
    });
    // The host stands in for OfficeModuleFrame: its handshake reports `comments` the way the
    // web host wires onFrameCommentsChange to this hook.
    function FrameHost() {
      const report = useReportFrameComments();
      return <button type="button" onClick={() => report?.(true)}>frame-acked</button>;
    }
    const nav = fakeNav("/acme/doi/documents/d1");
    nav.searchParams = new URLSearchParams("comment=c1");
    render(withFlag(
      <DocumentDetailView wsId={WS} documentId="d1" libraryHref={LIBRARY} onBackToList={vi.fn()} officeEditorHost={FrameHost} />,
      true,
      nav,
    ));
    // Before the frame says anything, the deep link opens the page's own panel.
    expect(await screen.findByTestId("document-comments-pane")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("documents.comments.title") })).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "frame-acked" }));

    await waitFor(() => expect(screen.queryByTestId("document-comments-pane")).toBeNull());
    // No second way in either: the header trigger is gone with it.
    expect(screen.queryByRole("button", { name: t("documents.comments.title") })).toBeNull();
  });

  it("brings the page's comments trigger back once the frame that served them is gone", async () => {
    window.innerWidth = 1400;
    const file = pageDocument({
      kind: "file",
      title: "Báo cáo",
      content: undefined,
      file: { file_id: "f1", version_id: "v2", version: 2, filename: "bao-cao.docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size_bytes: 1024, checksum_sha256: "a".repeat(64) },
    });
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/documents/d1") return Promise.resolve({ document: file });
      if (path.startsWith("/api/v1/config")) return Promise.resolve({ flags: { office_engine: true, office_docx: true } });
      if (path.startsWith("/api/v1/documents/d1/comments")) return Promise.resolve({ comments: [], mentions: [], list_token: "lt1:a" });
      return Promise.resolve({ versions: [], next_cursor: null, favorites: [] });
    });
    // Reports the way OfficeModuleFrame does: its claim on mount, taken back on unmount.
    function Frame() {
      const report = useReportFrameComments();
      useEffect(() => {
        report?.(true);
        return () => report?.(false);
      }, [report]);
      return <p>frame</p>;
    }
    function FrameHost() {
      const [shown, setShown] = useState(true);
      return (
        <>
          {shown ? <Frame /> : null}
          <button type="button" onClick={() => setShown(false)}>drop-frame</button>
        </>
      );
    }
    render(withFlag(
      <DocumentDetailView wsId={WS} documentId="d1" libraryHref={LIBRARY} onBackToList={vi.fn()} officeEditorHost={FrameHost} />,
      true,
      fakeNav("/acme/doi/documents/d1"),
    ));
    await screen.findByText("frame");
    await waitFor(() => expect(screen.queryByRole("button", { name: t("documents.comments.title") })).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "drop-frame" }));

    expect(await screen.findByRole("button", { name: t("documents.comments.title") })).toBeInTheDocument();
  });

  it("renders DocumentLockedCard on 403 document_restricted (initial load and rollout cut) without leaking content", async () => {
    let locked = false;
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/documents/d1") {
        if (locked) {
          return Promise.reject(
            new ApiError(
              "restricted",
              "document_restricted",
              403,
              undefined,
              { can_break_glass: true },
              "permission",
            ),
          );
        }
        return Promise.resolve({ document: pageDocument({ title: "Tài liệu Hạn chế", content_text: "BÍ MẬT" }) });
      }
      if (path === "/api/v1/documents/d1/admin-summary") {
        return Promise.resolve({
          document: {
            id: "d1",
            workspace_id: WS,
            kind: "page",
            title: "Tài liệu Hạn chế",
            visibility: "restricted",
            size_bytes: 4096,
            updated_at: "2026-10-14T10:00:00Z",
          },
          acl_owner: { user_id: "Nguyễn Chủ Sở Hữu", level: "manage" },
          my_level: "manage",
          admin_scope: true,
          my_grant: null,
        });
      }
      return Promise.resolve({});
    });

    function RolloutCutTrigger() {
      const qc = useQueryClient();
      return (
        <button type="button" onClick={() => void qc.invalidateQueries({ queryKey: ["documents"] })}>
          invalidate-docs
        </button>
      );
    }

    render(
      withFlag(
        <>
          <RolloutCutTrigger />
          <DocumentDetailView wsId={WS} documentId="d1" libraryHref={LIBRARY} onBackToList={vi.fn()} />
        </>,
      ),
    );
    const surface = await findEditor();
    expect(surface).toHaveTextContent("Nội dung A");

    // Simulate rollout cut / revoked grant while tab is open
    locked = true;
    fireEvent.click(screen.getByRole("button", { name: "invalidate-docs" }));

    expect(await screen.findByTestId("document-locked-card")).toBeInTheDocument();
    expect(screen.getByText(t("documents.breakGlass.lockedTitle"))).toBeInTheDocument();
    expect(screen.queryByText("Nội dung A")).toBeNull();
    expect(screen.queryByText("BÍ MẬT")).toBeNull();
    expect(screen.getByLabelText(t("documents.breakGlass.reasonLabel"))).toBeInTheDocument();
  });

  it("hides the break-glass form on 403 document_restricted when can_break_glass is false", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/documents/d1") {
        return Promise.reject(
          new ApiError(
            "restricted",
            "document_restricted",
            403,
            undefined,
            { can_break_glass: false },
            "permission",
          ),
        );
      }
      if (path === "/api/v1/documents/d1/admin-summary") {
        return Promise.resolve({
          document: { id: "d1", workspace_id: WS, kind: "page", title: "Tài liệu Khóa", visibility: "restricted", size_bytes: 512 },
          acl_owner: null,
          my_level: "manage",
          admin_scope: true,
          my_grant: null,
        });
      }
      return Promise.resolve({});
    });

    renderView("d1");
    expect(await screen.findByTestId("document-locked-card")).toBeInTheDocument();
    expect(screen.queryByLabelText(t("documents.breakGlass.reasonLabel"))).toBeNull();
    expect(screen.queryByRole("button", { name: t("documents.breakGlass.confirmButton") })).toBeNull();
  });

  it("grants break-glass to transition into read-only view with 24h banner, and revokes on End access", async () => {
    let hasGrant = false;
    const deletedPaths: string[] = [];
    const futureIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: any }) => {
      if (path === "/api/v1/documents/d1" && !opts?.method) {
        if (!hasGrant) {
          return Promise.reject(
            new ApiError(
              "restricted",
              "document_restricted",
              403,
              undefined,
              { can_break_glass: true },
              "permission",
            ),
          );
        }
        return Promise.resolve({
          document: pageDocument({
            my_level: "view",
            via: "break_glass",
            break_glass_expires_at: futureIso,
          } as any),
        });
      }
      if (path === "/api/v1/documents/d1/admin-summary") {
        return Promise.resolve({
          document: { id: "d1", workspace_id: WS, kind: "page", title: "Kế hoạch Q3", visibility: "restricted", size_bytes: 1024 },
          acl_owner: { user_id: "u1", level: "manage" },
          my_level: "manage",
          admin_scope: true,
          my_grant: hasGrant
            ? {
                id: "bg-77",
                document_id: "d1",
                actor_id: "admin-1",
                actor_name: "Admin",
                level: "view",
                reason: "Kiểm tra sự cố hệ thống khẩn cấp",
                granted_at: "2026-10-14T10:00:00Z",
                expires_at: futureIso,
              }
            : null,
        });
      }
      if (path === "/api/v1/documents/d1/break-glass" && opts?.method === "POST") {
        hasGrant = true;
        return Promise.resolve({
          grant: {
            id: "bg-77",
            document_id: "d1",
            actor_id: "admin-1",
            actor_name: "Admin",
            level: "view",
            reason: opts.body.reason,
            granted_at: "2026-10-14T10:00:00Z",
            expires_at: futureIso,
          },
        });
      }
      if (path === "/api/v1/documents/d1/break-glass/bg-77" && opts?.method === "DELETE") {
        hasGrant = false;
        deletedPaths.push(path);
        return Promise.resolve({ status: "ok" });
      }
      return Promise.resolve({ versions: [], next_cursor: null, favorites: [] });
    });

    renderView("d1");
    expect(await screen.findByTestId("document-locked-card")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(t("documents.breakGlass.reasonLabel")), {
      target: { value: "Kiểm tra sự cố hệ thống khẩn cấp" },
    });
    fireEvent.click(screen.getByRole("button", { name: t("documents.breakGlass.confirmButton") }));

    expect(await screen.findByTestId("break-glass-active-banner")).toBeInTheDocument();
    const surface = await findEditor();
    expect(surface).toHaveAttribute("contenteditable", "false");

    fireEvent.click(screen.getByRole("button", { name: t("documents.breakGlass.endAccessButton") }));
    await waitFor(() => expect(deletedPaths).toContain("/api/v1/documents/d1/break-glass/bg-77"));
    expect(await screen.findByTestId("document-locked-card")).toBeInTheDocument();
    expect(screen.getByTestId("break-glass-expired-banner")).toBeInTheDocument();
  });

  it("opens the access panel on the break-glass section when ?access=break_glass is in the URL", async () => {
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === "/api/v1/documents/d1" && !opts?.method) {
        return Promise.resolve({ document: pageDocument({ my_level: "manage" }) });
      }
      if (path === "/api/v1/documents/d1/shares" && !opts?.method) {
        return Promise.resolve({
          document_id: "d1",
          visibility: "restricted",
          my_level: "manage",
          acl_owner: { user_id: "u1", level: "manage" },
          shares: [],
          break_glass: [
            {
              id: "bg-1",
              document_id: "d1",
              actor_id: "u9",
              actor_name: "Lê Quản Trị",
              level: "view",
              reason: "Rà soát quyền truy cập theo yêu cầu",
              granted_at: "2026-10-14T09:00:00Z",
              expires_at: "2026-10-15T09:00:00Z",
            },
          ],
        });
      }
      return Promise.resolve({ versions: [], next_cursor: null, favorites: [], members: [], workspaces: [] });
    });

    const nav = fakeNav("/acme/doi/documents/d1");
    nav.searchParams = new URLSearchParams("access=break_glass");
    render(
      withFlag(
        <DocumentDetailView
          wsId={WS}
          documentId="d1"
          libraryHref={LIBRARY}
          onBackToList={vi.fn()}
        />,
        true,
        nav,
      ),
    );

    const section = await screen.findByTestId("share-break-glass-section");
    expect(section).toHaveTextContent(t("documents.breakGlass.accessPanelSection"));
    expect(section).toHaveTextContent("Lê Quản Trị");
  });
});

describe("DocumentDetailView break-glass (R21 H2, H3, M1, M5)", () => {
  const restricted = () =>
    new ApiError("restricted", "document_restricted", 403, undefined, { can_break_glass: true }, "permission");
  const grantBody = (id: string, expires: string) => ({
    id,
    document_id: "d1",
    actor_id: "admin-1",
    actor_name: "Admin",
    level: "view",
    reason: "Kiểm tra sự cố hệ thống khẩn cấp",
    granted_at: "2026-10-14T10:00:00Z",
    expires_at: expires,
  });
  const summaryBody = (over: Record<string, unknown> = {}) => ({
    document: { id: "d1", workspace_id: WS, kind: "page", title: "Kế hoạch Q3", visibility: "restricted", size_bytes: 1024 },
    acl_owner: { user_id: "01HOWNERULID", level: "manage" },
    my_level: "",
    admin_scope: true,
    my_grant: null,
    ...over,
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ends the real grant from the admin summary after a reload, never a placeholder id (H3)", async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const calls: string[] = [];
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === "/api/v1/documents/d1" && !opts?.method) {
        return Promise.resolve({
          document: pageDocument({ my_level: "view", via: "break_glass", break_glass_expires_at: future } as never),
        });
      }
      if (path === "/api/v1/documents/d1/admin-summary") {
        return Promise.resolve(summaryBody({ my_level: "view", my_grant: grantBody("bg-88", future) }));
      }
      if (opts?.method === "DELETE") {
        calls.push(path);
        return Promise.resolve({ status: "ok" });
      }
      return Promise.resolve({ versions: [], next_cursor: null, favorites: [] });
    });
    renderView("d1");
    const end = await screen.findByRole("button", { name: t("documents.breakGlass.endAccessButton") });
    await waitFor(() => expect(end).toBeEnabled());
    fireEvent.click(end);
    await waitFor(() => expect(calls).toEqual(["/api/v1/documents/d1/break-glass/bg-88"]));
    expect(calls.join()).not.toContain("current");
  });

  it("sends no request and says so when no grant id can be found (H3)", async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const deletes: string[] = [];
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === "/api/v1/documents/d1" && !opts?.method) {
        return Promise.resolve({
          document: pageDocument({ my_level: "view", via: "break_glass", break_glass_expires_at: future } as never),
        });
      }
      if (path === "/api/v1/documents/d1/admin-summary") {
        return Promise.resolve(summaryBody({ my_level: "view", my_grant: null }));
      }
      if (opts?.method === "DELETE") deletes.push(path);
      return Promise.resolve({ versions: [], next_cursor: null, favorites: [] });
    });
    renderView("d1");
    const end = await screen.findByRole("button", { name: t("documents.breakGlass.endAccessButton") });
    await waitFor(() => expect(end).toBeEnabled());
    fireEvent.click(end);
    expect(await screen.findByText(t("documents.breakGlass.endAccessFailed"))).toBeInTheDocument();
    expect(deletes).toEqual([]);
  });

  it("keeps the locked card, with a retry, when the document still answers restricted after a grant (H2)", async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === "/api/v1/documents/d1" && !opts?.method) return Promise.reject(restricted());
      if (path === "/api/v1/documents/d1/admin-summary") return Promise.resolve(summaryBody());
      if (path === "/api/v1/documents/d1/break-glass" && opts?.method === "POST") {
        return Promise.resolve({ grant: grantBody("bg-1", future) });
      }
      return Promise.resolve({ versions: [], next_cursor: null, favorites: [] });
    });
    renderView("d1");
    await screen.findByTestId("document-locked-card");
    fireEvent.change(screen.getByLabelText(t("documents.breakGlass.reasonLabel")), {
      target: { value: "Kiểm tra sự cố hệ thống khẩn cấp" },
    });
    fireEvent.click(screen.getByRole("button", { name: t("documents.breakGlass.confirmButton") }));

    expect(await screen.findByTestId("break-glass-pending-banner")).toBeInTheDocument();
    // No made-up document: no editor, no emergency-access banner, no expired banner.
    expect(screen.queryByRole("textbox", { name: t("documents.editor.aria_label") })).toBeNull();
    expect(screen.queryByTestId("break-glass-active-banner")).toBeNull();
    expect(screen.queryByTestId("break-glass-expired-banner")).toBeNull();
    expect(screen.getByRole("button", { name: t("documents.detail.retry") })).toBeInTheDocument();
  });

  it("names the owner from a neutral label, never the raw id (M5)", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/documents/d1") return Promise.reject(restricted());
      if (path === "/api/v1/documents/d1/admin-summary") return Promise.resolve(summaryBody());
      return Promise.resolve({});
    });
    renderView("d1");
    const meta = await screen.findByTestId("document-locked-metadata");
    // The summary lands after the card first paints.
    await waitFor(() =>
      expect(meta).toHaveTextContent(
        t("documents.breakGlass.ownerLabel", { owner: t("documents.breakGlass.ownerFallback") }),
      ),
    );
    expect(meta).not.toHaveTextContent("01HOWNERULID");
  });

  it("flips to the expired card when the grant runs out while the tab stays open (M1)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout", "Date"] });
    const expires = new Date(Date.now() + 60_000).toISOString();
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === "/api/v1/documents/d1" && !opts?.method) {
        return Promise.resolve({
          document: pageDocument({ my_level: "view", via: "break_glass", break_glass_expires_at: expires } as never),
        });
      }
      if (path === "/api/v1/documents/d1/admin-summary") {
        return Promise.resolve(summaryBody({ my_level: "view", my_grant: grantBody("bg-9", expires) }));
      }
      return Promise.resolve({ versions: [], next_cursor: null, favorites: [] });
    });
    renderView("d1");
    expect(await screen.findByTestId("break-glass-active-banner")).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(61_000);

    expect(await screen.findByTestId("document-locked-card")).toBeInTheDocument();
    expect(screen.getByTestId("break-glass-expired-banner")).toBeInTheDocument();
    expect(screen.queryByTestId("break-glass-active-banner")).toBeNull();
  });
});
