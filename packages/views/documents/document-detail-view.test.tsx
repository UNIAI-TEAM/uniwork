import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import {
  FeatureFlagsProvider,
  FeatureFlagService,
  StaticProvider,
} from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import { DocumentSchema, type Document } from "@uniwork/core/types/document";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { DocumentDetailView } from "./document-detail-view";

const { t } = initI18n();

const WS = "ws1";
const LIBRARY = "/acme/doi/documents";

function withFlag(ui: React.ReactElement, on = true) {
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: on } }));
  return wrapWithNav(<FeatureFlagsProvider service={service}>{ui}</FeatureFlagsProvider>);
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
  it("stays behind its flag", () => {
    requestMock.mockResolvedValue({ document: pageDocument() });
    renderView("d1", vi.fn(), false);
    expect(screen.getByText(t("documents.page.off_title"))).toBeInTheDocument();
    expect(requestMock).not.toHaveBeenCalled();
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
    const trigger = screen.getByRole("button", { name: t("documents.comments.open") });
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
});
