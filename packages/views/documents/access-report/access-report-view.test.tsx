import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { fakeNav, requestMock, wrapWithNav } from "../../test/api-mock";
import { AccessReportView } from "./access-report-view";

// The access report screen (UNI-2039 F2): the header, the four whole-scope
// tiles (also the warning filter), the By document / By person tabs, one row of
// filters kept in the URL and sent to the server, and Previous / Next over the
// pages already read, counted against `matching_documents`.

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { t } = initI18n();
const at = (key: string, opts?: Record<string, unknown>) => t(`documents.accessReport.${key}`, opts ?? {});

const WS = "ws1";
const REPORT_PATH = `/api/v1/workspaces/${WS}/documents/access-report`;
const SUMMARY_PATH = `${REPORT_PATH}/summary`;
const PRINCIPALS_PATH = `${REPORT_PATH}/principals`;
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

function docEntry(id: string, title: string, rows: unknown[] = [ownerRow]) {
  return {
    document: {
      id,
      title,
      kind: "file",
      visibility: "restricted",
      path: [{ id: "f1", title: "Hợp đồng" }],
      acl_owner: { id: "u1", name: "Nguyễn An" },
      live_link_count: 0,
      updated_at: "2026-10-14T09:00:00Z",
    },
    rows,
  };
}

function page(over: Record<string, unknown> = {}) {
  return {
    scope: { kind: "folder", workspace_id: WS, folder_id: "f1", folder_title: "Hợp đồng" },
    filter: { person_id: null, level: [], visibility: null },
    generated_at: "2026-10-15T03:40:00Z",
    documents: [docEntry("d1", "Hợp đồng ABC")],
    summary: { candidates: 50, documents: 1, rows: 1, skipped: 0 },
    next_cursor: null,
    ...over,
  };
}

const EMPTY_PAGE = { documents: [], summary: { candidates: 0, documents: 0, rows: 0, skipped: 0 } };

function totals(over: Record<string, unknown> = {}) {
  return {
    generated_at: "2026-10-15T03:40:00Z",
    tiles: { public_link: 1, outside_workspace: 2, direct_manage: 3, documents: 11, restricted: 2, workspace: 9, organization: 0 },
    matching_documents: 5,
    skipped: 14,
    truncated: false,
    ...over,
  };
}

const principals = {
  generated_at: "x",
  principals: [
    { principal_type: "user", principal_id: "u2", principal_name: "Trần Bình", kind: "member", member_count: null, document_count: 4, levels: { view: 1, comment: 0, edit: 1, manage: 2 }, main_source: "direct" },
    { principal_type: "link", principal_id: null, principal_name: null, kind: "link", member_count: null, document_count: 1, levels: { view: 1, comment: 0, edit: 0, manage: 0 }, main_source: "link" },
  ],
  truncated: false,
};

interface Served {
  report?: (url: URL) => unknown;
  summary?: (url: URL) => unknown;
}

function serve({ report = () => page(), summary = () => totals() }: Served = {}) {
  requestMock.mockImplementation(async (path: string) => {
    const url = new URL(path, "http://api.test");
    if (url.pathname === SUMMARY_PATH) return summary(url);
    if (url.pathname === PRINCIPALS_PATH) return principals;
    if (url.pathname === REPORT_PATH) return report(url);
    throw new Error(`unexpected request ${path}`);
  });
}

function calls(pathname: string): URL[] {
  return requestMock.mock.calls
    .map(([path]) => new URL(String(path), "http://api.test"))
    .filter((url) => url.pathname === pathname);
}

function renderView(url = `${BASE_URL}?folder=f1`) {
  const nav = fakeNav(url);
  render(
    wrapWithNav(
      <AccessReportView
        wsId={WS}
        workspaceName="Đội"
        workspaceSlug="doi"
        libraryHref="/acme/doi/documents"
        documentHref={(id) => `/acme/doi/documents/${id}`}
      />,
      nav,
    ),
  );
  return nav;
}

