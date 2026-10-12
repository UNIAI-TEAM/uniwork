import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import type { DocumentSourceFile } from "@uniwork/core/documents/sources-schema";
import type { DocumentTreeNode } from "@uniwork/core/types/document";
import { requestMock, wrap } from "../test/api-mock";
import type { DocumentSummaryRow } from "./library-rows";
import { useLibraryRowDialogs } from "./use-library-row-dialogs";

// The three dialogs behind the row menu, driven through the hook: save a file
// from another module, move a document, archive one. Each awaits the server and
// keeps a refusal in its own dialog.

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { t } = initI18n();

const WS = "ws1";
const tree: DocumentTreeNode[] = [
  { id: "fa", title: "Hợp đồng", kind: "folder", parent_id: null, position: 0, children: [{ id: "fb", title: "Quý 4", kind: "folder", parent_id: "fa", position: 0, children: [] }] },
  { id: "d1", title: "Kế hoạch", kind: "page", parent_id: null, position: 1, children: [] },
];
const doc = { id: "d1", workspace_id: WS, kind: "page", title: "Kế hoạch", revision: "1", parent_id: null, updated_at: "2026-09-28T03:00:00Z" } as unknown as DocumentSummaryRow;
const source = { id: "chat:m1", name: "Đề xuất.pdf" } as DocumentSourceFile;
const sourceRow = { type: "source" as const, id: "source:chat:m1", source };

function Harness({ folderId = null, item = doc }: { folderId?: string | null; item?: DocumentSummaryRow }) {
  const row = useLibraryRowDialogs({ wsId: WS, tree, folderId });
  return (
    <>
      <button type="button" onClick={() => row.onMove(item)}>cmd-move</button>
      <button type="button" onClick={() => row.onSaveSource(sourceRow)}>cmd-save</button>
      <button type="button" onClick={() => row.onArchive(doc)}>cmd-archive</button>
      {row.dialogs}
    </>
  );
}

function document(over: Record<string, unknown> = {}) {
  return { id: "d1", workspace_id: WS, kind: "page", title: "Kế hoạch", revision: "7", updated_at: "2026-09-28T03:00:00Z", ...over };
}

const posts = () => requestMock.mock.calls.filter(([, opts]) => (opts as { method?: string } | undefined)?.method === "POST");

