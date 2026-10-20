import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { fakeNav, requestMock, wrapWithNav } from "../../test/api-mock";
import { AccessReportPeople } from "./access-report-people";

// The By person table (UNI-2039 F4): one row per principal with its document
// count, a level split and its main source; a row opens onto that principal's
// documents (the page query with `principal=`), where Revoke asks first and
// waits for the server.

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { t } = initI18n();
const at = (key: string, opts?: Record<string, unknown>) => t(`documents.accessReport.${key}`, opts ?? {});

const WS = "ws1";
const PRINCIPALS_PATH = `/api/v1/workspaces/${WS}/documents/access-report/principals`;
const REPORT_PATH = `/api/v1/workspaces/${WS}/documents/access-report`;

const levels = (manage: number, edit: number, comment: number, view: number) => ({ manage, edit, comment, view });

const principals = [
  { principal_type: "workspace", principal_id: WS, principal_name: "UNICOM", kind: "home_workspace", member_count: 24, document_count: 9, levels: levels(0, 4, 0, 5), main_source: "workspace" },
  { principal_type: "user", principal_id: "u2", principal_name: "Hưng Nguyễn Duy", kind: "member", member_count: null, document_count: 4, levels: levels(2, 1, 0, 1), main_source: "direct" },
  { principal_type: "user", principal_id: "u3", principal_name: "Trần Thị Hiền", kind: "member", member_count: null, document_count: 3, levels: levels(0, 0, 2, 1), main_source: "chat" },
  { principal_type: "workspace", principal_id: "ws9", principal_name: "Phòng Kế toán", kind: "other_workspace", member_count: null, document_count: 1, levels: levels(0, 1, 0, 0), main_source: "direct" },
  { principal_type: "organization", principal_id: "org1", principal_name: null, kind: "organization", member_count: null, document_count: 1, levels: levels(0, 0, 0, 1), main_source: "workspace" },
  { principal_type: "link", principal_id: null, principal_name: null, kind: "link", member_count: null, document_count: 1, levels: levels(0, 0, 0, 1), main_source: "link" },
];

const grant = (over: Record<string, unknown>) => ({
  source: "share",
  via: "share",
  principal_type: "user",
  principal_id: "u2",
  principal_name: "Hưng Nguyễn Duy",
  level: "manage",
  effective_level: "manage",
  active: true,
  granted_by: "u1",
  granted_by_name: "Nguyễn An",
  granted_by_kind: "human",
  granted_at: "2026-10-20T03:00:00Z",
  share_id: "s1",
  revoke_target: { kind: "share", id: "s1" },
  ...over,
});

function reportFor(documents: unknown[], next_cursor: string | null = null) {
  return {
    scope: { kind: "workspace", workspace_id: WS, folder_id: null, folder_title: null },
    filter: { person_id: null, level: [], visibility: null },
    generated_at: "2026-10-21T01:00:00Z",
    documents,
    summary: { candidates: documents.length, documents: documents.length, rows: documents.length, skipped: 0 },
    next_cursor,
  };
}

const docEntry = (id: string, title: string, rows: unknown[], kind = "file") => ({
  document: { id, title, kind, visibility: "restricted", path: [], acl_owner: null, live_link_count: 0, updated_at: "2026-10-01T03:00:00Z" },
  rows,
});

const hungDocs = [
  docEntry("d1", "Đề xuất ngân sách Q4.docx", [grant({})]),
  docEntry("d2", "Biên bản nghiệm thu R1.docx", [
    grant({ share_id: "s9", level: "edit", effective_level: "edit", source: "workspace", revoke_target: null }),
  ]),
  docEntry("d3", "Hợp đồng mẫu.docx", [grant({ share_id: "s7", level: "view", effective_level: "view", origin: "chat" })]),
];

