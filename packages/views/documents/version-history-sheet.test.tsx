import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
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

const members = [
  { workspace_id: WS, user_id: "u1", role: "member", email: "lan@example.com", display_name: "Lan Nguyễn" },
];

function mockApi(overrides: { rows?: unknown[]; onPost?: (path: string, opts: any) => unknown } = {}) {
  requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
    if (path === `/api/v1/workspaces/${WS}/members`) return Promise.resolve({ members });
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

function renderSheet(over: { doc?: Document; onOpenChange?: (open: boolean) => void; client?: QueryClient } = {}) {
  const onOpenChange = over.onOpenChange ?? vi.fn();
  const view = render(
    wrap(
      <VersionHistorySheet
        open
        onOpenChange={onOpenChange}
        wsId={WS}
        doc={over.doc ?? pageDocument()}
      />,
      over.client,
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

  it("holds focus inside while open and closes on Escape", async () => {
    mockApi();
    const onOpenChange = vi.fn();
    renderSheet({ onOpenChange });
    const dialog = await screen.findByRole("dialog", { name: t("documents.versions.title") });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document.activeElement ?? dialog, { key: "Escape" });
    await waitFor(() => expect(onOpenChange.mock.calls.some((call) => call[0] === false)).toBe(true));
  });

  describe("author line", () => {
    const membersClient = () =>
      new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } } });
    const membersQueries = (client: QueryClient) =>
      client.getQueryCache().findAll({ predicate: (q) => JSON.stringify(q.queryKey).includes("members") });
    const rowOf = (no: number) =>
      screen.getByText(t("documents.versions.row_version", { no })).closest("li") as HTMLElement;

    it("shows the member's display name for a human author", async () => {
      mockApi({ rows: [{ ...versionRows[0], created_by: "u1", created_by_kind: "human" }] });
      renderSheet();
      await screen.findByText(t("documents.versions.row_version", { no: 2 }));
      expect(await within(rowOf(2)).findByText("Lan Nguyễn")).toBeInTheDocument();
    });

    it("resolves names through one members request, not one per row", async () => {
      mockApi({
        rows: [
          { ...versionRows[0], created_by: "u1" },
          { ...versionRows[1], created_by: "u1" },
        ],
      });
      renderSheet();
      await waitFor(() => expect(screen.getAllByText("Lan Nguyễn").length).toBe(2));
      const memberCalls = requestMock.mock.calls.filter(([path]) => String(path).endsWith("/members"));
      expect(memberCalls.length).toBe(1);
    });

    it("marks an unnamed agent with the badge alone", async () => {
      mockApi({ rows: [{ ...versionRows[0], created_by: "agent-9", created_by_kind: "agent" }] });
      renderSheet();
      await screen.findByText(t("documents.versions.row_version", { no: 2 }));
      const line = await within(rowOf(2)).findByTestId("version-author");
      // The member list does not name this agent: the badge is its one label,
      // so the line holds the badge and no name span.
      expect(within(line).getByText(t("agents.badge"))).toBeInTheDocument();
      expect(line.querySelector("span.truncate")).toBeNull();
    });

    it("draws both the name and the badge for an agent the member list names", async () => {
      requestMock.mockImplementation((path: string) => {
        if (path === `/api/v1/workspaces/${WS}/members`) {
          return Promise.resolve({
            members: [{ workspace_id: WS, user_id: "agent-9", role: "member", email: "", display_name: "Trợ lý Lịch" }],
          });
        }
        return Promise.resolve({
          versions: [{ ...versionRows[0], created_by: "agent-9", created_by_kind: "agent" }],
          next_cursor: null,
        });
      });
      renderSheet();
      await screen.findByText(t("documents.versions.row_version", { no: 2 }));
      const line = await within(rowOf(2)).findByTestId("version-author");
      await within(line).findByText("Trợ lý Lịch");
      expect(line.querySelector("span.truncate")).toHaveTextContent("Trợ lý Lịch");
      expect(within(line).getByText(t("agents.badge"))).toBeInTheDocument();
    });

    it("does not claim a former member while the members request is pending", async () => {
      mockApi({ rows: [{ ...versionRows[0], created_by: "u1", created_by_kind: "human" }] });
      const base = requestMock.getMockImplementation()!;
      requestMock.mockImplementation((path: string, opts?: { method?: string }) =>
        path === `/api/v1/workspaces/${WS}/members` ? new Promise(() => {}) : base(path, opts),
      );
      renderSheet();
      await screen.findByText(t("documents.versions.row_version", { no: 2 }));
      await waitFor(() => expect(requestMock.mock.calls.some(([path]) => String(path).endsWith("/members"))).toBe(true));
      expect(screen.queryByTestId("version-author")).toBeNull();
      expect(screen.queryByText(t("documents.comments.former_member"))).toBeNull();
    });

    it("does not claim a former member when the members request fails", async () => {
      mockApi({ rows: [{ ...versionRows[0], created_by: "u1", created_by_kind: "human" }] });
      const base = requestMock.getMockImplementation()!;
      requestMock.mockImplementation((path: string, opts?: { method?: string }) =>
        path === `/api/v1/workspaces/${WS}/members` ? Promise.reject(new Error("boom")) : base(path, opts),
      );
      const client = membersClient();
      renderSheet({ client });
      await screen.findByText(t("documents.versions.row_version", { no: 2 }));
      // Wait for the query itself to reach the error state: a call having been
      // made is also true while it is still pending.
      await waitFor(() => expect(membersQueries(client).some((q) => q.state.status === "error")).toBe(true));
      expect(screen.queryByTestId("version-author")).toBeNull();
      expect(screen.queryByText(t("documents.comments.former_member"))).toBeNull();
    });

    it("keeps cached names when a background members refetch fails", async () => {
      mockApi({ rows: [{ ...versionRows[0], created_by: "u1", created_by_kind: "human" }] });
      const base = requestMock.getMockImplementation()!;
      const client = membersClient();
      renderSheet({ client });
      await screen.findByText(t("documents.versions.row_version", { no: 2 }));
      await within(rowOf(2)).findByText("Lan Nguyễn");
      requestMock.mockImplementation((path: string, opts?: { method?: string }) =>
        path === `/api/v1/workspaces/${WS}/members` ? Promise.reject(new Error("boom")) : base(path, opts),
      );
      await client.refetchQueries({ predicate: (q) => JSON.stringify(q.queryKey).includes("members") });
      await waitFor(() =>
        expect(
          membersQueries(client).some((q) => q.state.status === "error" && q.state.data !== undefined),
        ).toBe(true),
      );
      expect(within(rowOf(2)).getByText("Lan Nguyễn")).toBeInTheDocument();
      expect(screen.queryByText(t("documents.comments.former_member"))).toBeNull();
    });

    it("makes no members request while the sheet is closed", async () => {
      mockApi();
      render(wrap(<VersionHistorySheet open={false} onOpenChange={vi.fn()} wsId={WS} doc={pageDocument()} />));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(requestMock.mock.calls.some(([path]) => String(path).endsWith("/members"))).toBe(false);
    });

    it("renders the line without an invalid-DOM console error and with one shared height", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockApi({ rows: [{ ...versionRows[0], created_by: "u1", created_by_kind: "human" }] });
      renderSheet();
      await screen.findByText(t("documents.versions.row_version", { no: 2 }));
      const line = await within(rowOf(2)).findByTestId("version-author");
      await within(line).findByText("Lan Nguyễn");
      expect(line.tagName).toBe("DIV");
      expect(line).toHaveClass("min-h-5");
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("labels a system author", async () => {
      mockApi({ rows: [{ ...versionRows[0], created_by: "sys", created_by_kind: "system" }] });
      renderSheet();
      await screen.findByText(t("documents.versions.row_version", { no: 2 }));
      expect(await within(rowOf(2)).findByText(t("documents.versions.author_system"))).toBeInTheDocument();
    });

    it("falls back to the former-member label for an id outside the workspace", async () => {
      mockApi({ rows: [{ ...versionRows[0], created_by: "gone", created_by_kind: "human" }] });
      renderSheet();
      await screen.findByText(t("documents.versions.row_version", { no: 2 }));
      expect(await within(rowOf(2)).findByText(t("documents.comments.former_member"))).toBeInTheDocument();
    });

    it("draws no author line for an old row without created_by", async () => {
      mockApi({ rows: [versionRows[1]] });
      renderSheet();
      await screen.findByText(t("documents.versions.row_version", { no: 1 }));
      await waitFor(() => expect(requestMock.mock.calls.some(([path]) => String(path).endsWith("/members"))).toBe(true));
      expect(screen.queryByTestId("version-author")).toBeNull();
      expect(screen.queryByText(t("documents.comments.former_member"))).toBeNull();
    });
  });

  // Pins today's label per reason: the editor save goes out as "upload", so the
  // server fix (e6-server) shows up here as a visible change.
  it.each([
    ["upload", "documents.file.reason_upload"],
    ["manual", "documents.file.reason_manual"],
    ["auto", "documents.file.reason_auto"],
    ["restore", "documents.file.reason_restore"],
    ["agent", "documents.file.reason_agent"],
    ["something_new", "documents.file.unknown_reason"],
  ])("labels reason %s with %s", async (reason, key) => {
    mockApi({ rows: [{ ...versionRows[1], reason, label: undefined }] });
    renderSheet();
    const row = (await screen.findByText(t("documents.versions.row_version", { no: 1 }))).closest("li") as HTMLElement;
    expect(within(row).getByText(new RegExp(t(key)))).toBeInTheDocument();
  });
});