const lastUrl = (nav: ReturnType<typeof fakeNav>) => new URLSearchParams(nav.searchParams.toString());
const tile = (key: string) => screen.getByRole("button", { name: new RegExp(at(key)) });

beforeEach(() => {
  requestMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  resetAuthStoreForTests();
});

describe("AccessReportView - shell", () => {
  it("heads the screen with the report header and one Export menu, not the old buttons", async () => {
    serve();
    renderView();
    expect(await screen.findByRole("heading", { level: 1, name: at("title") })).toBeInTheDocument();
    expect(await screen.findByText(at("scope_folder", { path: "Hợp đồng" }))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: new RegExp(at("export")) })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: at("export_csv") })).toBeNull();
    expect(screen.queryByRole("button", { name: at("load_more") })).toBeNull();
  });

  it("mounts the By document table with one row per document", async () => {
    serve({ report: () => page({ documents: [docEntry("d1", "Hợp đồng ABC"), docEntry("d2", "Phụ lục B")] }) });
    renderView();
    const title = await screen.findByText("Hợp đồng ABC");
    expect(title.closest("tr")).not.toBeNull();
    expect(screen.getByText("Phụ lục B").closest("tr")).not.toBeNull();
  });

  it("Refresh reads the report and the totals again", async () => {
    serve();
    renderView();
    await screen.findByText("Hợp đồng ABC");
    await waitFor(() => expect(calls(SUMMARY_PATH)).toHaveLength(1));
    const before = calls(REPORT_PATH).length;
    fireEvent.click(screen.getByRole("button", { name: at("refresh") }));
    await waitFor(() => expect(calls(REPORT_PATH).length).toBeGreaterThan(before));
    await waitFor(() => expect(calls(SUMMARY_PATH)).toHaveLength(2));
  });

  it("shows a status while the first page loads", () => {
    requestMock.mockImplementation(() => new Promise(() => {}));
    renderView();
    expect(screen.getByRole("status", { name: at("loading") })).toBeInTheDocument();
  });
});

describe("AccessReportView - tiles", () => {
  it("draws the whole-scope totals, asked for without the filters", async () => {
    serve();
    renderView(`${BASE_URL}?folder=f1&level=edit&q=abc`);
    await waitFor(() => expect(tile("tile_public_link")).toHaveTextContent("1"));
    expect(tile("tile_documents")).toHaveTextContent("11");
    const unfiltered = calls(SUMMARY_PATH).find((url) => !url.searchParams.has("level"));
    expect(unfiltered?.searchParams.get("folder_id")).toBe("f1");
    expect(unfiltered?.searchParams.has("q")).toBe(false);
  });

  it("a tile sets ?flag, shows a removable chip, and the chip clears it", async () => {
    serve();
    const nav = renderView();
    await waitFor(() => expect(tile("tile_public_link")).toHaveTextContent("1"));
    fireEvent.click(tile("tile_public_link"));
    await waitFor(() => expect(lastUrl(nav).get("flag")).toBe("public_link"));
    expect(tile("tile_public_link")).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(calls(REPORT_PATH).at(-1)?.searchParams.get("flag")).toBe("public_link"));

    const chip = screen.getByRole("button", { name: at("clear_chip", { name: at("flag_public_link") }) });
    fireEvent.click(chip);
    await waitFor(() => expect(lastUrl(nav).has("flag")).toBe(false));
    expect(screen.queryByRole("button", { name: at("clear_chip", { name: at("flag_public_link") }) })).toBeNull();
  });

  it("a summary that is not one shows the error on each tile, never 0", async () => {
    serve({ summary: () => ({ nope: true }) });
    renderView();
    await screen.findByText("Hợp đồng ABC");
    await waitFor(() => expect(tile("tile_public_link")).toHaveTextContent(at("tiles_error")));
    expect(tile("tile_documents")).toHaveTextContent(at("tiles_error"));
    expect(tile("tile_documents").textContent).not.toMatch(/\d/);
  });

  it("says in one muted line how many documents the reader can only view", async () => {
    serve();
    renderView();
    expect(await screen.findByText(at("skipped_line", { count: 14 }))).toBeInTheDocument();
  });
});