/** Answer the principals list and the report; `report` decides each page call. */
function serve(report: (url: URL) => unknown = () => reportFor(hungDocs), list: unknown = { generated_at: "x", principals, truncated: false }) {
  requestMock.mockImplementation(async (path: string, init?: RequestInit) => {
    const url = new URL(path, "http://api.test");
    if (init?.method === "DELETE") return undefined;
    if (url.pathname === PRINCIPALS_PATH) return typeof list === "function" ? (list as (u: URL) => unknown)(url) : list;
    if (url.pathname === REPORT_PATH) return report(url);
    throw new Error(`unexpected request ${path}`);
  });
}

function calls(pathname: string): URL[] {
  return requestMock.mock.calls
    .map(([path]) => new URL(String(path), "http://api.test"))
    .filter((url) => url.pathname === pathname);
}

function renderPeople(props: Partial<React.ComponentProps<typeof AccessReportPeople>> = {}) {
  render(
    wrapWithNav(
      <AccessReportPeople wsId={WS} documentHref={(id) => `/acme/doi/documents/${id}`} {...props} />,
      fakeNav("/acme/doi/documents/access-report"),
    ),
  );
}

const personRow = (name: string) => screen.getByText(name).closest("tr")!;
const expandLabel = (name: string) => at("expand_person", { name });

beforeEach(() => {
  requestMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  resetAuthStoreForTests();
});

