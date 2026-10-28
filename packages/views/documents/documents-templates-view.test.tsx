import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import { requestMock, wrap } from "../test/api-mock";
import type { LibraryRowHandlers } from "./documents-library-row";
import { DocumentsTemplatesView } from "./documents-templates-view";
import { useDocumentsLibrary } from "./use-documents-library";

// Mẫu văn bản: the workspace's templates, grouped by format under the shared
// list, and the upload that marks the file as a template on arrival. The
// transport is mocked, so the real response schemas stay in the loop.

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { t } = initI18n();

const WS = "ws1";
const BASE = `/api/v1/workspaces/${WS}/documents`;
const user = { id: "u1", email: "an@example.com", display_name: "An", locale: "vi" } as User;
const THRESHOLD = 5 * 1024 * 1024;
const VIEW = { kind: "templates" } as const;

function template(id: string, title: string, format: string, over: Record<string, unknown> = {}) {
  return {
    id,
    organization_id: "org1",
    workspace_id: WS,
    kind: "file",
    title,
    format,
    visibility: "workspace",
    revision: "1",
    current_version: 1,
    position: 0,
    my_level: "edit",
    created_by: "u1",
    created_by_kind: "human",
    updated_by: "u1",
    updated_by_kind: "human",
    created_at: "2026-10-27T01:00:00Z",
    updated_at: "2026-10-27T02:00:00Z",
    template_marked_at: "2026-10-27T03:00:00Z",
    template_marked_by: "u1",
    file: {
      file_id: `file-${id}`,
      version_id: "v1",
      version: 1,
      filename: title,
      mime_type: "application/octet-stream",
      size_bytes: 5,
      checksum_sha256: "a".repeat(64),
    },
    ...over,
  };
}

function handlers(): LibraryRowHandlers {
  return {
    onOpen: vi.fn(),
    onFolder: vi.fn(),
    onGoToSource: vi.fn(),
    onDownloadSource: vi.fn(),
    onSaveSource: vi.fn(),
    isStarred: () => false,
    personName: () => null,
  };
}

function route(documents: unknown[], created?: unknown) {
  requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
    if (path.startsWith("/api/v1/config")) {
      return Promise.resolve({
        flags: { office_engine: true },
        documents: { limits: { upload_max_bytes: 200 * 1024 * 1024, chunked_upload_threshold_bytes: THRESHOLD } },
      });
    }
    if (path === `${BASE}/files` && opts?.method === "POST") return Promise.resolve({ document: created });
    if (path.startsWith(`${BASE}/templates`)) return Promise.resolve({ documents, next_cursor: null });
    if (path.startsWith(`${BASE}/tree`)) return Promise.resolve({ documents: [] });
    if (path.startsWith(BASE)) return Promise.resolve({ documents: [], next_cursor: null });
    return Promise.resolve({});
  });
}

function Harness({ canUpload }: { canUpload: boolean }) {
  const library = useDocumentsLibrary({ wsId: WS, orgId: "org1", enabled: true, view: VIEW, folderId: null, types: [] });
  return <DocumentsTemplatesView library={library} handlers={handlers()} canUpload={canUpload} wsId={WS} />;
}

async function renderView(canUpload = true) {
  const view = render(wrap(<Harness canUpload={canUpload} />));
  if (!canUpload) return view;
  // The upload limits come from GET /config; the picker reads them when a file arrives.
  await waitFor(() => expect(requestMock.mock.calls.some(([path]) => String(path).startsWith("/api/v1/config"))).toBe(true));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return view;
}

const uploadPosts = () =>
  requestMock.mock.calls.filter(([path, opts]) => path === `${BASE}/files` && (opts as { method?: string } | undefined)?.method === "POST");

function pick(container: HTMLElement, file: File) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input).not.toBeNull();
  fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });
}