describe("AccessReportView - tabs", () => {
  it("is a tab list with By document selected, and By person writes ?view=person and shows the people", async () => {
    serve();
    const nav = renderView();
    const tabs = screen.getByRole("tablist", { name: at("tabs_label") });
    const documents = within(tabs).getByRole("tab", { name: at("tab_documents") });
    expect(documents).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(tabs).getByRole("tab", { name: at("tab_people") }));
    await waitFor(() => expect(lastUrl(nav).get("view")).toBe("person"));
    expect(await screen.findByText("Trần Bình")).toBeInTheDocument();
    expect(within(tabs).getByRole("tab", { name: at("tab_people") })).toHaveAttribute("aria-selected", "true");
  });

  it("By person: the principals line, the people filters, and no tiles", async () => {
    serve();
    renderView(`${BASE_URL}?view=person`);
    expect(await screen.findByText(at("principals_line", { principals: 2, count: 11 }))).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: at("search_people") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: new RegExp(at("filter_kind")) })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: new RegExp(at("tile_public_link")) })).toBeNull();
  });

  it("By person: the type and level in the URL are sent with the principals", async () => {
    serve();
    renderView(`${BASE_URL}?view=person&kind=member&level=manage`);
    await waitFor(() => expect(calls(PRINCIPALS_PATH).some((u) => u.searchParams.get("kind") === "member" && u.searchParams.get("level") === "manage")).toBe(true));
  });
});

describe("AccessReportView - filters", () => {
  it("reads every filter and the sort from the URL and sends them with the page", async () => {
    serve();
    renderView(
      `${BASE_URL}?folder=f1&q=abc&principal=user:u2&level=edit&scope=restricted&source=direct,chat&flag=direct_manage&non_default=1&sort=title&order=asc`,
    );
    await waitFor(() => expect(calls(REPORT_PATH).length).toBeGreaterThan(0));
    const url = calls(REPORT_PATH)[0]!;
    expect(url.searchParams.get("q")).toBe("abc");
    expect(url.searchParams.get("principal")).toBe("user:u2");
    expect(url.searchParams.get("level")).toBe("edit");
    expect(url.searchParams.get("scope")).toBe("restricted");
    expect(url.searchParams.get("source")).toBe("direct,chat");
    expect(url.searchParams.get("flag")).toBe("direct_manage");
    expect(url.searchParams.get("non_default")).toBe("1");
    expect(url.searchParams.get("sort")).toBe("title");
    expect(url.searchParams.get("order")).toBe("asc");
    // The filtered summary gives the count; the tiles keep their own call.
    await waitFor(() => expect(calls(SUMMARY_PATH).some((u) => u.searchParams.get("flag") === "direct_manage")).toBe(true));
  });

  it("typing a search writes ?q once typing pauses", async () => {
    serve();
    const nav = renderView();
    await screen.findByText("Hợp đồng ABC");
    await userEvent.type(screen.getByRole("searchbox", { name: at("search_documents") }), "hợp");
    await waitFor(() => expect(lastUrl(nav).get("q")).toBe("hợp"));
    await waitFor(() => expect(calls(REPORT_PATH).at(-1)?.searchParams.get("q")).toBe("hợp"));
  });

  it("the non-default toggle and the source menu write the URL", async () => {
    serve();
    const nav = renderView();
    await screen.findByText("Hợp đồng ABC");
    fireEvent.click(screen.getByRole("checkbox", { name: at("only_non_default") }));
    await waitFor(() => expect(lastUrl(nav).get("non_default")).toBe("1"));

    fireEvent.click(screen.getByRole("button", { name: new RegExp(at("filter_source")) }));
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: at("source_chat") }));
    await waitFor(() => expect(lastUrl(nav).get("source")).toBe("chat"));
  });

  it("the person or group picker lists people, groups and links, and writes ?principal", async () => {
    serve();
    const nav = renderView();
    await screen.findByText("Hợp đồng ABC");
    fireEvent.click(screen.getByRole("button", { name: new RegExp(at("filter_principal")) }));
    expect(await screen.findByRole("option", { name: at("anyone_with_link") })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Trần Bình" }));
    await waitFor(() => expect(lastUrl(nav).get("principal")).toBe("user:u2"));
    expect(await screen.findByRole("button", { name: `${at("filter_principal")}: Trần Bình` })).toBeInTheDocument();
  });

  it("a column sort writes ?sort and ?order and asks the server", async () => {
    serve();
    const nav = renderView();
    await screen.findByText("Hợp đồng ABC");
    fireEvent.click(screen.getByRole("button", { name: at("sort_by", { column: at("col_document") }) }));
    await waitFor(() => expect(lastUrl(nav).get("sort")).toBe("title"));
    expect(lastUrl(nav).get("order")).toBe("asc");
    await waitFor(() => expect(calls(REPORT_PATH).at(-1)?.searchParams.get("sort")).toBe("title"));
  });

  it("the filters sit on one row that wraps", async () => {
    serve();
    renderView();
    const search = await screen.findByRole("searchbox", { name: at("search_documents") });
    expect(search.closest(".flex-wrap")).not.toBeNull();
  });
});

