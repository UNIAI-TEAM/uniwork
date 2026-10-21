import { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DOCUMENT_LIMITS, type DocumentLimits } from "@uniwork/core/api/endpoints/config";
import {
  createFakeFolderUploadTransport,
  folderUploadApiError,
  type FakeFolderUploadOptions,
  type FolderUploadEntry,
} from "@uniwork/core/documents/folder-upload";
import { documentKeys } from "@uniwork/core/documents/keys";
import { initI18n } from "@uniwork/core/i18n";
import type { DocumentTreeNode } from "@uniwork/core/types/document";
import { wrap } from "../../test/api-mock";
import { useFolderUpload, type UseFolderUploadOptions } from "./use-folder-upload";

const toast = vi.hoisted(() => ({
  loading: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));

const { t } = initI18n();

const WITH_FOLDERS: DocumentLimits = {
  ...DEFAULT_DOCUMENT_LIMITS,
  folder_upload: { max_files: 500, max_folders: 500, max_total_bytes: 2 * 1024 ** 3, max_depth: 20, parallel: 4, complete_batch: 50 },
};

function node(id: string, title: string, children: DocumentTreeNode[] = []): DocumentTreeNode {
  return { id, title, kind: "folder", position: 1, children };
}

function pdf(path: string): File {
  const file = new File(["x"], path.split("/").pop() as string, { type: "application/pdf" });
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}

function entries(root: string, names: string[]): FolderUploadEntry<File>[] {
  return names.map((name) => {
    const file = pdf(`${root}/${name}`);
    return { path: `${root}/${name}`, size: file.size, file };
  });
}

let hook: ReturnType<typeof useFolderUpload>;

function Harness(props: UseFolderUploadOptions) {
  hook = useFolderUpload(props);
  return <>{hook.dialogs}</>;
}

function setup(over: Partial<UseFolderUploadOptions> = {}, fake: FakeFolderUploadOptions = {}) {
  // Returns `unmount` too: R2-2 unmounts the page under a run.
  const transport = createFakeFolderUploadTransport(fake);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const onOpenFolder = vi.fn();
  const resolveRootParent = vi.fn(async () => "my-folder");
  const props: UseFolderUploadOptions = {
    wsId: "ws-1",
    enabled: true,
    folderId: "folder-open",
    destinationName: "Hợp đồng",
    tree: [node("my-folder", "My", [node("folder-open", "Hợp đồng", [node("old", "Báo cáo")])])],
    limits: WITH_FOLDERS,
    myFolderId: "my-folder",
    resolveRootParent,
    parentShared: false,
    onOpenFolder,
    transport,
    ...over,
  };
  const { unmount } = render(wrap(<Harness {...props} />, queryClient));
  return { transport, invalidate, onOpenFolder, resolveRootParent, unmount };
}

const stage = (...lists: FolderUploadEntry<File>[][]) => act(() => hook.addFolders(lists));
const upload = () => fireEvent.click(screen.getByRole("button", { name: t("documents.folder_upload.dialog.submit") }));

beforeEach(() => {
  for (const fn of Object.values(toast)) fn.mockReset();
});

const partial = { fileErrors: { "b.pdf": { code: "upload_missing", message: "" } } };
const firstWarning = () => toast.warning.mock.calls[0]?.[1];

// review-fe-r2 R2-1: the first run's toast gives way to the retry once the
// retry settles, and a look at the old report during a retry never cancels it.
describe("useFolderUpload retry and the first toast (R2-1)", () => {
  it("dismisses the first run's toast when the retry settles", async () => {
    setup({}, partial);
    stage(entries("Mới", ["a.pdf", "b.pdf"]));
    upload();
    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    const first = firstWarning();
    act(() => {
      first.action.onClick();
    });
    fireEvent.click(await screen.findByRole("button", { name: t("documents.folder_upload.report.retry") }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.dismiss).toHaveBeenCalledWith(first.id);
  });

  it("keeps the first run's toast while the retry runs, and when the retry call fails", async () => {
    const { transport } = setup({}, partial);
    stage(entries("Mới", ["a.pdf", "b.pdf"]));
    upload();
    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    const first = firstWarning();
    transport.failNext("status", new Error("offline"));
    act(() => {
      first.action.onClick();
    });
    fireEvent.click(await screen.findByRole("button", { name: t("documents.folder_upload.report.retry") }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.dismiss).not.toHaveBeenCalledWith(first.id);
  });

  it("does not cancel a running retry when the old report is opened and closed", async () => {
    const { transport } = setup({}, partial);
    stage(entries("Mới", ["a.pdf", "b.pdf"]));
    upload();
    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    const first = firstWarning();
    const release = transport.holdPuts();
    act(() => {
      first.action.onClick();
    });
    fireEvent.click(await screen.findByRole("button", { name: t("documents.folder_upload.report.retry") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // "Xem" on the first toast while the retry is held, then close the report.
    act(() => {
      first.action.onClick();
    });
    const [closeButton] = (await screen.findAllByRole("button", { name: t("documents.folder_upload.report.close") })).slice(-1);
    fireEvent.click(closeButton as HTMLElement);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(transport.calls.some((c) => c.method === "cancel")).toBe(false);
    release();
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(transport.calls.some((c) => c.method === "cancel")).toBe(false);
  });
});

// review-fe-r2 R2-2: the report lives in the page. When the page goes away
// with failures nobody can see any more, the batch is closed once and the
// toast says so, with no action that needs the page.
describe("useFolderUpload after the page unmounts (R2-2)", () => {
  const closedSentence = () => t("documents.folder_upload.toast.closed");

  it("closes a settled batch with failures once on unmount and drops the toast's Xem", async () => {
    const { transport, unmount } = setup({}, partial);
    stage(entries("Mới", ["a.pdf", "b.pdf"]));
    upload();
    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    const first = firstWarning();
    unmount();
    await waitFor(() => expect(transport.calls.filter((c) => c.method === "cancel")).toHaveLength(1));
    const last = toast.warning.mock.calls.at(-1);
    expect(last?.[1].id).toBe(first.id);
    expect(last?.[1].action).toBeUndefined();
    expect(last?.[1].description).toBe(closedSentence());
  });

  it("closes the batch once when the run settles with failures after the page unmounted", async () => {
    const { transport, unmount } = setup({}, partial);
    const release = transport.holdPuts();
    stage(entries("Mới", ["a.pdf", "b.pdf"]));
    upload();
    await waitFor(() => expect(toast.loading).toHaveBeenCalled());
    unmount();
    expect(transport.calls.some((c) => c.method === "cancel")).toBe(false);
    release();
    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    await waitFor(() => expect(transport.calls.filter((c) => c.method === "cancel")).toHaveLength(1));
    for (const call of toast.warning.mock.calls) expect(call[1].action).toBeUndefined();
    expect(toast.warning.mock.calls.at(-1)?.[1].description).toBe(closedSentence());
  });

  it("leaves a clean success alone on unmount", async () => {
    const { transport, unmount } = setup();
    stage(entries("Mới", ["a.pdf"]));
    upload();
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    unmount();
    expect(transport.calls.some((c) => c.method === "cancel")).toBe(false);
    expect(toast.warning).not.toHaveBeenCalled();
  });
});
