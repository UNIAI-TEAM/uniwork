import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import { DocumentSchema, type Document } from "@uniwork/core/types/document";
import { requestMock, wrap } from "../test/api-mock";
import { VersionHistorySheet } from "./version-history-sheet";

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

function pageDocument(over: Record<string, unknown> = {}): Document {
  return narrowDocument(
    DocumentSchema.parse({
      id: "d1",
      workspace_id: WS,
      kind: "page",
      title: "Kế hoạch Q4",
      revision: "7",
      current_version: 2,
      my_level: "edit",
      created_at: "2026-09-20T03:00:00Z",
      updated_at: "2026-09-28T03:00:00Z",
      ...over,
    }),
  );
}

const versionRows = [
  {
    id: "v2",
    document_id: "d1",
    version: 2,
    kind: "page",
    reason: "manual",
    label: "Mốc Q3",
    created_at: "2026-09-28T03:00:00Z",
  },
  {
    id: "v1",
    document_id: "d1",
    version: 1,
    kind: "page",
    reason: "auto",
    created_at: "2026-09-27T03:00:00Z",
  },
];

function mockApi(overrides: { rows?: unknown[]; onPost?: (path: string, opts: any) => unknown } = {}) {
  requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
    if (path.startsWith("/api/v1/documents/d1/versions") && !opts?.method) {
      return Promise.resolve({ versions: overrides.rows ?? versionRows, next_cursor: null });
    }
    if (opts?.method === "POST") {
      if (overrides.onPost) return overrides.onPost(path, opts);
      return Promise.resolve({
        document: pageDocument({ revision: "8" }),
        version: { ...versionRows[0], id: "v3", version: 3, reason: "restore", restored_from: 1 },
      });
    }
    return Promise.resolve({});
  });
}

function renderSheet(over: { doc?: Document; onOpenChange?: (open: boolean) => void } = {}) {
  const onOpenChange = over.onOpenChange ?? vi.fn();
  const view = render(
    wrap(
      <VersionHistorySheet
        open
        onOpenChange={onOpenChange}
        wsId={WS}
        doc={over.doc ?? pageDocument()}
      />,
    ),
  );
  return { view, onOpenChange };
}