describe("AccessReportView - pages", () => {
  const two = (url: URL) =>
    url.searchParams.get("cursor") === "cur1"
      ? page({ documents: [docEntry("d3", "Phụ lục C"), docEntry("d4", "Phụ lục D")], next_cursor: "cur2" })
      : page({ documents: [docEntry("d1", "Hợp đồng ABC"), docEntry("d2", "Phụ lục B")], next_cursor: "cur1" });

  it("counts the page against matching_documents and moves with Next and Previous", async () => {
    serve({ report: two });
    renderView();
    expect(await screen.findByText(at("count_range", { from: 1, to: 2, total: 5 }))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: at("prev") })).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(screen.getByRole("button", { name: at("next") }));
    expect(await screen.findByText("Phụ lục C")).toBeInTheDocument();
    expect(screen.queryByText("Hợp đồng ABC")).toBeNull();
    expect(screen.getByText(at("count_range", { from: 3, to: 4, total: 5 }))).toBeInTheDocument();
    expect(calls(REPORT_PATH).at(-1)?.searchParams.get("cursor")).toBe("cur1");

    const asked = calls(REPORT_PATH).length;
    fireEvent.click(screen.getByRole("button", { name: at("prev") }));
    expect(await screen.findByText("Hợp đồng ABC")).toBeInTheDocument();
    expect(calls(REPORT_PATH)).toHaveLength(asked);
  });

  it("Next is off on the last page", async () => {
    serve();
    renderView();
    await screen.findByText("Hợp đồng ABC");
    expect(screen.getByRole("button", { name: at("next") })).toHaveAttribute("aria-disabled", "true");
  });

  it("a filter change goes back to the first page", async () => {
    serve({ report: two });
    const nav = renderView();
    await screen.findByText("Hợp đồng ABC");
    fireEvent.click(screen.getByRole("button", { name: at("next") }));
    await screen.findByText("Phụ lục C");
    fireEvent.click(screen.getByRole("checkbox", { name: at("only_non_default") }));
    await waitFor(() => expect(lastUrl(nav).get("non_default")).toBe("1"));
    expect(await screen.findByText("Hợp đồng ABC")).toBeInTheDocument();
  });

  it("keeps asking while a page comes back empty but a cursor remains", async () => {
    serve({ report: (url) => (url.searchParams.get("cursor") === "cur1" ? page() : page({ ...EMPTY_PAGE, next_cursor: "cur1" })) });
    renderView();
    expect(await screen.findByText("Hợp đồng ABC")).toBeInTheDocument();
    expect(calls(REPORT_PATH)).toHaveLength(2);
  });

  it("Next reads on through empty pages to the next documents", async () => {
    serve({
      report: (url) => {
        switch (url.searchParams.get("cursor")) {
          case "cur1":
            return page({ ...EMPTY_PAGE, next_cursor: "cur2" });
          case "cur2":
            return page({ documents: [docEntry("d2", "Phụ lục B")], next_cursor: null });
          default:
            return page({ next_cursor: "cur1" });
        }
      },
    });
    renderView();
    await screen.findByText("Hợp đồng ABC");
    fireEvent.click(screen.getByRole("button", { name: at("next") }));
    expect(await screen.findByText("Phụ lục B")).toBeInTheDocument();
    expect(calls(REPORT_PATH)).toHaveLength(3);
  });

  it("a later page that fails keeps the documents shown and retries only that page", async () => {
    let fail = true;
    serve({
      report: (url) => {
        if (url.searchParams.get("cursor") === "cur1") {
          if (fail) throw new ApiError("boom", "internal", 500);
          return page({ documents: [docEntry("d2", "Phụ lục B")] });
        }
        return page({ next_cursor: "cur1" });
      },
    });
    renderView();
    await screen.findByText("Hợp đồng ABC");
    fireEvent.click(screen.getByRole("button", { name: at("next") }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(at("load_more_error"))).toBeInTheDocument();
    expect(screen.getByText("Hợp đồng ABC")).toBeInTheDocument();
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: at("retry") }));
    expect(await screen.findByText("Phụ lục B")).toBeInTheDocument();
  });
});