describe("AccessReportPeople - rows", () => {
  it("shows a status while the principals load", () => {
    requestMock.mockImplementation(() => new Promise(() => {}));
    renderPeople();
    expect(screen.getByRole("status", { name: at("loading") })).toBeInTheDocument();
  });

  it("draws one header and one row per principal: name, kind line, count, split and main source", async () => {
    serve();
    renderPeople();
    const table = await screen.findByRole("table", { name: at("tab_people") });
    expect(within(table).getAllByRole("rowgroup")[0]!.querySelectorAll("tr")).toHaveLength(1);
    expect(table.querySelectorAll("tbody > tr")).toHaveLength(principals.length);
    for (const col of ["col_principal", "col_count", "col_split", "col_main_source"]) {
      expect(within(table).getByRole("columnheader", { name: new RegExp(`${at(col)}|${at("sort_by", { column: at(col) })}`) })).toBeInTheDocument();
    }

    const hung = personRow("Hưng Nguyễn Duy");
    expect(within(hung).getByText(at("kind_member"))).toBeInTheDocument();
    expect(within(hung).getByText("4")).toBeInTheDocument();
    expect(within(hung).getByText(`2 ${at("level_manage")} · 1 ${at("level_edit")} · 1 ${at("level_view")}`)).toBeInTheDocument();
    expect(within(hung).getByText(at("source_direct"))).toBeInTheDocument();

    const home = personRow("UNICOM");
    expect(within(home).getByText(at("kind_home_workspace", { count: 24 }))).toBeInTheDocument();
    expect(within(home).getByText(`4 ${at("level_edit")} · 5 ${at("level_view")}`)).toBeInTheDocument();
    expect(within(home).getByText(at("source_workspace_default"))).toBeInTheDocument();

    expect(within(personRow("Trần Thị Hiền")).getByText(at("source_chat"))).toBeInTheDocument();
    expect(within(personRow("Phòng Kế toán")).getByText(at("kind_other_workspace"))).toBeInTheDocument();
  });

  it("names a link and an unnamed organization without inventing mock data", async () => {
    serve();
    renderPeople();
    await screen.findByText(at("anyone_with_link"));
    const link = personRow(at("anyone_with_link"));
    expect(within(link).getByText(at("kind_link"))).toBeInTheDocument();
    expect(within(link).getByText(at("source_link"))).toBeInTheDocument();
    // The organization has no name on the wire: its kind stands in for it.
    const orgRow = screen.getAllByText(at("kind_organization"))[0]!.closest("tr")!;
    expect(within(orgRow).getByText("1")).toBeInTheDocument();
  });

  it("reads an unknown kind or main source as Other", async () => {
    serve(undefined, {
      generated_at: "x",
      principals: [
        { ...principals[1], principal_name: "Ẩn Danh", kind: "from_the_future", main_source: "from_the_future" },
      ],
      truncated: false,
    });
    renderPeople();
    await screen.findByText("Ẩn Danh");
    const row = personRow("Ẩn Danh");
    expect(within(row).getAllByText(at("principal_other"))).toHaveLength(2);
  });

  it("draws the split bar from tokens, each level at its own lightness, hidden from assistive tech", async () => {
    serve();
    renderPeople();
    await screen.findByText("Hưng Nguyễn Duy");
    const row = personRow("Hưng Nguyễn Duy");
    const bar = row.querySelector("[data-slot='level-split']") as HTMLElement;
    expect(bar).toHaveAttribute("aria-hidden", "true");
    const segments = Array.from(bar.children) as HTMLElement[];
    expect(segments).toHaveLength(3); // manage, edit, view; comment is 0
    const tones = segments.map((s) => s.className.split(/\s+/).find((c) => c.startsWith("bg-")));
    expect(new Set(tones).size).toBe(3);
    expect(segments.map((s) => s.style.width)).toEqual(["50%", "25%", "25%"]);
    expect(bar.outerHTML).not.toMatch(/#[0-9a-f]{3,8}|rgb\(/i);
  });

  it("sends the folder, the search, the kind and the levels to the server", async () => {
    serve();
    renderPeople({ folderId: "f1", search: "  hưng ", kind: "member", levels: ["edit", "manage"] });
    await screen.findByRole("table");
    const url = calls(PRINCIPALS_PATH)[0]!;
    expect(url.searchParams.get("folder_id")).toBe("f1");
    expect(url.searchParams.get("q")).toBe("hưng");
    expect(url.searchParams.get("kind")).toBe("member");
    expect(url.searchParams.get("level")).toBe("edit,manage");
  });
});

describe("AccessReportPeople - sort", () => {
  it("starts on the document count, largest first, with the arrow only on that column", async () => {
    serve();
    renderPeople();
    await screen.findByRole("table");
    expect(calls(PRINCIPALS_PATH)[0]!.searchParams.get("sort")).toBe("count");
    expect(calls(PRINCIPALS_PATH)[0]!.searchParams.get("order")).toBe("desc");
    const count = screen.getByRole("columnheader", { name: new RegExp(at("col_count")) });
    expect(count).toHaveAttribute("aria-sort", "descending");
    expect(count.querySelector("svg")).not.toBeNull();
    const name = screen.getByRole("columnheader", { name: new RegExp(at("col_principal")) });
    expect(name).toHaveAttribute("aria-sort", "none");
    expect(name.querySelector("svg")).toBeNull();
  });

  it("clicking the sorted column flips it; the server answers, the page does not re-sort", async () => {
    serve();
    renderPeople();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: at("sort_by", { column: at("col_count") }) }));
    await waitFor(() => expect(calls(PRINCIPALS_PATH).at(-1)!.searchParams.get("order")).toBe("asc"));
    expect(calls(PRINCIPALS_PATH).at(-1)!.searchParams.get("sort")).toBe("count");
    expect(screen.getByRole("columnheader", { name: new RegExp(at("col_count")) })).toHaveAttribute("aria-sort", "ascending");
    // The rows keep the order the server sent.
    const names = Array.from(document.querySelectorAll("tbody tr td:first-child")).map((c) => c.textContent);
    expect(names[0]).toContain("UNICOM");
  });

  it("picking the name column sorts A to Z first", async () => {
    serve();
    renderPeople();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: at("sort_by", { column: at("col_principal") }) }));
    await waitFor(() => expect(calls(PRINCIPALS_PATH).at(-1)!.searchParams.get("sort")).toBe("name"));
    expect(calls(PRINCIPALS_PATH).at(-1)!.searchParams.get("order")).toBe("asc");
    expect(screen.getByRole("columnheader", { name: new RegExp(at("col_principal")) })).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByRole("columnheader", { name: new RegExp(at("col_count")) })).toHaveAttribute("aria-sort", "none");
  });

  it("gives the sort buttons a 44px hit area on coarse pointers", async () => {
    serve();
    renderPeople();
    await screen.findByRole("table");
    expect(screen.getByRole("button", { name: at("sort_by", { column: at("col_count") }) }).className).toContain("pointer-coarse:min-h-11");
  });
});

