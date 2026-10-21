import { QueryClient } from "@tanstack/react-query";
import { act, configure, fireEvent, getConfig, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
  // Returns `unmount` and `rerender` too: R2-2 unmounts the page under a run, R3-1 keeps it and turns `enabled` off.
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
  const { unmount, rerender } = render(wrap(<Harness {...props} />, queryClient));
  const update = (next: Partial<UseFolderUploadOptions>) => rerender(wrap(<Harness {...props} {...next} />, queryClient));
  return { transport, invalidate, onOpenFolder, resolveRootParent, unmount, update };
}

const stage = (...lists: FolderUploadEntry<File>[][]) => act(() => hook.addFolders(lists));
const upload = () => fireEvent.click(screen.getByRole("button", { name: t("documents.folder_upload.dialog.submit") }));

// Every waitFor/findBy here rides the fake transport (14-file runs, retries, backoffs); on a loaded box the
// 1 s default is shorter than the work, so the budget is set well above it. A failure still fails, just later.
let asyncUtilTimeout = 0;
beforeAll(() => {
  asyncUtilTimeout = getConfig().asyncUtilTimeout;
  configure({ asyncUtilTimeout: 8_000 });
});
afterAll(() => configure({ asyncUtilTimeout }));

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

  // review-fe-r3 R3-3: "Thử lại" in a report reopened during a running retry is not silent.
  it("closes the reopened old report on Thử lại while a retry runs, and still cancels nothing", async () => {
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
    act(() => {
      first.action.onClick();
    });
    fireEvent.click(await screen.findByRole("button", { name: t("documents.folder_upload.report.retry") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(transport.calls.some((c) => c.method === "cancel")).toBe(false);
    release();
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(transport.calls.some((c) => c.method === "cancel")).toBe(false);
  });
});

// review-fe-r3 R3-1: the page stays mounted but the viewer may not create here any more (a folder they
// cannot edit, or one still loading): "Xem" must still open the report, and the batch can still be closed.
describe("useFolderUpload report outside the create gate (R3-1)", () => {
  it("opens the report from Xem after enabled turns false, and retries from it", async () => {
    const { transport, update } = setup({}, partial);
    stage(entries("Mới", ["a.pdf", "b.pdf"]));
    upload();
    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    const first = firstWarning();
    update({ enabled: false });
    expect(hook.available).toBe(false);
    act(() => {
      first.action.onClick();
    });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: t("documents.folder_upload.report.retry") }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(transport.calls.some((c) => c.method === "cancel")).toBe(false);
  });

  it("closes the batch once when the report is dismissed while enabled is false", async () => {
    const { transport, update } = setup({}, partial);
    stage(entries("Mới", ["a.pdf", "b.pdf"]));
    upload();
    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    const first = firstWarning();
    update({ enabled: false });
    act(() => {
      first.action.onClick();
    });
    const [closeButton] = (await screen.findAllByRole("button", { name: t("documents.folder_upload.report.close") })).slice(-1);
    fireEvent.click(closeButton as HTMLElement);
    await waitFor(() => expect(transport.calls.filter((c) => c.method === "cancel")).toHaveLength(1));
  });

  it("renders neither the hidden input nor the pre-flight dialog while enabled is false", () => {
    const { update } = setup();
    update({ enabled: false });
    expect(screen.queryByTestId("folder-upload-input")).toBeNull();
    act(() => hook.addFolders([entries("Mới", ["a.pdf"])]));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

// review-fe-r3 R3-5: the files-mode branches of the end state (report copy, openId from the destination).
describe("useFolderUpload files mode end to end (R3-5)", () => {
  it("runs partial -> Xem -> retry -> success in files words and opens the destination", async () => {
    const { transport, onOpenFolder } = setup({}, partial);
    act(() => hook.addFiles([pdf("a.pdf"), pdf("b.pdf")]));
    upload();
    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    const first = firstWarning();
    act(() => {
      first.action.onClick();
    });
    const dialog = await screen.findByRole("dialog");
    // Files-mode report copy: no folder named anywhere in it.
    expect(dialog.textContent ?? "").not.toMatch(/thư mục/i);
    fireEvent.click(await screen.findByRole("button", { name: t("documents.folder_upload.report.retry") }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const [message, options] = toast.success.mock.calls[0] ?? [];
    expect(message).toBe("Đã tải lên 2 tệp vào \"Hợp đồng\"");
    options.action.onClick();
    expect(onOpenFolder).toHaveBeenCalledWith("folder-open");
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

  it("shows no Xem and expires the toast when a run settles expired after the page unmounted (R4-1)", async () => {
    // One file at a time, one complete per file: a lands, b fails for good, c's complete meets the 410.
    const { transport, unmount } = setup(
      { limits: { ...WITH_FOLDERS, folder_upload: { ...WITH_FOLDERS.folder_upload!, parallel: 1, complete_batch: 1 } } },
      {
        fileErrors: { "b.pdf": { code: "storage_quota_exceeded", message: "" } },
        errors: { complete: [undefined, undefined, folderUploadApiError(410, "folder_upload_expired")] as unknown as Error[] },
      },
    );
    const release = transport.holdPuts();
    stage(entries("Mới", ["a.pdf", "b.pdf", "c.pdf"]));
    upload();
    await waitFor(() => expect(toast.loading).toHaveBeenCalled());
    unmount();
    release();
    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    const [message, options] = toast.warning.mock.calls.at(-1) ?? [];
    expect(message).toContain("đã hết hạn");
    expect(options.action).toBeUndefined();
    expect(Number.isFinite(options.duration)).toBe(true);
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
