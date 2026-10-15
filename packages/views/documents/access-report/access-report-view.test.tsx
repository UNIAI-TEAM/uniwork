import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import { fakeNav, requestMock, wrapWithNav } from "../../test/api-mock";
import { AccessReportView } from "./access-report-view";

// The access report screen (UNI-1643): grouped grants per document with the
// effective level, the skipped line, load more, the shell states, the person /
// level / visibility filters (kept in the URL) and the CSV / Excel export.

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const download = vi.hoisted(() => vi.fn());
vi.mock("@uniwork/core/api/http", async (original) => {
  const { requestMock: transport } = await import("../../test/request-mock");
  return {
    ...(await original<typeof import("@uniwork/core/api/http")>()),
    request: (...args: unknown[]) => transport(...args),
    requestDownload: (...args: unknown[]) => download(...args),
  };
});

const { t } = initI18n();

const WS = "ws1";
const REPORT_PATH = `/api/v1/workspaces/${WS}/documents/access-report`;
const MEMBERS_PATH = `/api/v1/workspaces/${WS}/members`;
const BASE_URL = "/acme/doi/documents/access-report";

const ownerRow = {
  source: "acl_owner",
  via: "member",
  principal_type: "user",
  principal_id: "u1",
  principal_name: "Nguyễn An",
  level: "manage",
  effective_level: "manage",
  active: true,
  granted_by: null,
  granted_by_name: null,
  granted_by_kind: null,
  granted_at: null,
  share_id: null,
};

const shareRow = {
  source: "share",
  via: "share",
  principal_type: "workspace",
  principal_id: "ws9",
  principal_name: "Pháp chế",
  level: "view",
  effective_level: "edit",
  active: true,
  granted_by: "u1",
  granted_by_name: "Nguyễn An",
  granted_by_kind: "human",
  granted_at: "2026-10-10T03:00:00Z",
  share_id: "s1",
};

const userShareRow = {
  ...shareRow,
  principal_type: "user",
  principal_id: "u2",
  principal_name: "Trần Bình",
  level: "edit",
  effective_level: "edit",
  share_id: "s2",
};

function docEntry(id: string, title: string, rows: unknown[], over: Record<string, unknown> = {}) {
  return {
    document: {
      id,
      title,
      kind: "file",
      visibility: "restricted",
      path: [{ id: "f1", title: "Hợp đồng" }],
      acl_owner: { id: "u1", name: "Nguyễn An" },
      live_link_count: 1,
      updated_at: "2026-10-14T09:00:00Z",
      ...over,
    },
    rows,
  };
}

function page(over: Record<string, unknown> = {}) {
  return {
    scope: { kind: "folder", workspace_id: WS, folder_id: "f1", folder_title: "Hợp đồng" },
    filter: { person_id: null, level: [], visibility: null },
    generated_at: "2026-10-15T03:40:00Z",
    documents: [docEntry("d1", "Hợp đồng ABC", [ownerRow, shareRow])],
    summary: { candidates: 50, documents: 1, rows: 2, skipped: 2 },
    next_cursor: null,
    ...over,
  };
}

const members = [
  { workspace_id: WS, user_id: "u1", role: "admin", email: "an@example.com", display_name: "Nguyễn An" },
  { workspace_id: WS, user_id: "u2", role: "member", email: "binh@example.com", display_name: "Trần Bình" },
];

/** Answer the report and the members list; `report` decides each report call. */
function serve(report: (url: URL) => unknown) {
  requestMock.mockImplementation(async (path: string) => {
    const url = new URL(path, "http://api.test");
    if (url.pathname === MEMBERS_PATH) return { members };
    if (url.pathname === REPORT_PATH) return report(url);
    throw new Error(`unexpected request ${path}`);
  });
}

function reportCalls(): URL[] {
  return requestMock.mock.calls
    .map(([path]) => new URL(String(path), "http://api.test"))
    .filter((url) => url.pathname === REPORT_PATH);
}

function renderView(url = `${BASE_URL}?folder=f1`) {
  const nav = fakeNav(url);
  render(
    wrapWithNav(
      <AccessReportView wsId={WS} workspaceName="Đội" workspaceSlug="doi" libraryHref="/acme/doi/documents" />,
      nav,
    ),
  );
  return nav;
}