describe("AccessReportPeople - states", () => {
  it("says so when nobody holds access, never drawing rows", async () => {
    serve(undefined, { generated_at: "x", principals: [], truncated: false });
    renderPeople();
    expect(await screen.findByRole("heading", { name: at("empty") })).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows an alert with Retry when the call fails, and asks again", async () => {
    let fail = true;
    serve(undefined, () => {
      if (fail) throw new ApiError("boom", "internal", 500);
      return { generated_at: "x", principals, truncated: false };
    });
    renderPeople();
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(at("error"))).toBeInTheDocument();
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: at("retry") }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("treats a body that is not a principal list as an error, not as an empty list", async () => {
    serve(undefined, "garbage");
    renderPeople();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: at("empty") })).toBeNull();
  });
});

describe("AccessReportPeople - open row", () => {
  it("opens a principal's documents with the page query and lists icon, name, level, source", async () => {
    serve();
    renderPeople({ folderId: "f1", levels: ["manage", "edit"] });
    await screen.findByRole("table");
    const toggle = screen.getByRole("button", { name: expandLabel("Hưng Nguyễn Duy") });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(calls(REPORT_PATH)).toHaveLength(0);

    fireEvent.click(toggle);
    const open = screen.getByRole("button", { name: at("collapse", { name: "Hưng Nguyễn Duy" }) });
    expect(open).toHaveAttribute("aria-expanded", "true");
    expect(open).toHaveAttribute("aria-controls");

    const list = await screen.findByRole("list", { name: at("expand_person", { name: "Hưng Nguyễn Duy" }) });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    const url = calls(REPORT_PATH)[0]!;
    expect(url.searchParams.get("principal")).toBe("user:u2");
    expect(url.searchParams.get("folder_id")).toBe("f1");
    expect(url.searchParams.get("level")).toBe("manage,edit");

    const first = within(list).getAllByRole("listitem")[0]!;
    expect(within(first).getByText("Đề xuất ngân sách Q4.docx")).toBeInTheDocument();
    expect(first.querySelector("[aria-hidden]")).not.toBeNull();
    expect(within(first).getByText(at("level_manage"))).toBeInTheDocument();
    expect(within(first).getByText(at("source_direct"))).toBeInTheDocument();
    expect(within(first).getByRole("link", { name: "Đề xuất ngân sách Q4.docx" })).toHaveAttribute("href", "/acme/doi/documents/d1");
    const third = within(list).getAllByRole("listitem")[2]!;
    expect(within(third).getByText(at("source_chat"))).toBeInTheDocument();
  });

  it("drops the split bar and the main source below sm, and sizes an open row to the scroll box", async () => {
    serve();
    renderPeople();
    const table = await screen.findByRole("table", { name: at("tab_people") });
    expect(table.className).toContain("sm:min-w-[56rem]");
    for (const col of ["col_split", "col_main_source"]) {
      expect(within(table).getByRole("columnheader", { name: at(col) })).toHaveClass("max-sm:hidden");
    }
    const hung = personRow("Hưng Nguyễn Duy");
    expect(within(hung).getAllByRole("cell").filter((c) => c.classList.contains("max-sm:hidden"))).toHaveLength(2);
    expect(table.parentElement).toHaveClass("overflow-x-auto", "[container-type:inline-size]");

    fireEvent.click(screen.getByRole("button", { name: expandLabel("Hưng Nguyễn Duy") }));
    const list = await screen.findByRole("list", { name: expandLabel("Hưng Nguyễn Duy") });
    const pinned = list.closest("[data-people-pin]")!;
    expect(pinned).toHaveClass("sticky", "left-3");
    expect(pinned.className).toContain("100cqw");
    // Source and Revoke wrap under the name on a phone; they are fixed columns only from sm.
    const item = within(list).getAllByRole("listitem")[0]!;
    expect(within(item).getByText(at("source_direct"))).toHaveClass("sm:w-48");
    expect(within(item).getByRole("button", { name: at("revoke") }).parentElement).toHaveClass("sm:w-24");
  });

  it("turns the public link off in words the link can bear: no one's name to revoke", async () => {
    const linkGrant = grant({ source: "link", principal_type: "link", principal_id: "l1", principal_name: null, share_id: undefined, revoke_target: { kind: "link", id: "l1" } });
    serve(() => reportFor([docEntry("d1", "Bảng giá 2026.xlsx", [linkGrant])]));
    renderPeople();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: expandLabel(at("anyone_with_link")) }));
    const list = await screen.findByRole("list", { name: expandLabel(at("anyone_with_link")) });
    fireEvent.click(within(list).getByRole("button", { name: at("revoke") }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(at("revoke_title_link"))).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: at("revoke") }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(at("revoke_done_link")));
  });

  it("collapses again and keeps one row open at a time", async () => {
    serve();
    renderPeople();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: expandLabel("Hưng Nguyễn Duy") }));
    await screen.findByRole("list");
    fireEvent.click(screen.getByRole("button", { name: expandLabel("Trần Thị Hiền") }));
    expect(screen.getByRole("button", { name: expandLabel("Hưng Nguyễn Duy") })).toHaveAttribute("aria-expanded", "false");
    expect(calls(REPORT_PATH).at(-1)!.searchParams.get("principal")).toBe("user:u3");
    fireEvent.click(screen.getByRole("button", { name: at("collapse", { name: "Trần Thị Hiền" }) }));
    await waitFor(() => expect(screen.queryByRole("list")).toBeNull());
  });

  it("asks for the group by its type and id, and for the link by its bare type", async () => {
    serve();
    renderPeople();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: expandLabel("Phòng Kế toán") }));
    await waitFor(() => expect(calls(REPORT_PATH).at(-1)?.searchParams.get("principal")).toBe("workspace:ws9"));
    fireEvent.click(screen.getByRole("button", { name: expandLabel(at("anyone_with_link")) }));
    await waitFor(() => expect(calls(REPORT_PATH).at(-1)?.searchParams.get("principal")).toBe("link"));
  });

  it("shows only the open principal's grants, even if the server sends the document's others", async () => {
    serve(() =>
      reportFor([
        docEntry("d1", "Đề xuất ngân sách Q4.docx", [
          grant({ principal_id: "u9", principal_name: "Người Khác", share_id: "sx" }),
          grant({}),
        ]),
      ]),
    );
    renderPeople();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: expandLabel("Hưng Nguyễn Duy") }));
    const list = await screen.findByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
  });

  it("shows a status while the documents load, an empty note, and an error with Retry", async () => {
    serve(() => new Promise(() => {}));
    const { unmount } = render(
      wrapWithNav(<AccessReportPeople wsId={WS} />, fakeNav("/acme/doi/documents/access-report")),
    );
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: expandLabel("Hưng Nguyễn Duy") }));
    expect(await screen.findByRole("status", { name: at("loading") })).toBeInTheDocument();
    unmount();

    requestMock.mockReset();
    serve(() => reportFor([]));
    renderPeople();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: expandLabel("Hưng Nguyễn Duy") }));
    expect(await screen.findByText(at("empty"))).toBeInTheDocument();
  });

  it("reports a failed document page under the row and retries it", async () => {
    let fail = true;
    serve(() => {
      if (fail) throw new ApiError("boom", "internal", 500);
      return reportFor(hungDocs);
    });
    renderPeople();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: expandLabel("Hưng Nguyễn Duy") }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(at("error"))).toBeInTheDocument();
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: at("retry") }));
    expect(await screen.findByRole("list")).toBeInTheDocument();
  });

  it("loads the next page of documents on request", async () => {
    serve((url) =>
      url.searchParams.get("cursor") === "c1"
        ? reportFor([docEntry("d4", "Phụ lục B.docx", [grant({ share_id: "s4", revoke_target: { kind: "share", id: "s4" } })])])
        : reportFor(hungDocs, "c1"),
    );
    renderPeople();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: expandLabel("Hưng Nguyễn Duy") }));
    await screen.findByRole("list");
    fireEvent.click(screen.getByRole("button", { name: at("load_more") }));
    expect(await screen.findByText("Phụ lục B.docx")).toBeInTheDocument();
    expect(calls(REPORT_PATH).at(-1)!.searchParams.get("cursor")).toBe("c1");
    expect(screen.queryByRole("button", { name: at("load_more") })).toBeNull();
  });
});

