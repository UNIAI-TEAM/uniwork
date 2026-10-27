import { QueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { documentKeys } from "@uniwork/core/documents/keys";
import { initI18n } from "@uniwork/core/i18n";
import { trashKeys } from "@uniwork/core/trash";
import { requestMock, wrap } from "../../test/api-mock";
import type { DocumentSummaryRow } from "../library-rows";
import type { BulkPlan } from "./bulk-actions";
import { useDocListBulkCommands } from "./use-bulk-commands";

// UNI-2045 W9: what a bulk bar action does once the list hands it a plan:
// one confirmation for the trash and the purge, a fan-out over the
// single-document routes, one "3/5" toast with the error list, one
// invalidation after the batch, and the SV-9 zip job (fake transport only).

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { t } = initI18n();
const WS = "ws1";

function doc(id: string, over: Partial<DocumentSummaryRow> = {}): DocumentSummaryRow {
  return {
    id,
    organization_id: "org1",
    workspace_id: WS,
    kind: "file",
    title: `Tệp ${id}`,
    visibility: "workspace",
    revision: "1",
    current_version: 1,
    position: 0,
    my_level: "manage",
    created_by: "",
    created_by_kind: "human",
    updated_by: "u1",
    updated_by_kind: "human",
    created_at: "",
    updated_at: "2026-09-28T03:00:00Z",
    ...over,
  };
}

const archived = (id: string) => ({ document: { ...doc(id), archived_at: "2026-10-21T01:00:00Z" }, batch_id: "b1", affected: [id] });

function Harness({ plan, onDone, onDownloadOne }: { plan: BulkPlan; onDone: () => void; onDownloadOne: (doc: DocumentSummaryRow) => void }) {
  const { bulk, dialogs } = useDocListBulkCommands({ wsId: WS, tree: [], onDownloadOne, zipPollMs: 1 });
  return (
    <>
      <button type="button" data-busy={bulk.busy ? "true" : undefined} onClick={() => bulk.run(plan, onDone)}>
        go
      </button>
      {dialogs}
    </>
  );
}

function setup(plan: BulkPlan) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const onDone = vi.fn();
  const onDownloadOne = vi.fn();
  const view = render(wrap(<Harness plan={plan} onDone={onDone} onDownloadOne={onDownloadOne} />, client));
  fireEvent.click(screen.getByRole("button", { name: "go" }));
  return { invalidate, onDone, onDownloadOne, unmount: view.unmount };
}

/** The text of the description a toast carried. */
function descriptionText(options: unknown): string {
  const description = (options as { description?: ReactNode } | undefined)?.description;
  const { container, unmount } = render(<>{description}</>);
  const text = container.textContent ?? "";
  unmount();
  return text;
}

const five = ["a", "b", "c", "d", "e"].map((id) => doc(id));