beforeEach(() => {
  requestMock.mockReset();
  download.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe("AccessReportView - report", () => {
  it("heads the screen and groups each document's grants with owner, links and effective level", async () => {
    serve(() => page());
    renderView();

    expect(await screen.findByRole("heading", { level: 1, name: t("documents.accessReport.title") })).toBeInTheDocument();
    expect(await screen.findByText(t("documents.accessReport.scope_folder", { path: "Hợp đồng" }))).toBeInTheDocument();

    const group = await screen.findByRole("table", { name: "Hợp đồng ABC" });
    expect(within(group).getAllByRole("row")).toHaveLength(3); // header + owner + workspace share
    const ownerLine = within(group).getAllByRole("row")[1]!;
    expect(within(ownerLine).getAllByRole("cell")[2]).toHaveTextContent(t("documents.accessReport.level_manage"));

    const shareLine = within(group).getByRole("row", { name: /Pháp chế/ });
    const cells = within(shareLine).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("Pháp chế");
    expect(cells[1]).toHaveTextContent(t("documents.accessReport.level_view"));
    expect(cells[2]).toHaveTextContent(t("documents.accessReport.level_edit"));
    expect(cells[3]).toHaveTextContent(t("documents.accessReport.source_share"));
    expect(cells[4]).toHaveTextContent("Nguyễn An");

    // Document facts: path, who owns it, how many public links are live.
    const section = screen.getByRole("group", { name: "Hợp đồng ABC" });
    expect(within(section).getByText("Hợp đồng")).toBeInTheDocument();
    expect(within(section).getByText(t("documents.accessReport.col_owner") + ": Nguyễn An")).toBeInTheDocument();
    expect(within(section).getByText(t("documents.accessReport.col_links") + ": 1")).toBeInTheDocument();
    expect(screen.getByText(t("documents.accessReport.footnote"))).toBeInTheDocument();
  });

  it("says how many documents were left out because the reader does not manage them", async () => {
    serve(() => page());
    renderView();
    expect(await screen.findByText(t("documents.accessReport.skipped", { count: 2 }))).toBeInTheDocument();
  });

  it("loads the next page with the cursor and keeps the first page's documents", async () => {
    serve((url) =>
      url.searchParams.get("cursor") === "cur1"
        ? page({ documents: [docEntry("d2", "Phụ lục B", [ownerRow])], summary: { candidates: 10, documents: 1, rows: 1, skipped: 1 }, next_cursor: null })
        : page({ next_cursor: "cur1" }),
    );
    renderView();
    await screen.findByRole("table", { name: "Hợp đồng ABC" });
    fireEvent.click(screen.getByRole("button", { name: t("documents.accessReport.load_more") }));
    expect(await screen.findByRole("table", { name: "Phụ lục B" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Hợp đồng ABC" })).toBeInTheDocument();
    expect(reportCalls().at(-1)?.searchParams.get("cursor")).toBe("cur1");
    expect(screen.queryByRole("button", { name: t("documents.accessReport.load_more") })).toBeNull();
    // Skipped counts add up across the pages loaded.
    expect(screen.getByText(t("documents.accessReport.skipped", { count: 3 }))).toBeInTheDocument();
  });

  it("keeps asking while a page comes back empty but a cursor remains", async () => {
    serve((url) =>
      url.searchParams.get("cursor") === "cur1"
        ? page()
        : page({ documents: [], summary: { candidates: 50, documents: 0, rows: 0, skipped: 0 }, next_cursor: "cur1" }),
    );
    renderView();
    expect(await screen.findByRole("table", { name: "Hợp đồng ABC" })).toBeInTheDocument();
    expect(reportCalls()).toHaveLength(2);
  });

  it("shows a status while the first page loads", () => {
    requestMock.mockImplementation(() => new Promise(() => {}));
    renderView();
    expect(screen.getByRole("status", { name: t("documents.accessReport.loading") })).toBeInTheDocument();
  });
});

describe("AccessReportView - states", () => {
  it("empty: nothing matches and nothing was skipped", async () => {
    serve(() => page({ documents: [], summary: { candidates: 0, documents: 0, rows: 0, skipped: 0 } }));
    renderView();
    expect(await screen.findByRole("heading", { name: t("documents.accessReport.empty") })).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("skipped only: the reader manages nothing here", async () => {
    serve(() => page({ documents: [], summary: { candidates: 4, documents: 0, rows: 0, skipped: 4 } }));
    renderView();
    expect(await screen.findByRole("heading", { name: t("documents.accessReport.skipped_only") })).toBeInTheDocument();
  });

  it("error: an alert with Retry that asks again", async () => {
    let fail = true;
    serve(() => {
      if (fail) throw new ApiError("boom", "internal", 500);
      return page();
    });
    renderView();
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(t("documents.accessReport.error"))).toBeInTheDocument();
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: t("documents.accessReport.retry") }));
    expect(await screen.findByRole("table", { name: "Hợp đồng ABC" })).toBeInTheDocument();
  });

  it("forbidden: a non-member is told to join the workspace", async () => {
    serve(() => {
      throw new ApiError("no", "forbidden", 403);
    });
    renderView();
    expect(await screen.findByRole("heading", { name: t("documents.accessReport.forbidden") })).toBeInTheDocument();
  });

  it("folder gone: says so and links back to the library", async () => {
    serve(() => {
      throw new ApiError("no", "not_found", 404);
    });
    renderView();
    expect(await screen.findByRole("heading", { name: t("documents.accessReport.folder_unavailable") })).toBeInTheDocument();
    const back = screen.getAllByRole("link", { name: t("documents.page.title") });
    expect(back.some((a) => a.getAttribute("href") === "/acme/doi/documents")).toBe(true);
  });
});

describe("AccessReportView - labels", () => {
  it("labels comment and break-glass, and unknown levels and sources as Other", async () => {
    serve(() =>
      page({
        documents: [
          docEntry("d1", "Hợp đồng ABC", [
            { ...shareRow, source: "break_glass", via: "break_glass", level: "comment", effective_level: "comment" },
            { ...userShareRow, source: "from_the_future", level: "owner++", effective_level: "owner++" },
          ]),
        ],
      }),
    );
    renderView();
    const group = await screen.findByRole("table", { name: "Hợp đồng ABC" });
    const rows = within(group).getAllByRole("row").slice(1);
    const first = within(rows[0]!).getAllByRole("cell");
    expect(first[1]).toHaveTextContent(t("documents.accessReport.level_comment"));
    expect(first[3]).toHaveTextContent(t("documents.accessReport.source_break_glass"));
    const second = within(rows[1]!).getAllByRole("cell");
    expect(second[1]).toHaveTextContent(t("documents.accessReport.level_other"));
    expect(second[2]).toHaveTextContent(t("documents.accessReport.level_other"));
    expect(second[3]).toHaveTextContent(t("documents.accessReport.source_other"));
  });

  it("marks an inactive grant with words, not colour alone", async () => {
    serve(() => page({ documents: [docEntry("d1", "Hợp đồng ABC", [{ ...userShareRow, active: false, effective_level: "none" }])] }));
    renderView();
    const group = await screen.findByRole("table", { name: "Hợp đồng ABC" });
    expect(within(group).getByText(t("documents.accessReport.inactive"))).toBeInTheDocument();
    expect(within(group).getAllByText(t("documents.accessReport.level_none")).length).toBeGreaterThan(0);
  });

  it("shows names only: no email anywhere in the report", async () => {
    serve(() => page({ documents: [docEntry("d1", "Hợp đồng ABC", [ownerRow, userShareRow])] }));
    renderView();
    await screen.findByRole("table", { name: "Hợp đồng ABC" });
    expect(document.body.textContent).not.toMatch(/@example\.com/);
  });
});

describe("AccessReportView - filters", () => {
  it("picking a member filters to that person and writes it to the URL", async () => {
    serve((url) =>
      url.searchParams.get("person_id") === "u2"
        ? page({
            filter: { person_id: "u2", level: [], visibility: null },
            documents: [docEntry("d3", "Báo giá", [userShareRow], { person_level: "edit" })],
          })
        : page(),
    );
    const nav = renderView();
    await screen.findByRole("table", { name: "Hợp đồng ABC" });

    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.accessReport.filter_person")) }));
    fireEvent.click(await screen.findByRole("button", { name: /Trần Bình/ }));

    expect(await screen.findByRole("table", { name: "Báo giá" })).toBeInTheDocument();
    expect(reportCalls().at(-1)?.searchParams.get("person_id")).toBe("u2");
    expect(reportCalls().at(-1)?.searchParams.get("folder_id")).toBe("f1");
    expect(nav.replace).toHaveBeenCalledWith(expect.stringContaining("person=u2"));
    expect(screen.queryByRole("table", { name: "Hợp đồng ABC" })).toBeNull();
  });

  it("clicking a person's name in the table filters to them, and Clear filters resets", async () => {
    serve(() => page({ documents: [docEntry("d1", "Hợp đồng ABC", [ownerRow, userShareRow])] }));
    const nav = renderView();
    const group = await screen.findByRole("table", { name: "Hợp đồng ABC" });

    fireEvent.click(within(group).getByRole("button", { name: "Trần Bình" }));
    await waitFor(() => expect(reportCalls().at(-1)?.searchParams.get("person_id")).toBe("u2"));
    expect(nav.replace).toHaveBeenCalledWith(expect.stringContaining("person=u2"));

    fireEvent.click(screen.getByRole("button", { name: t("documents.accessReport.filter_reset") }));
    await waitFor(() => expect(reportCalls().at(-1)?.searchParams.has("person_id")).toBe(false));
    expect(screen.queryByRole("button", { name: t("documents.accessReport.filter_reset") })).toBeNull();
  });

  it("reads the level and visibility filters from the URL and sends them", async () => {
    serve(() => page({ filter: { person_id: null, level: ["edit", "manage"], visibility: "restricted" } }));
    renderView(`${BASE_URL}?folder=f1&level=edit,manage&visibility=restricted`);
    await screen.findByRole("table", { name: "Hợp đồng ABC" });
    const call = reportCalls()[0]!;
    expect(call.searchParams.get("level")).toBe("edit,manage");
    expect(call.searchParams.get("visibility")).toBe("restricted");
    expect(screen.getByRole("button", { name: t("documents.accessReport.filter_reset") })).toBeInTheDocument();
  });

  it("toggling a level adds it to the URL", async () => {
    serve(() => page());
    const nav = renderView();
    await screen.findByRole("table", { name: "Hợp đồng ABC" });
    await userEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.accessReport.filter_level")) }));
    await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: t("documents.accessReport.level_edit") }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(expect.stringContaining("level=edit")));
    await waitFor(() => expect(reportCalls().at(-1)?.searchParams.get("level")).toBe("edit"));
  });
});

describe("AccessReportView - export", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() }));
  });

  it("CSV and Excel call the export with the active filters and save under the server's filename", async () => {
    serve(() => page());
    const saved: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download);
    });
    download.mockResolvedValueOnce({ blob: new Blob(["a"]), filename: "access-report-doi-20261015T0340Z.csv" });
    download.mockResolvedValueOnce({ blob: new Blob(["b"]), filename: null });

    renderView(`${BASE_URL}?folder=f1&person=u2&level=edit,manage&visibility=restricted`);
    await screen.findByRole("table", { name: "Hợp đồng ABC" });

    fireEvent.click(screen.getByRole("button", { name: t("documents.accessReport.export_csv") }));
    await waitFor(() => expect(saved).toHaveLength(1));
    const csv = new URL(String(download.mock.calls[0]![0]), "http://api.test");
    expect(csv.pathname).toBe(`${REPORT_PATH}/export`);
    expect(csv.searchParams.get("format")).toBe("csv");
    expect(csv.searchParams.get("folder_id")).toBe("f1");
    expect(csv.searchParams.get("person_id")).toBe("u2");
    expect(csv.searchParams.get("level")).toBe("edit,manage");
    expect(csv.searchParams.get("visibility")).toBe("restricted");
    expect(saved[0]).toBe("access-report-doi-20261015T0340Z.csv");

    // No filename from the server (cross-origin): a name the screen builds, with the extension.
    fireEvent.click(screen.getByRole("button", { name: t("documents.accessReport.export_xlsx") }));
    await waitFor(() => expect(saved).toHaveLength(2));
    expect(new URL(String(download.mock.calls[1]![0]), "http://api.test").searchParams.get("format")).toBe("xlsx");
    expect(saved[1]).toMatch(/^access-report-doi-.*\.xlsx$/);
    click.mockRestore();
  });

  it("shows a spinner and aria-disabled while exporting and ignores a second click", async () => {
    serve(() => page());
    let finish: (v: { blob: Blob; filename: string | null }) => void = () => {};
    download.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderView();
    await screen.findByRole("table", { name: "Hợp đồng ABC" });

    fireEvent.click(screen.getByRole("button", { name: t("documents.accessReport.export_csv") }));
    const busy = await screen.findByRole("button", { name: t("documents.accessReport.exporting") });
    expect(busy).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(busy);
    expect(download).toHaveBeenCalledTimes(1);

    finish({ blob: new Blob(["a"]), filename: "x.csv" });
    await waitFor(() => expect(screen.getByRole("button", { name: t("documents.accessReport.export_csv") })).not.toHaveAttribute("aria-disabled", "true"));
  });

  it("a report over the row cap toasts the too-large advice", async () => {
    serve(() => page());
    download.mockRejectedValueOnce(new ApiError("too big", "access_report_too_large", 422, undefined, { max_rows: 10000 }));
    renderView();
    await screen.findByRole("table", { name: "Hợp đồng ABC" });
    fireEvent.click(screen.getByRole("button", { name: t("documents.accessReport.export_xlsx") }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t("documents.accessReport.too_large", { max: 10000 })));
  });

  it("any other failure toasts a generic message", async () => {
    serve(() => page());
    download.mockRejectedValueOnce(new ApiError("boom", "internal", 500));
    renderView();
    await screen.findByRole("table", { name: "Hợp đồng ABC" });
    fireEvent.click(screen.getByRole("button", { name: t("documents.accessReport.export_csv") }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t("documents.accessReport.export_failed")));
  });
});
