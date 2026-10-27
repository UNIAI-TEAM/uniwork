import { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { batchCompleted, batchFailed, batchRunning } from "@uniwork/core/documents/folder-contents-access.fixtures";
import { resetFolderAccessBatches } from "@uniwork/core/documents/folder-access-batches";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { FolderAccessBatchWatchers } from "../layout/folder-access-batch-watchers";
import { requestMock, wrap } from "../test/api-mock";
import type { DocumentSummaryRow } from "./library-rows";
import { useFolderContentsAccess } from "./use-folder-contents-access";

// UNI-2244 (review M2): a background folder access batch outlives the page that
// started it. The host (Documents page, sidebar tree) only hands the batch over;
// the workspace shell owns the watcher, so leaving Documents does not lose the
// "applied" / "failed" toast, and no host mount count changes how many show.

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const dialogBatch = vi.hoisted(() => ({ id: "" }));

// The dialog is the other end of the hand-over: this stub starts a batch and closes, nothing else.
vi.mock("./folder-contents-access-dialog", () => ({
  FolderContentsAccessDialog: ({ onTrackBatch, onOpenChange }: { onTrackBatch: (b: { batchId: string; folderId: string }) => void; onOpenChange: (open: boolean) => void }) => (
    <>
      <button type="button" onClick={() => onTrackBatch({ batchId: dialogBatch.id, folderId: "f1" })}>start-batch</button>
      <button type="button" onClick={() => onOpenChange(false)}>close-dialog</button>
    </>
  ),
}));

const { t } = initI18n();
const WS = "ws1";
const folder = { id: "f1", kind: "folder", title: "Hợp đồng", workspace_id: WS } as DocumentSummaryRow;

let status: "running" | "completed" | "failed" = "running";
let seq = 0;
let batchId = "";

function answer(batchIdOfCall: string) {
  const base = status === "completed" ? batchCompleted : status === "failed" ? batchFailed : batchRunning;
  return { ...base, batch_id: batchIdOfCall };
}

function Host({ label }: { label: string }) {
  const { onShareContents, dialogs } = useFolderContentsAccess(WS);
  return (
    <section aria-label={label}>
      <button type="button" onClick={() => onShareContents(folder)}>{`open-${label}`}</button>
      {dialogs}
    </section>
  );
}

/** The workspace shell stays mounted; `route` stands for the module the user is on. */
function Shell({ wsId = WS, hosts = ["page"] }: { wsId?: string; hosts?: string[] }) {
  const [route, setRoute] = useState<"documents" | "other">("documents");
  return (
    <>
      <FolderAccessBatchWatchers wsId={wsId} />
      <button type="button" onClick={() => setRoute((r) => (r === "documents" ? "other" : "documents"))}>navigate</button>
      {route === "documents" ? hosts.map((h) => <Host key={h} label={h} />) : <p>other module</p>}
    </>
  );
}

function mountShell(props?: Parameters<typeof Shell>[0]) {
  return render(wrap(<Shell {...props} />, new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })));
}

/** Starts a batch from the host named `label`, the way its open dialog does, then closes the dialog. */
function startBatchFrom(label: string) {
  fireEvent.click(screen.getByRole("button", { name: `open-${label}` }));
  fireEvent.click(screen.getByRole("button", { name: "start-batch" }));
  fireEvent.click(screen.getByRole("button", { name: "close-dialog" }));
}

const settleQuietly = (ms = 150) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

describe("folder access batch watchers", () => {
  beforeEach(async () => {
    await setLocale("vi");
    vi.clearAllMocks();
    resetFolderAccessBatches();
    status = "running";
    batchId = `01JWATCH${String(++seq).padStart(18, "0")}`;
    dialogBatch.id = batchId;
    requestMock.mockImplementation((path: string) => Promise.resolve(answer(path.split("/").pop()!)));
  });

  it("toasts the completed batch once after the page that started it is left", async () => {
    mountShell();
    startBatchFrom("page");
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "navigate" }));
    expect(screen.getByText("other module")).toBeInTheDocument();

    status = "completed";
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã đổi quyền 1750 tài liệu", expect.anything()), { timeout: 6000 });
    await settleQuietly();
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("toasts the failed batch once after the page that started it is left", async () => {
    mountShell();
    startBatchFrom("page");
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "navigate" }));

    status = "failed";
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t("documents.folderAccess.batch_failed")), { timeout: 6000 });
    await settleQuietly();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("does not toast again when Documents is opened again after the batch ended", async () => {
    mountShell();
    startBatchFrom("page");
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "navigate" }));
    status = "completed";
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1), { timeout: 6000 });

    fireEvent.click(screen.getByRole("button", { name: "navigate" }));
    expect(screen.getByRole("region", { name: "page" })).toBeInTheDocument();
    await settleQuietly(300);
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("toasts once when Documents is opened again while the batch still runs", async () => {
    mountShell();
    startBatchFrom("page");
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "navigate" }));
    fireEvent.click(screen.getByRole("button", { name: "navigate" }));

    status = "failed";
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1), { timeout: 6000 });
    await settleQuietly();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("toasts once with the page and the sidebar tree both mounted", async () => {
    mountShell({ hosts: ["page", "tree"] });
    startBatchFrom("page");
    await waitFor(() => expect(requestMock).toHaveBeenCalled());

    status = "completed";
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1), { timeout: 6000 });
    await settleQuietly();
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("keeps the failure toast back while an open dialog shows that batch", async () => {
    mountShell();
    fireEvent.click(screen.getByRole("button", { name: "open-page" }));
    fireEvent.click(screen.getByRole("button", { name: "start-batch" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    const callsBefore = requestMock.mock.calls.length;

    status = "failed";
    await waitFor(() => expect(requestMock.mock.calls.length).toBeGreaterThan(callsBefore), { timeout: 6000 });
    await settleQuietly();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("does not toast into another workspace, and says the result once its own workspace is back", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(wrap(<Shell />, client));
    startBatchFrom("page");
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    status = "completed";

    view.rerender(wrap(<Shell wsId="ws2" />, client));
    await settleQuietly(300);
    expect(toast.success).not.toHaveBeenCalled();

    view.rerender(wrap(<Shell wsId={WS} />, client));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1), { timeout: 6000 });
  });
});
