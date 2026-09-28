import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  mode?: "archive" | "restore";
  doc?: Document;
  onArchived?: () => void;
  onOpenChange?: (open: boolean) => void;
} = {}) {
  const onOpenChange = over.onOpenChange ?? vi.fn();
  return render(
    wrap(
      <DocumentArchiveDialog
        open
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
});