describe("AccessReportView - review fixes (r2)", () => {
  it("a filter change keeps the rows and the header title while the new first page loads", async () => {
    serve({
      report: (url) =>
        url.searchParams.get("non_default") ? new Promise(() => undefined) : page({ next_cursor: null }),
    });
    const nav = renderView();
    await screen.findByText("Hợp đồng ABC");
    fireEvent.click(screen.getByRole("checkbox", { name: at("only_non_default") }));
    await waitFor(() => expect(lastUrl(nav).get("non_default")).toBe("1"));
    await waitFor(() => expect(calls(REPORT_PATH).some((u) => u.searchParams.get("non_default") === "1")).toBe(true));
    expect(screen.getByText("Hợp đồng ABC")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: at("loading") })).toBeNull();
    expect(screen.getByText(at("scope_folder", { path: "Hợp đồng" }))).toBeInTheDocument();
  });

  it("Next is not left busy after the next page failed", async () => {
    serve({
      report: (url) => {
        if (url.searchParams.get("cursor") === "cur1") throw new ApiError("boom", "internal", 500);
        return page({ next_cursor: "cur1" });
      },
    });
    renderView();
    await screen.findByText("Hợp đồng ABC");
    fireEvent.click(screen.getByRole("button", { name: at("next") }));
    await screen.findByText(at("load_more_error"));
    const next = screen.getByRole("button", { name: at("next") });
    expect(next).not.toHaveAttribute("aria-busy");
    expect(next).not.toHaveAttribute("aria-disabled");
  });

  it("the count says N+ when the summary is truncated", async () => {
    serve({ summary: () => totals({ truncated: true }) });
    renderView();
    expect(await screen.findByText(at("count_range", { from: 1, to: 1, total: "5+" }))).toBeInTheDocument();
  });

  it("By person: no principals line once a filter narrows the people (it would mix two scopes)", async () => {
    serve();
    renderView(`${BASE_URL}?view=person&q=tr`);
    await screen.findByText("Trần Bình");
    expect(screen.queryByText(at("principals_line", { principals: 2, count: 11 }))).toBeNull();
  });
});