describe("AccessReportPeople - row identity", () => {
  it("opens only the row that was clicked when two principals share a param but not a kind", async () => {
    const twin = { principal_type: "user", principal_id: "u2", principal_name: "Hưng Nguyễn Duy", member_count: null, document_count: 2, levels: levels(0, 0, 1, 1), main_source: "direct" };
    serve(undefined, {
      generated_at: "x",
      principals: [
        { ...twin, kind: "member" },
        { ...twin, principal_name: "Hưng (cũ)", kind: "other_workspace" },
      ],
      truncated: false,
    });
    renderPeople();
    fireEvent.click(await screen.findByRole("button", { name: expandLabel("Hưng Nguyễn Duy") }));
    expect(screen.getByRole("button", { name: at("collapse", { name: "Hưng Nguyễn Duy" }) })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: expandLabel("Hưng (cũ)") })).toHaveAttribute("aria-expanded", "false");
  });
});

describe("AccessReportPeople - revoke", () => {
  async function openHung() {
    renderPeople();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: expandLabel("Hưng Nguyễn Duy") }));
    return within(await screen.findByRole("list"));
  }

  it("offers Revoke only on grants the server named a target for", async () => {
    serve();
    const list = await openHung();
    expect(list.getAllByRole("button", { name: at("revoke") })).toHaveLength(2);
    const workspaceDefault = list.getByText("Biên bản nghiệm thu R1.docx").closest("li")!;
    expect(within(workspaceDefault).queryByRole("button", { name: at("revoke") })).toBeNull();
  });

  it("revokes after a confirmation, through the share route, says so, and does not remove the row itself", async () => {
    serve();
    const list = await openHung();
    const item = list.getByText("Đề xuất ngân sách Q4.docx").closest("li")!;
    fireEvent.click(within(item).getByRole("button", { name: at("revoke") }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(at("revoke_title", { name: "Hưng Nguyễn Duy" }))).toBeInTheDocument();
    expect(requestMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "DELETE")).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: at("revoke") }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(at("revoke_done", { name: "Hưng Nguyễn Duy" })));
    const del = requestMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "DELETE")!;
    expect(del[0]).toBe("/api/v1/documents/d1/shares/s1");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("keeps the grant and toasts when the server refuses", async () => {
    serve();
    const list = await openHung();
    requestMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === "DELETE") throw new ApiError("no", "forbidden", 403);
      return new URL(path, "http://api.test").pathname === REPORT_PATH ? reportFor(hungDocs) : { generated_at: "x", principals, truncated: false };
    });
    fireEvent.click(within(list.getByText("Đề xuất ngân sách Q4.docx").closest("li")!).getByRole("button", { name: at("revoke") }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: at("revoke") }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(at("revoke_failed")));
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByText("Đề xuất ngân sách Q4.docx")).toBeInTheDocument();
  });

  it("cancelling the confirmation calls nothing", async () => {
    serve();
    const list = await openHung();
    fireEvent.click(within(list.getByText("Đề xuất ngân sách Q4.docx").closest("li")!).getByRole("button", { name: at("revoke") }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.cancel") }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(requestMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "DELETE")).toBe(false);
  });
});