beforeEach(() => {
  requestMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe("move", () => {
  it("offers the folders but not the moved item, and moves on a fresh revision", async () => {
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (opts?.method === "POST") return Promise.resolve({ document: document({ parent_id: "fb", revision: "8" }) });
      return Promise.resolve({ document: document() });
    });
    render(wrap(<Harness />));
    fireEvent.click(screen.getByText("cmd-move"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: t("documents.home.move.title") })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Quý 4" })).toBeInTheDocument();
    // A page is not a target.
    expect(within(dialog).queryByRole("button", { name: "Kế hoạch" })).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Quý 4" }));
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.move.submit") }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(t("documents.home.move.moved")));
    const [path, opts] = posts()[0]!;
    expect(path).toBe("/api/v1/documents/d1/move");
    expect((opts as { body: unknown }).body).toEqual({ parent_id: "fb", revision: "7" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps the dialog open with the generic reason when the revision cannot be read", async () => {
    requestMock.mockResolvedValue({});
    render(wrap(<Harness />));
    fireEvent.click(screen.getByText("cmd-move"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.move.submit") }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(t("documents.tree.move_failed"));
    expect(posts()).toHaveLength(0);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("explains a refused move in the dialog and lets the person try again", async () => {
    let attempts = 0;
    requestMock.mockImplementation((_path: string, opts?: { method?: string }) => {
      if (opts?.method !== "POST") return Promise.resolve({ document: document() });
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new ApiError("server text", "document_too_deep", 422))
        : Promise.resolve({ document: document({ parent_id: "fa", revision: "8" }) });
    });
    render(wrap(<Harness />));
    fireEvent.click(screen.getByText("cmd-move"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Hợp đồng" }));
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.move.submit") }));
    expect(await within(dialog).findByText(t("documents.errors.document_too_deep"))).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.move.submit") }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledOnce());
    expect(within(dialog).queryByText(t("documents.errors.document_too_deep"))).toBeNull();
  });

  it.each([
    ["a file", "file", "Báo cáo.pdf"],
    ["a page", "page", "Kế hoạch"],
  ])("moves %s alone: the dialog does not say the contents move too", async (_label, kind, name) => {
    const item = { ...doc, id: "x1", kind, title: name } as unknown as DocumentSummaryRow;
    render(wrap(<Harness item={item} />));
    fireEvent.click(screen.getByText("cmd-move"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(t("documents.home.move.description", { name }))).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent(t("documents.home.move.folder_description", { name }));
  });

  it("says the contents move too when the item moved is a folder", async () => {
    const item = { ...doc, id: "f9", kind: "folder", title: "Dự án mới" } as unknown as DocumentSummaryRow;
    render(wrap(<Harness item={item} />));
    fireEvent.click(screen.getByText("cmd-move"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(t("documents.home.move.folder_description", { name: "Dự án mới" }))).toBeInTheDocument();
  });

  it("closes without moving when cancelled", async () => {
    render(wrap(<Harness />));
    fireEvent.click(screen.getByText("cmd-move"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.upload.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(requestMock).not.toHaveBeenCalled();
  });
});

describe("save a file from another module", () => {
  it("preselects the open folder and replays one idempotency key for the same target", async () => {
    let attempts = 0;
    requestMock.mockImplementation(() => {
      attempts += 1;
      return attempts === 1 ? Promise.reject(new ApiError("Hết giờ", "timeout", 504)) : Promise.resolve({ document: document({ id: "n1", kind: "file" }) });
    });
    render(wrap(<Harness folderId="fa" />));
    fireEvent.click(screen.getByText("cmd-save"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Hợp đồng" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.save_source.submit") }));
    expect(await within(dialog).findByText("Hết giờ")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.save_source.submit") }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(t("documents.home.save_source.saved")));

    const keys = posts().map(([, opts]) => (opts as { headers?: Record<string, string> }).headers?.["Idempotency-Key"]);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    // The retry after a timeout is the same save, not a second copy.
    expect(keys[1]).toBe(keys[0]);
    expect(posts()[0]?.[0]).toBe(`/api/v1/workspaces/${WS}/documents/sources/chat%3Am1/save`);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("uses a new key when the target changes", async () => {
    requestMock.mockRejectedValue(new ApiError("Lỗi", "internal", 500));
    render(wrap(<Harness />));
    fireEvent.click(screen.getByText("cmd-save"));
    const dialog = await screen.findByRole("dialog");
    const submit = () => fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.save_source.submit") }));

    submit();
    await within(dialog).findByText("Lỗi");
    fireEvent.click(within(dialog).getByRole("button", { name: "Hợp đồng" }));
    submit();
    await waitFor(() => expect(posts()).toHaveLength(2));
    const keys = posts().map(([, opts]) => (opts as { headers?: Record<string, string> }).headers?.["Idempotency-Key"]);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("closes from Cancel and shows nothing stale when reopened", async () => {
    requestMock.mockRejectedValue(new ApiError("Lỗi", "internal", 500));
    render(wrap(<Harness />));
    fireEvent.click(screen.getByText("cmd-save"));
    let dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.save_source.submit") }));
    await within(dialog).findByText("Lỗi");
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.upload.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByText("cmd-save"));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText("Lỗi")).toBeNull();
  });
});

describe("archive", () => {
  it("opens the archive confirmation for the row and closes it on cancel", async () => {
    requestMock.mockResolvedValue({ documents: [] });
    render(wrap(<Harness />));
    fireEvent.click(screen.getByText("cmd-archive"));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("button", { name: t("documents.archive.archive_confirm") })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.upload.cancel") }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });
});
