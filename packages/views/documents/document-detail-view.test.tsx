import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import {
  FeatureFlagsProvider,
  FeatureFlagService,
  StaticProvider,
} from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { DocumentDetailView } from "./document-detail-view";

const { t } = initI18n();

const WS = "ws1";
const LIBRARY = "/acme/doi/documents";

function withFlag(ui: React.ReactElement, on = true) {
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: on } }));
  return wrapWithNav(<FeatureFlagsProvider service={service}>{ui}</FeatureFlagsProvider>);
}

function pageDocument(over: Record<string, unknown> = {}) {
  return {
    id: "d1",
    workspace_id: WS,
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
  };
}

/** The editor arrives through React.lazy; the first TipTap import is slow. */
function findEditor() {
  return screen.findByRole("textbox", {}, { timeout: 15_000 });
}

function renderView(documentId = "d1", onBackToList = vi.fn(), on = true) {
  return {
    onBackToList,
    ...render(
      withFlag(
        <DocumentDetailView
          wsId={WS}
          documentId={documentId}
          libraryHref={LIBRARY}
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

    expect(await screen.findByText("Kế hoạch Q3")).toBeInTheDocument();
    const surface = await findEditor();
    expect(surface).toHaveAttribute("contenteditable", "true");
    expect(surface).toHaveTextContent("Nội dung A");
    // The breadcrumb points at the library, never at invented ancestors.
    expect(screen.getByRole("link", { name: t("documents.detail.breadcrumb_library") })).toHaveAttribute(
      "href",
      LIBRARY,
    );
  });

  it("keeps a view-only document readable but not editable", async () => {
    requestMock.mockResolvedValue({ document: pageDocument({ my_level: "view" }) });
    renderView();

    expect(await screen.findByText(t("documents.detail.readonly_description"))).toBeInTheDocument();
    const surface = await findEditor();
    expect(surface).toHaveAttribute("contenteditable", "false");
  });

  it("never writes one document's bytes into the document the user switched to", async () => {
    let resolvePatch: ((value: unknown) => void) | null = null;
    const patches: string[] = [];
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (opts?.method === "PATCH") {
        patches.push(path);
        return new Promise((resolve) => {
          resolvePatch = resolve;
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
    const next = await screen.findByText("Tài liệu B");
    expect(next).toBeInTheDocument();

    // The answer to the abandoned save arrives late; it must not be written
    // anywhere, and nothing may be sent for the new document.
    resolvePatch?.({ document: pageDocument({ revision: "4" }) });
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveTextContent("Nội dung B"), {
      timeout: 8_000,
    });
    expect(patches).toEqual(["/api/v1/documents/d1"]);
  });
});
