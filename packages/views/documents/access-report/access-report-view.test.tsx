import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import en from "@uniwork/core/i18n/locales/en.json";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
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

function renderView(url = `${BASE_URL}?folder=f1`, documentHref?: (id: string) => string) {
  const nav = fakeNav(url);
  render(
    wrapWithNav(
      <AccessReportView
        wsId={WS}
        workspaceName="Đội"
        workspaceSlug="doi"
        libraryHref="/acme/doi/documents"
        documentHref={documentHref}
      />,
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

  it("keeps reading after documents are shown while later pages come back empty", async () => {
    const empty = { documents: [], summary: { candidates: 50, documents: 0, rows: 0, skipped: 0 } };
    serve((url) => {
      switch (url.searchParams.get("cursor")) {
        case "cur1":
          return page({ ...empty, next_cursor: "cur2" });
        case "cur2":
          return page({ ...empty, next_cursor: "cur3" });
        case "cur3":
          return page({ documents: [docEntry("d2", "Phụ lục B", [ownerRow])], next_cursor: null });
        default:
          return page({ next_cursor: "cur1" });
      }
    });
    renderView();
    // The reader asks for more; the empty pages that follow are read on its own.
    await screen.findByRole("table", { name: "Hợp đồng ABC" });
    fireEvent.click(screen.getByRole("button", { name: t("documents.accessReport.load_more") }));
    expect(await screen.findByRole("table", { name: "Phụ lục B" })).toBeInTheDocument();
    expect(reportCalls()).toHaveLength(4);
    expect(screen.queryByRole("button", { name: t("documents.accessReport.load_more") })).toBeNull();
  });

  it("stops after a run of empty pages and leaves Load more to the reader", async () => {
    serve((url) =>
      url.searchParams.get("cursor")
        ? page({ documents: [], summary: { candidates: 50, documents: 0, rows: 0, skipped: 0 }, next_cursor: `${url.searchParams.get("cursor")}x` })
        : page({ next_cursor: "c" }),
    );
    renderView();
    await screen.findByRole("table", { name: "Hợp đồng ABC" });
    fireEvent.click(screen.getByRole("button", { name: t("documents.accessReport.load_more") }));
    await waitFor(() => expect(reportCalls().length).toBeGreaterThan(2));
    const more = screen.getByRole("button", { name: t("documents.accessReport.load_more") });
    await waitFor(() => expect(more).toBeEnabled());
    const calls = reportCalls().length;
    // The first page, then a bounded run of empty ones.
    expect(calls).toBeGreaterThan(2);
    expect(calls).toBeLessThanOrEqual(8);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(reportCalls()).toHaveLength(calls);
    expect(screen.getByRole("table", { name: "Hợp đồng ABC" })).toBeInTheDocument();
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

  it("empty: the description is the footnote; the empty-file note stays by the export buttons", async () => {
    serve(() => page({ documents: [], summary: { candidates: 0, documents: 0, rows: 0, skipped: 0 } }));
    renderView();
    const heading = await screen.findByRole("heading", { name: t("documents.accessReport.empty") });
    const state = heading.parentElement!;
    expect(within(state).getByText(t("documents.accessReport.footnote"))).toBeInTheDocument();
    const note = screen.getByText(t("documents.accessReport.empty_export_note"));
    expect(state.contains(note)).toBe(false);
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

  it("the person picker is name-only: no email shown, and an email matches nobody", async () => {
    serve(() => page());
    renderView();
    await screen.findByRole("table", { name: "Hợp đồng ABC" });

    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.accessReport.filter_person")) }));
    expect(await screen.findByRole("button", { name: /Trần Bình/ })).toBeInTheDocument();
    // The owner's name in the table plus the same member in the picker.
    expect(screen.getAllByRole("button", { name: /Nguyễn An/ })).toHaveLength(2);
    expect(document.body.textContent).not.toMatch(/@example\.com/);

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "binh@example.com" } });
    expect(screen.queryByRole("button", { name: /Trần Bình/ })).toBeNull();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "trần" } });
    expect(screen.getByRole("button", { name: /Trần Bình/ })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/@example\.com/);
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

// Visual round 1 (UNI-1643): layout fixes that jsdom cannot paint are pinned by
// the classes and attributes that carry them.
describe("AccessReportView - layout", () => {
  const longName = "Nguyễn Thị Phương Thảo Trần Lê Hoàng Anh Minh Quân Đặng";
  const longTitle = "Phụ lục hợp đồng cung cấp dịch vụ tư vấn chuyển đổi số giai đoạn 2026–2028.docx";
  const wide = () =>
    page({
      documents: [
        docEntry("d1", "Hợp đồng ABC", [ownerRow, { ...userShareRow, active: false }]),
        docEntry("d2", longTitle, [{ ...userShareRow, principal_name: longName, granted_by_name: longName }]),
      ],
    });

  it("every document table uses the same column template, so the columns line up across cards", async () => {
    serve(wide);
    renderView();
    const first = await screen.findByRole("table", { name: "Hợp đồng ABC" });
    const second = screen.getByRole("table", { name: longTitle });
    const template = (table: HTMLElement) =>
      within(table)
        .getAllByRole("row")
        .map((row) => row.className.split(/\s+/).filter((c) => c.startsWith("md:grid-cols-")));
    const all = [...template(first), ...template(second)];
    expect(all[0]).toHaveLength(1);
    expect(new Set(all.map((classes) => classes.join(" "))).size).toBe(1);
  });

  it("a long name or title is truncated and carries a tooltip instead of widening the table", async () => {
    serve(wide);
    renderView(undefined, (id) => `/acme/doi/documents/${id}`);
    const table = await screen.findByRole("table", { name: longTitle });
    const link = screen.getByRole("group", { name: longTitle }).querySelector("h3 a");
    expect(link).toHaveAttribute("title", longTitle);
    const row = within(table).getAllByRole("row")[1]!;
    const cells = within(row).getAllByRole("cell");
    expect(within(cells[0]!).getByTitle(longName)).toBeInTheDocument();
    expect(cells[4]).toHaveAttribute("title", longName);
  });

  it("each cell names its column for the stacked phone layout, and the inactive chip stays in the row", async () => {
    serve(wide);
    renderView();
    const table = await screen.findByRole("table", { name: "Hợp đồng ABC" });
    const row = within(table).getByRole("row", { name: /Trần Bình/ });
    const cells = within(row).getAllByRole("cell");
    expect(cells.map((c) => c.getAttribute("data-label"))).toEqual([
      t("documents.accessReport.col_principal"),
      t("documents.accessReport.col_level"),
      t("documents.accessReport.col_effective"),
      t("documents.accessReport.col_source"),
      t("documents.accessReport.col_granted_by"),
      t("documents.accessReport.col_granted_at"),
      t("documents.accessReport.col_status"),
    ]);
    expect(within(row).getByText(t("documents.accessReport.inactive"))).toBeInTheDocument();
    // Column headers stay in the accessibility tree on a phone (visually hidden).
    expect(within(table).getAllByRole("columnheader")[0]!.parentElement!.className).toMatch(/max-md:sr-only/);
  });

  it("row separators use the card's border token", async () => {
    serve(wide);
    renderView();
    const table = await screen.findByRole("table", { name: "Hợp đồng ABC" });
    for (const row of within(table).getAllByRole("row")) expect(row.className).toContain("border-border");
  });

  it("person-name buttons and document title links have a 24px desktop and 44px coarse-pointer hit area", async () => {
    serve(wide);
    renderView(undefined, (id) => `/acme/doi/documents/${id}`);
    const table = await screen.findByRole("table", { name: "Hợp đồng ABC" });
    const person = within(table).getByRole("button", { name: "Trần Bình" });
    const title = screen.getByRole("group", { name: "Hợp đồng ABC" }).querySelector("h3 a")!;
    for (const target of [person, title]) {
      expect(target.className).toContain("min-h-6");
      expect(target.className).toContain("pointer-coarse:min-h-11");
      // A very short name ("Lê Chi") must not leave the target narrower than 44px either.
      expect(target.className).toContain("pointer-coarse:min-w-11");
    }
  });

  it("the Granted on track is wide enough for a date and time, and the cell keeps the full value in its tooltip", async () => {
    serve(wide);
    renderView();
    const table = await screen.findByRole("table", { name: "Hợp đồng ABC" });
    const row = within(table).getByRole("row", { name: /Trần Bình/ });
    const template = row.className.split(/\s+/).find((c) => c.startsWith("md:grid-cols-"))!;
    const tracks = template.slice("md:grid-cols-[".length, -1).split("_");
    expect(tracks).toHaveLength(7);
    // 8.5rem cut "Oct 10, 2026, 3:00 AM" at 1280 (visual r2, VB-1).
    expect(Number.parseFloat(tracks[5]!.replace("rem", ""))).toBeGreaterThanOrEqual(11);
    // Status stays a fixed track so the chip is never pushed out of the card.
    expect(tracks[6]).toMatch(/^\d+(\.\d+)?rem$/);
    // 8rem clipped the vi "Không còn hiệu lực" chip (146.5px) at 1280 (visual r3, VC-1).
    expect(Number.parseFloat(tracks[6]!.replace("rem", ""))).toBeGreaterThanOrEqual(9.5);
    const grantedAt = within(row).getAllByRole("cell")[5]!;
    expect(grantedAt.getAttribute("title")).toMatch(/2026/);
    expect(grantedAt.getAttribute("title")).toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });

  it("caps the inactive chip at its cell width, truncates the label and keeps the full text in a title", async () => {
    serve(wide);
    renderView();
    const table = await screen.findByRole("table", { name: "Hợp đồng ABC" });
    const row = within(table).getByRole("row", { name: /Trần Bình/ });
    const label = t("documents.accessReport.inactive");
    const text = within(row).getByText(label);
    const chip = text.closest("[data-slot='badge']") as HTMLElement;
    expect(chip).not.toBeNull();
    // A longer future label must never escape the cell (visual r3, VC-1).
    expect(chip.className).toContain("max-w-full");
    expect(chip.getAttribute("title")).toBe(label);
    expect(text.className).toContain("truncate");
  });
});

describe("AccessReportView - export labels and the empty note", () => {
  const SHORT = { csv: "CSV", xlsx: "Excel" };

  it("the export buttons carry a short visible label beside the icon at every width", async () => {
    serve(() => page());
    renderView();
    await screen.findByRole("table", { name: "Hợp đồng ABC" });
    for (const [format, label] of [
      ["csv", SHORT.csv],
      ["xlsx", SHORT.xlsx],
    ] as const) {
      const button = screen.getByRole("button", { name: t(`documents.accessReport.export_${format}`) });
      const short = within(button).getByText(label);
      expect(short.className).toContain("md:hidden");
      expect(short.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    }
  });

  it("the empty-file note shows with zero rows and nothing skipped, and not otherwise", async () => {
    serve(() => page({ documents: [], summary: { candidates: 0, documents: 0, rows: 0, skipped: 0 } }));
    const { unmount } = render(
      wrapWithNav(
        <AccessReportView wsId={WS} workspaceName="Đội" workspaceSlug="doi" libraryHref="/acme/doi/documents" />,
        fakeNav(`${BASE_URL}?folder=f1`),
      ),
    );
    const note = await screen.findByText(t("documents.accessReport.empty_export_note"));
    // Both export buttons point at it.
    for (const format of ["csv", "xlsx"]) {
      expect(screen.getByRole("button", { name: t(`documents.accessReport.export_${format}`) })).toHaveAttribute(
        "aria-describedby",
        note.id,
      );
    }
    unmount();

    serve(() => page({ documents: [], summary: { candidates: 4, documents: 0, rows: 0, skipped: 4 } }));
    renderView();
    await screen.findByRole("heading", { name: t("documents.accessReport.skipped_only") });
    expect(screen.queryByText(t("documents.accessReport.empty_export_note"))).toBeNull();
  });

  it("the empty-file note says what the file keeps", () => {
    expect(en.documents.accessReport.empty_export_note).toBe(
      "A file with no rows records the filter and time only in its name.",
    );
    expect(viLocale.documents.accessReport.empty_export_note).toBe(
      "Tệp không có dòng nào chỉ ghi bộ lọc và thời điểm tạo trong tên tệp.",
    );
  });
});

describe("AccessReportView - Load more failure", () => {
  it("keeps the documents shown, says so under the list and retries only the failed page", async () => {
    let fail = true;
    serve((url) => {
      if (url.searchParams.get("cursor") !== "cur1") return page({ next_cursor: "cur1" });
      if (fail) throw new ApiError("boom", "internal", 500);
      return page({ documents: [docEntry("d2", "Phụ lục B", [ownerRow])], next_cursor: null });
    });
    renderView();
    await screen.findByRole("table", { name: "Hợp đồng ABC" });
    fireEvent.click(screen.getByRole("button", { name: t("documents.accessReport.load_more") }));

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(t("documents.accessReport.load_more_error"))).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Hợp đồng ABC" })).toBeInTheDocument();
    expect(screen.queryByText(t("documents.accessReport.error"))).toBeNull();

    const before = reportCalls().length;
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: t("documents.accessReport.retry") }));
    expect(await screen.findByRole("table", { name: "Phụ lục B" })).toBeInTheDocument();
    const retried = reportCalls().slice(before);
    expect(retried).toHaveLength(1);
    expect(retried[0]!.searchParams.get("cursor")).toBe("cur1");
    expect(screen.getByRole("table", { name: "Hợp đồng ABC" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("AccessReportView - visibility filter", () => {
  it("is a labelled toolbar control that names the current value and writes the choice to the URL", async () => {
    serve(() => page());
    const nav = renderView();
    await screen.findByRole("table", { name: "Hợp đồng ABC" });
    const label = t("documents.accessReport.filter_visibility");
    const trigger = screen.getByRole("button", { name: `${label}: ${t("documents.accessReport.filter_all")}` });
    await userEvent.click(trigger);
    // Not the report scope's wording: the option names who can see the document.
    expect(screen.queryByRole("menuitemradio", { name: t("documents.share.visibility_workspace") })).toBeNull();
    await userEvent.click(await screen.findByRole("menuitemradio", { name: t("documents.accessReport.visibility_workspace") }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(expect.stringContaining("visibility=workspace")));
  });

  it("shows the chosen value on the button", async () => {
    serve(() => page());
    renderView(`${BASE_URL}?folder=f1&visibility=restricted`);
    await screen.findByRole("table", { name: "Hợp đồng ABC" });
    expect(
      screen.getByRole("button", {
        name: `${t("documents.accessReport.filter_visibility")}: ${t("documents.share.visibility_restricted")}`,
      }),
    ).toBeInTheDocument();
  });
});
