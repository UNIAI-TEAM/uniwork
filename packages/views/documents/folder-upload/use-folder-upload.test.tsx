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
  render(wrap(<Harness {...props} />, queryClient));
  return { transport, invalidate, onOpenFolder, resolveRootParent };
}

const stage = (...lists: FolderUploadEntry<File>[][]) => act(() => hook.addFolders(lists));
const upload = () => fireEvent.click(screen.getByRole("button", { name: t("documents.folder_upload.dialog.submit") }));

beforeEach(() => {
  for (const fn of Object.values(toast)) fn.mockReset();
});

describe("useFolderUpload", () => {
  it("is not available, and renders nothing, when the server has no folder uploads", () => {
    setup({ limits: DEFAULT_DOCUMENT_LIMITS });
    expect(hook.available).toBe(false);
    expect(screen.queryByTestId("folder-upload-input")).toBeNull();
    stage(entries("Báo cáo", ["a.pdf"]));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is not available for a viewer who may not create here", () => {
    setup({ enabled: false });
    expect(hook.available).toBe(false);
    expect(screen.queryByTestId("folder-upload-input")).toBeNull();
  });

  it("renders a hidden directory input and opens the dialog for the picked folder", async () => {
    setup();
    const input = screen.getByTestId("folder-upload-input") as HTMLInputElement;
    expect(input).toHaveAttribute("webkitdirectory");
    expect(input).toHaveAttribute("multiple");
    const click = vi.spyOn(input, "click");
    act(() => hook.openPicker());
    expect(click).toHaveBeenCalled();

    fireEvent.change(input, { target: { files: [pdf("Mới/a.pdf"), pdf("Mới/b.pdf")] } });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("folder-upload-root")).toHaveTextContent("Mới");
    expect(screen.getByTestId("folder-upload-summary")).toHaveTextContent("2 tệp");
    expect(screen.getByTestId("folder-upload-destination")).toHaveTextContent("Hợp đồng");
  });

  it("previews the (n) name against the destination's own children", async () => {
    setup();
    stage(entries("Báo cáo", ["a.pdf"]));
    expect(await screen.findByTestId("folder-upload-root")).toHaveTextContent("Báo cáo (1)");
    expect(screen.getByTestId("folder-upload-renamed")).toBeInTheDocument();
  });

  it("writes nothing until Tải lên, and Hủy leaves the transport untouched", async () => {
    const { transport } = setup();
    stage(entries("Mới", ["a.pdf"]));
    fireEvent.click(await screen.findByRole("button", { name: t("documents.folder_upload.dialog.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(transport.calls).toEqual([]);
  });

  it("uploads into the open folder, private by default, as one toast ending in Mở thư mục", async () => {
    const { transport, invalidate, onOpenFolder } = setup();
    stage(entries("Mới", ["a.pdf", "b.pdf"]));
    upload();

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const plan = transport.calls.find((c) => c.method === "plan");
    expect(plan?.method === "plan" && plan.body).toMatchObject({ parent_id: "folder-open", root_name: "Mới", share_with_workspace: false });
    // One toast for the whole run: its id is reused for the end state.
    const ids = new Set([...toast.loading.mock.calls, ...toast.success.mock.calls].map((call) => call[1].id));
    expect(ids.size).toBe(1);
    const [message, options] = toast.success.mock.calls[0] ?? [];
    expect(message).toBe("Đã tải lên 2 tệp vào «Mới»");
    options.action.onClick();
    expect(onOpenFolder).toHaveBeenCalledWith("folder-root");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const keys = invalidate.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(documentKeys.listRoot("ws-1")));
    expect(keys).toContain(JSON.stringify(documentKeys.treeRoot("ws-1")));
  });

  it("sends share_with_workspace for every file when the switch is on", async () => {
    const { transport } = setup();
    stage(entries("Mới", ["a.pdf"]));
    fireEvent.click(await screen.findByRole("switch"));
    upload();
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const plan = transport.calls.find((c) => c.method === "plan");
    expect(plan?.method === "plan" && plan.body.share_with_workspace).toBe(true);
  });

  it("never re-sends the share flag when the destination already shares with the workspace", async () => {
    const { transport } = setup({ parentShared: true });
    stage(entries("Mới", ["a.pdf"]));
    await screen.findByText(t("documents.folder_upload.dialog.share_inherited"));
    upload();
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const plan = transport.calls.find((c) => c.method === "plan");
    expect(plan?.method === "plan" && plan.body.share_with_workspace).toBe(false);
  });

  it("at the root lands in My Folder, resolving it when it is not known yet", async () => {
    const { transport, resolveRootParent } = setup({ folderId: null, myFolderId: null, destinationName: "My Folder" });
    stage(entries("Mới", ["a.pdf"]));
    upload();
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(resolveRootParent).toHaveBeenCalledTimes(1);
    const plan = transport.calls.find((c) => c.method === "plan");
    expect(plan?.method === "plan" && plan.body.parent_id).toBe("my-folder");
  });

  it("opens one dialog per dropped folder, one after the other", async () => {
    setup();
    stage(entries("Một", ["a.pdf"]), entries("Hai", ["b.pdf"]));
    expect(await screen.findByTestId("folder-upload-root")).toHaveTextContent("Một");
    expect(screen.getByText(t("documents.folder_upload.dialog.queue_more", { count: 1 }))).toBeInTheDocument();
    upload();
    await waitFor(() => expect(screen.getByTestId("folder-upload-root")).toHaveTextContent("Hai"));
    expect(screen.queryByText(t("documents.folder_upload.dialog.queue_more", { count: 1 }))).toBeNull();
  });

  it("refuses an empty dropped folder with a toast instead of a dialog", () => {
    setup();
    stage([]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(t("documents.folder_upload.refusal.nothing_to_upload"));
  });

  it("keeps the dialog open with the server's refusal and its numbers, then lets the user cancel", async () => {
    const { transport } = setup();
    transport.failNext("plan", folderUploadApiError(422, "folder_upload_too_many_files", { max: 500, count: 612 }));
    stage(entries("Mới", ["a.pdf"]));
    upload();
    expect(await screen.findByText("612 tệp — tối đa 500.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(toast.loading).not.toHaveBeenCalled();
  });

  it("shows the partial result, the report with the reason per file, and retries only on request", async () => {
    const { transport } = setup(
      {},
      // upload_missing keeps the file pending at the server, so it can be retried.
      { fileErrors: { "b.pdf": { code: "upload_missing", message: "" } } },
    );
    stage(entries("Mới", ["a.pdf", "b.pdf"]));
    upload();
    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    const [message, options] = toast.warning.mock.calls[0] ?? [];
    expect(message).toBe("1/2 tệp đã tải lên · 1 lỗi");
    act(() => {
      options.action.onClick();
    });

    expect(await screen.findByText("Mới/b.pdf")).toBeInTheDocument();
    expect(screen.getByText(t("documents.folder_upload.report.reason.upload_missing"))).toBeInTheDocument();
    expect(transport.calls.filter((c) => c.method === "status")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: t("documents.folder_upload.report.retry") }));
    await waitFor(() => expect(transport.calls.some((c) => c.method === "status")).toBe(true));
  });

  it("cancels the whole run from the toast and keeps what landed", async () => {
    // Latency keeps the PUTs in flight while the toast's action is pressed.
    const { transport } = setup({}, { latencyMs: 150 });
    stage(entries("Mới", ["a.pdf", "b.pdf"]));
    upload();
    await waitFor(() => expect(toast.loading).toHaveBeenCalled());
    const options = toast.loading.mock.calls.at(-1)?.[1];
    act(() => {
      options.action.onClick();
    });
    await waitFor(() => expect(toast.info).toHaveBeenCalled());
    expect(toast.info.mock.calls[0]?.[0]).toMatch(/^Đã hủy/);
    expect(transport.calls.some((c) => c.method === "cancel")).toBe(true);
  });

  it("says the batch expired and hides the retry in the report", async () => {
    const { transport } = setup();
    transport.failNext("complete", folderUploadApiError(410, "folder_upload_expired"));
    stage(entries("Mới", ["a.pdf", "b.pdf"]));
    upload();
    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect(toast.warning.mock.calls[0]?.[0]).toContain("đã hết hạn");
    const action = toast.warning.mock.calls[0]?.[1].action;
    if (action) {
      act(() => {
        action.onClick();
      });
      await screen.findByRole("dialog");
      expect(screen.queryByRole("button", { name: t("documents.folder_upload.report.retry") })).toBeNull();
    }
  });
});
