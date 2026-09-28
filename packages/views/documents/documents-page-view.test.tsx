import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FeatureFlagsProvider,
  FeatureFlagService,
  StaticProvider,
} from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { DocumentsPageView } from "./documents-page-view";

const { t } = initI18n();

const WS = "ws1";

/** The screen is gated by `documents`; the flag has to be on to see anything. */
function withFlag(ui: React.ReactElement, on: boolean) {
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: on } }));
  return wrapWithNav(<FeatureFlagsProvider service={service}>{ui}</FeatureFlagsProvider>);
}

function pageDocument(over: Record<string, unknown> = {}) {
  return {
    id: "d1",
    workspace_id: WS,
    kind: "page",
    title: "Trang mới",
    content: { type: "doc", content: [{ type: "paragraph" }] },
    content_text: "",
    revision: "1",
    current_version: 0,
    my_level: "edit",
    created_at: "2026-09-28T03:00:00Z",
    updated_at: "2026-09-28T03:00:00Z",
    ...over,
  };
}

function renderView(onOpen: (id: string) => void, on = true) {
  return render(withFlag(<DocumentsPageView wsId={WS} onOpen={onOpen} />, on));
}

beforeEach(() => {
  requestMock.mockReset();
});

describe("DocumentsPageView", () => {
  it("stays behind its flag", () => {
    const onOpen = vi.fn();
    renderView(onOpen, false);
    expect(screen.getByText(t("documents.page.off_title"))).toBeInTheDocument();
    expect(requestMock).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("translates its copy instead of falling back to keys", () => {
    // A missing key renders as the key itself and the screen would read
    // "documents.page.empty_title" in production.
    expect(t("documents.page.empty_title")).not.toBe("documents.page.empty_title");
    expect(t("documents.page.empty_description")).toContain("API");
  });

  it("says the library list is not open rather than faking tabs, counts or rows", () => {
    renderView(vi.fn());
    expect(screen.getByText(t("documents.page.empty_title"))).toBeInTheDocument();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    // Nothing to list means no request: the H1 API has no list endpoint.
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("creates a page and opens it", async () => {
    const onOpen = vi.fn();
    requestMock.mockImplementation((path: string) =>
      path === `/api/v1/workspaces/${WS}/documents`
        ? Promise.resolve({ document: pageDocument() })
        : Promise.resolve({}),
    );
    renderView(onOpen);

    fireEvent.click(screen.getAllByRole("button", { name: t("documents.page.new_page") })[0]!);

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("d1"));
    const [path, opts] = requestMock.mock.calls[0] as [string, { method?: string; body?: { title?: string } }];
    expect(path).toBe(`/api/v1/workspaces/${WS}/documents`);
    expect(opts.method).toBe("POST");
    expect(opts.body?.title).toBe(t("documents.page.new_page"));
  });

  it("uploads a file and opens the new document", async () => {
    const onOpen = vi.fn();
    requestMock.mockImplementation((path: string) =>
      path === `/api/v1/workspaces/${WS}/documents/files`
        ? Promise.resolve({
            document: pageDocument({
              id: "d2",
              kind: "file",
              // A file document without its FileService reference is not
              // usable, and the hook refuses the answer.
              file: {
                file_id: "f1",
                version_id: "v1",
                version: 1,
                filename: "note.txt",
                mime_type: "text/plain",
                size_bytes: 5,
                checksum_sha256: "a".repeat(64),
              },
            }),
          })
        : Promise.resolve({}),
    );
    renderView(onOpen);

    fireEvent.click(screen.getAllByRole("button", { name: t("documents.page.upload_file") })[0]!);
    const input = await screen.findByLabelText(t("documents.upload.pick"));
    const file = new File(["hello"], "note.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByTestId("document-upload-selected")).toHaveTextContent("note.txt");

    fireEvent.click(screen.getByRole("button", { name: t("documents.upload.submit") }));

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("d2"));
    expect(requestMock.mock.calls[0]?.[0]).toBe(`/api/v1/workspaces/${WS}/documents/files`);
  });

  it("keeps a failed upload in the dialog with the reason", async () => {
    requestMock.mockImplementation((path: string) =>
      path === `/api/v1/workspaces/${WS}/documents/files`
        ? Promise.reject(new Error("boom"))
        : Promise.resolve({}),
    );
    renderView(vi.fn());

    fireEvent.click(screen.getAllByRole("button", { name: t("documents.page.upload_file") })[0]!);
    const input = await screen.findByLabelText(t("documents.upload.pick"));
    fireEvent.change(input, {
      target: { files: [new File(["hello"], "note.txt", { type: "text/plain" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: t("documents.upload.submit") }));

    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
    // The picked file is still there, so the retry does not re-pick it.
    expect(screen.getByTestId("document-upload-selected")).toBeInTheDocument();
  });
});