beforeEach(() => {
  requestMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("VersionHistorySheet", () => {
  it("lists the server history with the current version marked", async () => {
    mockApi();
    renderSheet();

    expect(await screen.findByText(t("documents.versions.row_version", { no: 2 }))).toBeInTheDocument();
    expect(screen.getByText(t("documents.versions.row_version", { no: 1 }))).toBeInTheDocument();
    expect(screen.getByText(t("documents.versions.current_badge"))).toBeInTheDocument();
    // The request is the server's list endpoint, newest first.
    const listCall = requestMock.mock.calls.find(
      ([path, opts]) => String(path).startsWith("/api/v1/documents/d1/versions") && !(opts as any)?.method,
    );
    expect(listCall).toBeTruthy();
  });

  it("shows an honest empty state when no version exists", async () => {
    mockApi({ rows: [] });
    renderSheet();

    expect(await screen.findByText(t("documents.versions.empty"))).toBeInTheDocument();
  });

  it("keeps a failed list with a retry that refetches", async () => {
    let fail = true;
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path.startsWith("/api/v1/documents/d1/versions") && !opts?.method) {
        if (fail) {
          return Promise.reject(new Error("offline"));
        }
        return Promise.resolve({ versions: versionRows, next_cursor: null });
      }
      return Promise.resolve({});
    });
    renderSheet();

    expect(await screen.findByRole("alert")).toHaveTextContent(t("documents.versions.error"));
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: t("documents.versions.retry") }));
    expect(await screen.findByText(t("documents.versions.row_version", { no: 2 }))).toBeInTheDocument();
  });

  it("creates a named checkpoint with one idempotency key and clears the field", async () => {
    const posts: { path: string; body?: unknown; key?: string }[] = [];
    mockApi({
      onPost: (path, opts) => {
        posts.push({ path, body: opts.body, key: opts.headers?.["Idempotency-Key"] });
        return Promise.resolve({ version: { ...versionRows[0], id: "v3", version: 3, reason: "manual" } });
      },
    });
    renderSheet();

    const input = await screen.findByLabelText(t("documents.versions.name_label"));
    fireEvent.change(input, { target: { value: "Trước review" } });
    fireEvent.click(screen.getByRole("button", { name: t("documents.versions.name_submit") }));

    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0]?.path).toBe("/api/v1/documents/d1/versions");
    expect(posts[0]?.body).toEqual({ label: "Trước review" });
    expect(posts[0]?.key).toBeTruthy();
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(""));
  });

  it("keeps the typed checkpoint name and the message when the write fails", async () => {
    mockApi({ onPost: () => Promise.reject(new ApiError("nothing changed", "document_version_unchanged", 409)) });
    renderSheet();

    const input = await screen.findByLabelText(t("documents.versions.name_label"));
    fireEvent.change(input, { target: { value: "Mốc giữ nguyên" } });
    fireEvent.click(screen.getByRole("button", { name: t("documents.versions.name_submit") }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect((input as HTMLInputElement).value).toBe("Mốc giữ nguyên");
  });

  it("confirms a restore before writing and keeps the dialog open on failure", async () => {
    const posts: { path: string; body?: unknown }[] = [];
    mockApi({
      onPost: (path, opts) => {
        posts.push({ path, body: opts.body });
        return Promise.reject(new Error("boom"));
      },
    });
    renderSheet();

    fireEvent.click(await screen.findByRole("button", { name: t("documents.versions.restore", { no: 1 }) }));
    expect(screen.getByText(t("documents.versions.restore_confirm_title", { no: 1 }))).toBeInTheDocument();
    expect(posts.length).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: t("documents.versions.restore_confirm_submit") }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0]?.path).toBe("/api/v1/documents/d1/versions/1/restore");
    // Page restores carry no base_revision; the server owns the revision.
    expect(posts[0]?.body).toBeUndefined();
    // The failure is shown in place and the dialog did not switch anything.
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("documents.versions.restore_confirm_submit") })).toBeInTheDocument();
  });

  it("sends the seen base revision on a file restore", async () => {
    const posts: { path: string; body?: unknown }[] = [];
    mockApi({
      onPost: (path, opts) => {
        posts.push({ path, body: opts.body });
        return Promise.resolve({
          document: pageDocument({ kind: "file", revision: "4" }),
          version: { ...versionRows[0], id: "v9", version: 3, reason: "restore" },
        });
      },
    });
    renderSheet({
      doc: pageDocument({
        kind: "file",
        revision: "3",
        file: {
          file_id: "f1",
          version_id: "fv2",
          version: 2,
          filename: "báo-cáo.pdf",
          mime_type: "application/pdf",
          size_bytes: 2048,
          checksum_sha256: "a".repeat(64),
        },
      }),
    });

    fireEvent.click(await screen.findByRole("button", { name: t("documents.versions.restore", { no: 1 }) }));
    fireEvent.click(screen.getByRole("button", { name: t("documents.versions.restore_confirm_submit") }));

    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0]?.body).toEqual({ base_revision: "3" });
  });

  it("tells the user to reopen the history when the restore conflicts", async () => {
    mockApi({
      onPost: () =>
        Promise.reject(new ApiError("base moved", "document_version_conflict", 409)),
    });
    renderSheet();

    fireEvent.click(await screen.findByRole("button", { name: t("documents.versions.restore", { no: 2 }) }));
    fireEvent.click(screen.getByRole("button", { name: t("documents.versions.restore_confirm_submit") }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      t("documents.versions.restore_conflict"),
    );
  });

  it("hides every write control when the level drops while the sheet is open", async () => {
    mockApi();
    const { view } = renderSheet();
    expect(await screen.findByLabelText(t("documents.versions.name_label"))).toBeInTheDocument();
    await screen.findByText(t("documents.versions.row_version", { no: 2 }));
    expect(screen.getAllByRole("button", { name: /^Khôi phục phiên bản/ }).length).toBeGreaterThan(0);

    view.rerender(
      wrap(
        <VersionHistorySheet open onOpenChange={() => undefined} wsId={WS} doc={pageDocument({ my_level: "view" })} />,
      ),
    );

    expect(screen.queryByLabelText(t("documents.versions.name_label"))).toBeNull();
    expect(screen.queryByRole("button", { name: /^Khôi phục phiên bản/ })).toBeNull();
    expect(screen.getByText(t("documents.versions.manage_only"))).toBeInTheDocument();
  });

  it("offers the next page when the server has one", async () => {
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path.startsWith("/api/v1/documents/d1/versions") && !opts?.method) {
        const hasCursor = String(path).includes("cursor=");
        return Promise.resolve({
          versions: hasCursor
            ? [{ ...versionRows[1], id: "v0", version: 0 }]
            : versionRows,
          next_cursor: hasCursor ? null : "next-page",
        });
      }
      return Promise.resolve({});
    });
    renderSheet();

    const more = await screen.findByRole("button", { name: t("documents.versions.load_more") });
    fireEvent.click(more);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: t("documents.versions.load_more") })).toBeNull(),
    );
  });
});