describe("DocumentsTemplatesView", () => {
  beforeEach(() => {
    requestMock.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
    resetAuthStoreForTests();
    setSessionUser(user);
  });

  it("groups the rows under Word, Excel, PowerPoint and Khác, in that order", async () => {
    route([
      template("d4", "Hợp đồng.pdf", "pdf"),
      template("d3", "Bài trình bày.pptx", "pptx"),
      template("d2", "Hóa đơn.xlsx", "xlsx"),
      template("d1", "Báo giá.docx", "docx"),
    ]);
    const { container } = await renderView();
    await screen.findByText("Báo giá.docx");
    const bodies = [...container.querySelectorAll("tbody")];
    expect(bodies).toHaveLength(4);
    const heading = (body: Element) => body.querySelector("[data-library-group]")?.textContent ?? "";
    expect(heading(bodies[0] as Element)).toContain(t("documents.templates.group.word"));
    expect(heading(bodies[1] as Element)).toContain(t("documents.templates.group.excel"));
    expect(heading(bodies[2] as Element)).toContain(t("documents.templates.group.powerpoint"));
    expect(heading(bodies[3] as Element)).toContain(t("documents.templates.group.other"));
    expect(bodies[0]).toHaveTextContent("Báo giá.docx");
    expect(bodies[1]).toHaveTextContent("Hóa đơn.xlsx");
    expect(bodies[2]).toHaveTextContent("Bài trình bày.pptx");
    expect(bodies[3]).toHaveTextContent("Hợp đồng.pdf");
  });

  it("draws no heading for a format with no template", async () => {
    route([template("d1", "Báo giá.docx", "docx"), template("d4", "Hợp đồng.pdf", "pdf")]);
    await renderView();
    await screen.findByText("Báo giá.docx");
    expect(screen.getByText(t("documents.templates.group.word"))).toBeInTheDocument();
    expect(screen.getByText(t("documents.templates.group.other"))).toBeInTheDocument();
    expect(screen.queryByText(t("documents.templates.group.excel"))).toBeNull();
    expect(screen.queryByText(t("documents.templates.group.powerpoint"))).toBeNull();
  });

  it("shows the empty block when the workspace has no template", async () => {
    route([]);
    await renderView();
    expect(await screen.findByText(t("documents.home.empty.templates_title"))).toBeInTheDocument();
    expect(screen.getByText(t("documents.home.empty.templates_description"))).toBeInTheDocument();
  });

  it("uploads a small file as a workspace template with no destination and no parent", async () => {
    route([], template("n1", "Báo giá mới.docx", "docx"));
    const { container } = await renderView();
    await screen.findByText(t("documents.home.empty.templates_title"));
    expect(screen.getByRole("button", { name: t("documents.templates.upload") })).toBeInTheDocument();
    pick(container, new File(["x"], "Báo giá mới.docx"));
    await waitFor(() => expect(uploadPosts()).toHaveLength(1));
    const form = (uploadPosts()[0]?.[1] as { body: FormData }).body;
    expect(form.get("visibility")).toBe("workspace");
    expect(form.get("template")).toBe("true");
    expect(form.has("destination")).toBe(false);
    expect(form.has("parent_id")).toBe(false);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(t("documents.templates.uploaded", { title: "Báo giá mới.docx" })));
  });

  it("refuses a file above the chunked-upload threshold and sends nothing", async () => {
    route([]);
    const { container } = await renderView();
    await screen.findByText(t("documents.home.empty.templates_title"));
    const big = new File(["x"], "Lớn.docx");
    Object.defineProperty(big, "size", { value: THRESHOLD + 1 });
    pick(container, big);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t("documents.templates.too_large", { size: "5 MB" })));
    expect(uploadPosts()).toHaveLength(0);
  });

  it("says the upload failed when the server refuses it", async () => {
    route([]);
    const { container } = await renderView();
    await screen.findByText(t("documents.home.empty.templates_title"));
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === `${BASE}/files` && opts?.method === "POST") return Promise.reject(new ApiError("", "internal", 500));
      return Promise.resolve({ documents: [], next_cursor: null });
    });
    pick(container, new File(["x"], "Báo giá.docx"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t("documents.templates.upload_failed")));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("offers no upload button to a viewer who may not create", async () => {
    route([template("d1", "Báo giá.docx", "docx")]);
    const { container } = await renderView(false);
    await screen.findByText("Báo giá.docx");
    expect(screen.queryByRole("button", { name: t("documents.templates.upload") })).toBeNull();
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });
});