describe("AccessReportView - placeholder rows (r3)", () => {
  const hangOnFilter = (url: URL, first: unknown) =>
    url.searchParams.get("non_default") ? new Promise(() => undefined) : first;

  it("an empty result does not flash the empty state while a filter change loads", async () => {
    serve({ report: (url) => hangOnFilter(url, page(EMPTY_PAGE)), summary: () => totals({ skipped: 0, matching_documents: 0 }) });
    const nav = renderView();
    await screen.findByRole("heading", { name: at("empty") });
    fireEvent.click(screen.getByRole("checkbox", { name: at("only_non_default") }));
    await waitFor(() => expect(lastUrl(nav).get("non_default")).toBe("1"));
    await waitFor(() => expect(calls(REPORT_PATH).some((u) => u.searchParams.get("non_default") === "1")).toBe(true));
    expect(screen.queryByRole("heading", { name: at("empty") })).toBeNull();
    expect(screen.getByRole("status", { name: at("loading") })).toBeInTheDocument();
  });

  it("never asks for the next page with a placeholder cursor", async () => {
    serve({
      report: (url) => {
        if (url.searchParams.get("non_default")) return new Promise(() => undefined);
        if (url.searchParams.get("cursor") === "c1") throw new ApiError("boom", 500);
        return page({ ...EMPTY_PAGE, next_cursor: "c1" });
      },
    });
    const nav = renderView();
    await waitFor(() => expect(calls(REPORT_PATH).some((u) => u.searchParams.get("cursor") === "c1")).toBe(true));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("checkbox", { name: at("only_non_default") }));
    await waitFor(() => expect(lastUrl(nav).get("non_default")).toBe("1"));
    await waitFor(() => expect(calls(REPORT_PATH).some((u) => u.searchParams.get("non_default") === "1")).toBe(true));
    expect(calls(REPORT_PATH).filter((u) => u.searchParams.get("non_default") && u.searchParams.get("cursor"))).toHaveLength(0);
  });
});

describe("AccessReportView - states", () => {
  it("empty: nothing matches and nothing was skipped", async () => {
    serve({ report: () => page(EMPTY_PAGE), summary: () => totals({ skipped: 0, matching_documents: 0 }) });
    renderView();
    expect(await screen.findByRole("heading", { name: at("empty") })).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(at("empty_export_note"))).toBeInTheDocument();
  });

  it("skipped only: the reader manages nothing here", async () => {
    serve({ report: () => page({ documents: [], summary: { candidates: 4, documents: 0, rows: 0, skipped: 4 } }) });
    renderView();
    expect(await screen.findByRole("heading", { name: at("skipped_only") })).toBeInTheDocument();
  });

  it("error: an alert with Retry that asks again", async () => {
    let fail = true;
    serve({
      report: () => {
        if (fail) throw new ApiError("boom", "internal", 500);
        return page();
      },
    });
    renderView();
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(at("error"))).toBeInTheDocument();
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: at("retry") }));
    expect(await screen.findByText("Hợp đồng ABC")).toBeInTheDocument();
  });

  it("forbidden: a non-member is told to join the workspace, without tiles or tabs", async () => {
    serve({
      report: () => {
        throw new ApiError("no", "forbidden", 403);
      },
    });
    renderView();
    expect(await screen.findByRole("heading", { name: at("forbidden") })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("folder gone: says so and links back to the library", async () => {
    serve({
      report: () => {
        throw new ApiError("no", "not_found", 404);
      },
    });
    renderView();
    expect(await screen.findByRole("heading", { name: at("folder_unavailable") })).toBeInTheDocument();
    const back = screen.getAllByRole("link", { name: t("documents.page.title") });
    expect(back.some((a) => a.getAttribute("href") === "/acme/doi/documents")).toBe(true);
  });
});
