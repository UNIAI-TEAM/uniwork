import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import { DocumentSchema, type Document } from "@uniwork/core/types/document";
import { requestMock, wrap } from "../test/api-mock";
import { DocumentArchiveDialog } from "./document-archive-dialog";

const { t } = initI18n();
const WS = "ws1";

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

function documentFixture(over: Record<string, unknown> = {}): Document {
  return narrowDocument(
    DocumentSchema.parse({
      id: "d1",
      workspace_id: WS,
      kind: "page",
      title: "Kế hoạch Q4",
      revision: "7",
      my_level: "manage",
      ...over,
    }),
  );
}

function folderFixture(over: Record<string, unknown> = {}): Document {
  return documentFixture({
    id: "f1",
    kind: "folder",
    title: "Hợp đồng 2026",
    ...over,
  });
}

const subtree = {
  documents: [
    {
      id: "c1",
      parent_id: "d1",
      title: "Con A",
      kind: "page",
      position: 0,
      children: [{ id: "c2", parent_id: "c1", title: "Cháu", kind: "page", position: 0, children: [] }],
    },
    { id: "c3", parent_id: "d1", title: "Con B", kind: "file", position: 1, children: [] },
  ],
};

function renderDialog(over: {
  open?: boolean;
  mode?: "archive" | "restore";
  doc?: Document;
  onArchived?: () => void;
  onOpenChange?: (open: boolean) => void;
} = {}) {
  const onOpenChange = over.onOpenChange ?? vi.fn();
  return render(
    wrap(
      <DocumentArchiveDialog
        open={over.open ?? true}
        onOpenChange={onOpenChange}
        wsId={WS}
        doc={over.doc ?? documentFixture()}
        mode={over.mode ?? "archive"}
        onArchived={over.onArchived}
      />,
    ),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("DocumentArchiveDialog", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path.startsWith("/api/v1/workspaces/ws1/documents/tree")) {
        return Promise.resolve(subtree);
      }
      if (path === "/api/v1/documents/f1/archive-impact") {
        return Promise.resolve({ folders: 2, documents: 5, total: 8, max_nodes: 1000, too_large: false });
      }
      if (opts?.method === "POST") {
        return Promise.resolve({
          document: { ...documentFixture(), archived_at: "2026-09-28T03:00:00Z" },
          batch_id: "b1",
          affected: ["d1", "c1", "c2", "c3"],
        });
      }
      return Promise.resolve({});
    });
  });

  it("shows the impact of the subtree before anything is confirmed", async () => {
    renderDialog();

    expect(await screen.findByText(t("documents.archive.impact_count", { count: 4 }))).toBeInTheDocument();
    expect(screen.getByText("Con A")).toBeInTheDocument();
    expect(screen.getByText(t("documents.archive.impact_more", { count: 2 }))).toBeInTheDocument();
  });

  it("refuses to confirm while the impact cannot be read, and retries", async () => {
    let fail = true;
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path.startsWith("/api/v1/workspaces/ws1/documents/tree")) {
        if (fail) return Promise.reject(new Error("offline"));
        return Promise.resolve(subtree);
      }
      if (opts?.method === "POST") return Promise.resolve({});
      return Promise.resolve({});
    });
    renderDialog();

    expect(await screen.findByText(t("documents.archive.impact_error"))).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: t("documents.archive.archive_confirm") });
    expect(confirm).toBeDisabled();

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: t("documents.archive.retry") }));
    await waitFor(() => expect(confirm).toBeEnabled());
  });

  it("archives with one idempotency key and leaves the document on success", async () => {
    const posts: { path: string; key?: string }[] = [];
    requestMock.mockImplementation((path: string, opts?: { method?: string; headers?: Record<string, string> }) => {
      if (path.startsWith("/api/v1/workspaces/ws1/documents/tree")) return Promise.resolve(subtree);
      if (opts?.method === "POST") {
        posts.push({ path, key: opts.headers?.["Idempotency-Key"] });
        return Promise.resolve({
          document: { ...documentFixture(), archived_at: "2026-09-28T03:00:00Z" },
          batch_id: "b1",
          affected: ["d1", "c1"],
        });
      }
      return Promise.resolve({});
    });
    const onOpenChange = vi.fn();
    const onArchived = vi.fn();
    renderDialog({ onOpenChange, onArchived });

    // The impact read gates the confirm: click only after it landed.
    await screen.findByText(t("documents.archive.impact_count", { count: 4 }));
    fireEvent.click(screen.getByRole("button", { name: t("documents.archive.archive_confirm") }));

    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0]?.path).toBe("/api/v1/documents/d1/archive");
    expect(posts[0]?.key).toBeTruthy();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onArchived).toHaveBeenCalled();
  });

  it("keeps a refused archive in the dialog with its message", async () => {
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path.startsWith("/api/v1/workspaces/ws1/documents/tree")) return Promise.resolve(subtree);
      if (opts?.method === "POST") return Promise.reject(new ApiError("nope", "forbidden", 403));
      return Promise.resolve({});
    });
    const onOpenChange = vi.fn();
    renderDialog({ onOpenChange });

    await screen.findByText(t("documents.archive.impact_count", { count: 4 }));
    fireEvent.click(screen.getByRole("button", { name: t("documents.archive.archive_confirm") }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      t("documents.archive.archive_forbidden"),
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("restores exactly the batch and keeps a failure in place", async () => {
    const posts: string[] = [];
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (opts?.method === "POST") {
        posts.push(path);
        return Promise.reject(new Error("boom"));
      }
      return Promise.resolve({});
    });
    const onOpenChange = vi.fn();
    renderDialog({
      mode: "restore",
      doc: documentFixture({ archived_at: "2026-09-27T03:00:00Z" }),
      onOpenChange,
    });

    expect(screen.getByText(t("documents.archive.restore_description"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("documents.archive.restore_confirm") }));

    await waitFor(() => expect(posts).toContain("/api/v1/documents/d1/restore"));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("holds focus inside while open and closes on Escape", async () => {
    const onOpenChange = vi.fn();
    renderDialog({ onOpenChange });
    const dialog = await screen.findByRole("alertdialog", { name: t("documents.archive.archive_title") });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document.activeElement ?? dialog, { key: "Escape" });
    await waitFor(() => expect(onOpenChange.mock.calls.some((call) => call[0] === false)).toBe(true));
  });

  describe("FD-09 folder delete impact and toasts", () => {
    it("shows the two counts (subfolders and documents) exactly as the server sends", async () => {
      renderDialog({ doc: folderFixture() });

      expect(
        await screen.findByRole("alertdialog", { name: t("documents.archive.delete_title") }),
      ).toBeInTheDocument();
      const expectedBody = t("documents.archive.delete_body", {
        subfolders: t("documents.archive.delete_subfolders", { count: 2 }),
        documents: t("documents.archive.delete_documents", { count: 5 }),
      });
      expect(await screen.findByText(expectedBody)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: t("documents.archive.delete_confirm") })).toBeEnabled();
    });

    it("locks confirm with a skeleton until counts arrive, and never shows fake counts on an unreadable answer", async () => {
      let resolveImpact!: (val: unknown) => void;
      requestMock.mockImplementation((path: string) => {
        if (path === "/api/v1/documents/f1/archive-impact") {
          return new Promise((resolve) => {
            resolveImpact = resolve;
          });
        }
        return Promise.resolve({});
      });

      const { unmount } = renderDialog({ doc: folderFixture() });

      expect(await screen.findByText(t("documents.archive.delete_loading"))).toBeInTheDocument();
      expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
      const confirmBtn = screen.getByRole("button", { name: t("documents.archive.delete_confirm") });
      expect(confirmBtn).toBeDisabled();

      resolveImpact({ folders: 0, documents: 3, total: 4, max_nodes: 1000, too_large: false });
      const expectedZeroSubfolders = t("documents.archive.delete_body", {
        subfolders: t("documents.archive.delete_subfolders", { count: 0 }),
        documents: t("documents.archive.delete_documents", { count: 3 }),
      });
      expect(await screen.findByText(expectedZeroSubfolders)).toBeInTheDocument();
      expect(confirmBtn).toBeEnabled();
      unmount();

      // Malformed / unreadable impact -> degrades to null -> error state, never fake 0 counts.
      let malformed = true;
      requestMock.mockImplementation((path: string) => {
        if (path === "/api/v1/documents/f1/archive-impact") {
          return Promise.resolve(
            malformed
              ? { folders: "two" }
              : { folders: 1, documents: 1, total: 3, max_nodes: 1000, too_large: false },
          );
        }
        return Promise.resolve({});
      });

      renderDialog({ doc: folderFixture() });
      expect(await screen.findByRole("alert")).toHaveTextContent(
        t("documents.archive.delete_impact_error"),
      );
      const lockedBtn = screen.getByRole("button", { name: t("documents.archive.delete_confirm") });
      expect(lockedBtn).toBeDisabled();
      expect(
        screen.queryByText(
          t("documents.archive.delete_body", {
            subfolders: t("documents.archive.delete_subfolders", { count: 0 }),
            documents: t("documents.archive.delete_documents", { count: 0 }),
          }),
        ),
      ).toBeNull();

      malformed = false;
      fireEvent.click(screen.getByRole("button", { name: t("documents.archive.retry") }));
      await waitFor(() => expect(lockedBtn).toBeEnabled());
    });

    it("refetches archive-impact every time the dialog is reopened (enabled: open, staleTime: 0)", async () => {
      let impactCalls = 0;
      requestMock.mockImplementation((path: string) => {
        if (path === "/api/v1/documents/f1/archive-impact") {
          impactCalls += 1;
          return Promise.resolve(
            impactCalls === 1
              ? { folders: 1, documents: 2, total: 4, max_nodes: 1000, too_large: false }
              : { folders: 4, documents: 9, total: 14, max_nodes: 1000, too_large: false },
          );
        }
        return Promise.resolve({});
      });

      const doc = folderFixture();
      const onOpenChange = vi.fn();
      const { rerender } = render(
        wrap(
          <DocumentArchiveDialog
            open={false}
            onOpenChange={onOpenChange}
            wsId={WS}
            doc={doc}
            mode="archive"
          />,
        ),
      );
      expect(impactCalls).toBe(0);

      rerender(
        wrap(
          <DocumentArchiveDialog
            open
            onOpenChange={onOpenChange}
            wsId={WS}
            doc={doc}
            mode="archive"
          />,
        ),
      );
      expect(
        await screen.findByText(
          t("documents.archive.delete_body", {
            subfolders: t("documents.archive.delete_subfolders", { count: 1 }),
            documents: t("documents.archive.delete_documents", { count: 2 }),
          }),
        ),
      ).toBeInTheDocument();
      expect(impactCalls).toBe(1);

      rerender(
        wrap(
          <DocumentArchiveDialog
            open={false}
            onOpenChange={onOpenChange}
            wsId={WS}
            doc={doc}
            mode="archive"
          />,
        ),
      );
      rerender(
        wrap(
          <DocumentArchiveDialog
            open
            onOpenChange={onOpenChange}
            wsId={WS}
            doc={doc}
            mode="archive"
          />,
        ),
      );
      expect(
        await screen.findByText(
          t("documents.archive.delete_body", {
            subfolders: t("documents.archive.delete_subfolders", { count: 4 }),
            documents: t("documents.archive.delete_documents", { count: 9 }),
          }),
        ),
      ).toBeInTheDocument();
      expect(impactCalls).toBe(2);
    });

    it("replaces the confirm button with explanatory text when too_large is true", async () => {
      requestMock.mockImplementation((path: string) => {
        if (path === "/api/v1/documents/f1/archive-impact") {
          return Promise.resolve({ too_large: true, max_nodes: 1000 });
        }
        return Promise.resolve({});
      });

      renderDialog({ doc: folderFixture() });

      expect(
        await screen.findByText(t("documents.archive.delete_too_large", { max: 1000 })),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: t("documents.archive.delete_confirm") })).toBeNull();
      expect(screen.getByRole("button", { name: t("common.cancel") })).toBeInTheDocument();
    });

    it("shows the permission message on 403 and 404 (missing) from archive-impact without a retry button and hides the confirm button", async () => {
      let status = 403;
      let code = "forbidden";
      requestMock.mockImplementation((path: string) => {
        if (path === "/api/v1/documents/f1/archive-impact") {
          return Promise.reject(new ApiError(code, code, status));
        }
        return Promise.resolve({});
      });

      const { unmount } = renderDialog({ doc: folderFixture() });

      expect(await screen.findByRole("alert")).toHaveTextContent(
        t("documents.archive.archive_forbidden"),
      );
      expect(screen.queryByRole("button", { name: t("documents.archive.retry") })).toBeNull();
      expect(screen.queryByRole("button", { name: t("documents.archive.delete_confirm") })).toBeNull();
      expect(screen.getByRole("button", { name: t("common.cancel") })).toBeInTheDocument();
      unmount();

      status = 404;
      code = "not_found";
      renderDialog({ doc: folderFixture() });

      expect(await screen.findByRole("alert")).toHaveTextContent(
        t("documents.archive.archive_forbidden"),
      );
      expect(screen.queryByRole("button", { name: t("documents.archive.retry") })).toBeNull();
      expect(screen.queryByRole("button", { name: t("documents.archive.delete_confirm") })).toBeNull();
      expect(screen.getByRole("button", { name: t("common.cancel") })).toBeInTheDocument();
    });

    it("shows the trashed toast after deleting a folder and the restored toast after restoring", async () => {
      const toastSpy = vi.spyOn(toast, "success");
      requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
        if (path === "/api/v1/documents/f1/archive-impact") {
          return Promise.resolve({ folders: 1, documents: 2, total: 4, max_nodes: 1000, too_large: false });
        }
        if (path === "/api/v1/documents/f1/archive" && opts?.method === "POST") {
          return Promise.resolve({
            document: { ...folderFixture(), archived_at: "2026-10-14T00:00:00Z" },
            batch_id: "b1",
            affected: ["f1", "c1", "c2", "c3"],
          });
        }
        if (path === "/api/v1/documents/f1/restore" && opts?.method === "POST") {
          return Promise.resolve({
            document: { ...folderFixture(), archived_at: null },
            batch_id: "b1",
            affected: ["f1"],
          });
        }
        return Promise.resolve({});
      });

      const onArchived = vi.fn();
      const { unmount } = renderDialog({ doc: folderFixture(), onArchived });

      await screen.findByText(
        t("documents.archive.delete_body", {
          subfolders: t("documents.archive.delete_subfolders", { count: 1 }),
          documents: t("documents.archive.delete_documents", { count: 2 }),
        }),
      );
      fireEvent.click(screen.getByRole("button", { name: t("documents.archive.delete_confirm") }));

      await waitFor(() =>
        expect(toastSpy).toHaveBeenCalledWith(
          t("documents.home.folders.toast.trashed", { title: "Hợp đồng 2026" }),
        ),
      );
      expect(onArchived).toHaveBeenCalled();
      unmount();

      toastSpy.mockClear();
      renderDialog({
        mode: "restore",
        doc: folderFixture({ archived_at: "2026-10-14T00:00:00Z" }),
      });
      fireEvent.click(screen.getByRole("button", { name: t("documents.archive.restore_confirm") }));

      await waitFor(() =>
        expect(toastSpy).toHaveBeenCalledWith(
          t("documents.home.folders.toast.restored", { title: "Hợp đồng 2026" }),
        ),
      );
    });
  });
});