describe("useDocListBulkCommands", () => {
  beforeEach(() => {
    requestMock.mockReset();
    for (const fn of Object.values(toast)) fn.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("asks once before trashing the batch, keeps going past a refusal and toasts 3/5 with the errors", async () => {
    requestMock.mockImplementation((path: string) => {
      const id = path.split("/")[4]!;
      if (id === "b") return Promise.reject(new ApiError("no", "forbidden", 403));
      return Promise.resolve(archived(id));
    });
    const plan: BulkPlan = { action: "trash", docs: five.slice(0, 4), skipped: [{ id: "e", code: "forbidden" }], total: 5, titles: new Map(five.map((d) => [d.id, d.title])) };
    const { invalidate, onDone } = setup(plan);
    expect(requestMock).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(t("documents.list.bulk.confirm.trash_title", { count: 4 }));
    fireEvent.click(screen.getByRole("button", { name: t("documents.list.bulk.confirm.trash_action") }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    // Four requests: the skipped row is never sent.
    expect(requestMock.mock.calls.map(([path]) => path).sort()).toEqual([
      "/api/v1/documents/a/archive",
      "/api/v1/documents/b/archive",
      "/api/v1/documents/c/archive",
      "/api/v1/documents/d/archive",
    ]);
    const [title, options] = toast.success.mock.calls[0]!;
    expect(title).toBe(t("documents.list.bulk.done.trash", { ok: 3, total: 5 }));
    expect(title).toBe("Đã chuyển 3/5 tài liệu vào thùng rác");
    const text = descriptionText(options);
    expect(text).toContain("Tệp b");
    expect(text).toContain("Tệp e");
    expect(text).toContain(t("documents.list.bulk.error.forbidden"));
    // The document root and the shared trash, once each after the batch.
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: documentKeys.workspace(WS) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: trashKeys.workspace(WS) });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("adds the relocation clause to the trash confirm only when the selection holds a folder (UNI-2055)", async () => {
    const clause = t("documents.archive.delete_relocated");
    const folder = doc("f", { kind: "folder", title: "Hợp đồng" });
    const withFolder: BulkPlan = { action: "trash", docs: [folder, five[0]!], skipped: [], total: 2, titles: new Map() };
    const first = setup(withFolder);
    expect(await screen.findByRole("alertdialog")).toHaveTextContent(clause);
    first.unmount();

    const filesOnly: BulkPlan = { action: "trash", docs: five.slice(0, 2), skipped: [], total: 2, titles: new Map() };
    setup(filesOnly);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(t("documents.list.bulk.confirm.trash_description"));
    expect(dialog).not.toHaveTextContent(clause);
  });

  it("asks before the purge and sends nothing on cancel", async () => {
    const plan: BulkPlan = { action: "purge", docs: five.slice(0, 2), skipped: [], total: 2, titles: new Map() };
    const { onDone } = setup(plan);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(t("documents.list.bulk.confirm.purge_title", { count: 2 }));
    fireEvent.click(screen.getByRole("button", { name: t("common.cancel") }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(requestMock).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("restores at once, without a confirmation, and says when none went through", async () => {
    requestMock.mockImplementation(() => Promise.reject(new ApiError("gone", "document_not_found", 404)));
    const plan: BulkPlan = { action: "restore", docs: five.slice(0, 2), skipped: [], total: 2, titles: new Map(five.map((d) => [d.id, d.title])) };
    setup(plan);
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    const [title, options] = toast.error.mock.calls[0]!;
    expect(title).toBe(t("documents.list.bulk.done.restore", { ok: 0, total: 2 }));
    expect(descriptionText(options)).toContain(t("documents.list.bulk.error.not_found"));
  });

  it("downloads one file through the single download, not a job", async () => {
    const plan: BulkPlan = { action: "download", docs: [five[0]!], skipped: [{ id: "p", code: "not_a_file" }], total: 2, titles: new Map() };
    const { onDownloadOne, onDone } = setup(plan);
    await waitFor(() => expect(onDownloadOne).toHaveBeenCalledWith(five[0]));
    expect(requestMock).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });

  it("zips several files: creates the job, polls it to ready, downloads the link and lists what was skipped", async () => {
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.href);
    });
    const job = (over: Record<string, unknown>) => ({ id: "job1", status: "queued", created_at: "2026-10-21T01:00:00Z", expires_at: null, download_url: null, file_count: null, skipped: [], error: null, ...over });
    const polls = [job({ status: "running" }), job({ status: "ready", download_url: "https://files.test/z/job1", file_count: 2, skipped: [{ document_id: "c", reason: "too_large" }] })];
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
      if (opts?.method === "POST") return Promise.resolve(job({}));
      return Promise.resolve(polls.shift() ?? job({ status: "ready" }));
    });
    const plan: BulkPlan = {
      action: "download",
      docs: five.slice(0, 3),
      skipped: [{ id: "p", code: "not_a_file" }],
      total: 4,
      titles: new Map([...five.map((d) => [d.id, d.title] as const), ["p", "Ghi chú họp"]]),
    };
    setup(plan);
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    const post = requestMock.mock.calls.find(([, opts]) => (opts as { method?: string } | undefined)?.method === "POST")!;
    expect(post[0]).toBe(`/api/v1/workspaces/${WS}/documents/download-jobs`);
    expect((post[1] as { body: unknown }).body).toEqual({ document_ids: ["a", "b", "c"] });
    expect(requestMock.mock.calls.filter(([path]) => path === `/api/v1/workspaces/${WS}/documents/download-jobs/job1`)).toHaveLength(2);
    expect(clicked).toEqual(["https://files.test/z/job1"]);
    const [title, options] = toast.success.mock.calls[0]!;
    expect(title).toBe(t("documents.list.bulk.done.download", { ok: 2, total: 4 }));
    const text = descriptionText(options);
    expect(text).toContain("Ghi chú họp");
    expect(text).toContain(t("documents.list.bulk.error.not_a_file"));
    expect(text).toContain("Tệp c");
    expect(text).toContain(t("documents.list.bulk.error.too_large"));
  });

  it("names a 422 download_too_large with its own message", async () => {
    requestMock.mockImplementation(() => Promise.reject(new ApiError("too big", "download_too_large", 422)));
    const plan: BulkPlan = { action: "download", docs: five.slice(0, 2), skipped: [], total: 2, titles: new Map() };
    setup(plan);
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error.mock.calls[0]![0]).toBe(t("documents.list.bulk.zip.too_large"));
  });

  it("sends a zip of at most 100 files and counts the rest as skipped with their own reason", async () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const job = (over: Record<string, unknown>) => ({ id: "job1", status: "ready", created_at: "", expires_at: null, download_url: "https://files.test/z", file_count: 100, skipped: [], error: null, ...over });
    requestMock.mockImplementation(() => Promise.resolve(job({})));
    const many = Array.from({ length: 101 }, (_, index) => doc(`d${index}`));
    const plan: BulkPlan = { action: "download", docs: many, skipped: [], total: 101, titles: new Map(many.map((d) => [d.id, d.title])) };
    setup(plan);
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    const post = requestMock.mock.calls.find(([, opts]) => (opts as { method?: string } | undefined)?.method === "POST")!;
    const sent = (post[1] as { body: { document_ids: string[] } }).body.document_ids;
    expect(sent).toHaveLength(100);
    expect(sent).not.toContain("d100");
    const [title, options] = toast.success.mock.calls[0]!;
    expect(title).toBe(t("documents.list.bulk.done.download", { ok: 100, total: 101 }));
    const text = descriptionText(options);
    expect(text).toContain("Tệp d100");
    expect(text).toContain(t("documents.list.bulk.error.zip_limit"));
  });

  it("stops the zip when the screen is left: no further read, no link opened, no toast of failure", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const job = (status: string) => ({ id: "job1", status, created_at: "", expires_at: null, download_url: status === "ready" ? "https://files.test/z" : null, file_count: 2, skipped: [], error: null });
    let ready = false;
    requestMock.mockImplementation((_path: string, opts?: { method?: string }) => Promise.resolve(job(opts?.method === "POST" ? "queued" : ready ? "ready" : "running")));
    const plan: BulkPlan = { action: "download", docs: five.slice(0, 2), skipped: [], total: 2, titles: new Map() };
    const { unmount, onDone } = setup(plan);
    const reads = () => requestMock.mock.calls.filter(([, opts]) => (opts as { method?: string } | undefined)?.method !== "POST").length;
    await waitFor(() => expect(reads()).toBeGreaterThanOrEqual(1));
    unmount();
    ready = true;
    const after = reads();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(reads()).toBe(after);
    expect(click).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("runs a batch once when the bar button is pressed twice, and says it is busy meanwhile", async () => {
    let release: (() => void) | undefined;
    requestMock.mockImplementation(
      (path: string) =>
        new Promise((resolve) => {
          release = () => resolve(archived(path.split("/")[4]!));
        }),
    );
    const plan: BulkPlan = { action: "restore", docs: five.slice(0, 1), skipped: [], total: 1, titles: new Map() };
    setup(plan);
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "go" })).toHaveAttribute("data-busy", "true");
    release?.();
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(requestMock).toHaveBeenCalledTimes(1);
  });
});
