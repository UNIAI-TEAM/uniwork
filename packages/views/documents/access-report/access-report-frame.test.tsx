import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { DocumentAccessReportSchema } from "@uniwork/core/types/document-access-report";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { fakeNav, requestMock, wrapWithNav } from "../../test/api-mock";
import { DocPersonCell, ACCESS_PILL } from "../doclist/cells";
import vectors from "../doclist/doclist-vectors.json";
import { FILTER_SELECT, PILL, PILL_ON } from "../documents-library-toolbar";
import { SORT_HEADER_BUTTON } from "../library-sort-header";
import { AccessReportTable } from "./access-report-table";
import { AccessReportView } from "./access-report-view";

// UNI-2045 W16: the access report keeps its UNI-2039 content (By document /
// By person, their filters, export and sort) and takes the frame of the shared
// document list: the page container and header, the toolbar's chip and Select
// pieces, the table's header and row classes and the sort arrow, and the
// shared formatters and cells for the date, person and access columns.

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const i18n = initI18n();
const { t } = i18n;
const at = (key: string, opts?: Record<string, unknown>) => t(`documents.accessReport.${key}`, opts ?? {});

const WS = "ws1";
const REPORT_PATH = `/api/v1/workspaces/${WS}/documents/access-report`;
const SUMMARY_PATH = `${REPORT_PATH}/summary`;
const PRINCIPALS_PATH = `${REPORT_PATH}/principals`;
const BASE_URL = "/acme/doi/documents/access-report";

const workspace: Workspace = {
  id: WS, slug: "doi", name: "Đội", organization_id: "o1", organization_slug: "acme", organization_name: "Acme",
};
const viewer: User = {
  id: "me", email: "an@example.com", display_name: "Nguyễn An",
  onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};

const ownerRow = {
  source: "acl_owner", via: "member", principal_type: "user", principal_id: "u1", principal_name: "Nguyễn An",
  level: "manage", effective_level: "manage", active: true, granted_by: null, granted_by_name: null, granted_by_kind: null,
  granted_at: null, share_id: null,
};
const shareRow = {
  source: "share", via: "share", principal_type: "user", principal_id: "u2", principal_name: "Trần Bình",
  level: "edit", effective_level: "edit", active: true, granted_by: "u1", granted_by_name: "Nguyễn An", granted_by_kind: "human",
  granted_at: "2026-10-20T16:30:00", share_id: "s1", revoke_target: { kind: "share", id: "s1" },
};

function entry(id: string, title: string, over: Record<string, unknown> = {}, rows: unknown[] = [ownerRow, shareRow]) {
  return {
    document: {
      id, title, kind: "file", visibility: "workspace", path: [], acl_owner: { id: "u1", name: "Nguyễn An" }, live_link_count: 0,
      updated_at: "2026-10-18T12:00:00", general_scope: { kind: "workspace", level: "view" }, flags: [], ...over,
    },
    rows,
  };
}

const page = {
  scope: { kind: "workspace", workspace_id: WS, folder_id: null, folder_title: null },
  filter: { person_id: null, level: [], visibility: null },
  generated_at: "2026-10-15T03:40:00Z",
  documents: [entry("d1", "Hợp đồng ABC"), entry("d2", "Biên bản", { visibility: "restricted", general_scope: { kind: "restricted", level: null } })],
  summary: { candidates: 2, documents: 2, rows: 4, skipped: 0 },
  next_cursor: null,
};
const totals = {
  generated_at: "x",
  tiles: { public_link: 1, outside_workspace: 2, direct_manage: 3, documents: 2, restricted: 1, workspace: 1, organization: 0 },
  matching_documents: 2, skipped: 0, truncated: false,
};
const principals = {
  generated_at: "x",
  principals: [
    { principal_type: "user", principal_id: "u2", principal_name: "Trần Bình", kind: "member", member_count: null, document_count: 4, levels: { view: 1, comment: 0, edit: 1, manage: 2 }, main_source: "direct" },
    { principal_type: "workspace", principal_id: WS, principal_name: "Đội", kind: "home_workspace", member_count: 9, document_count: 2, levels: { view: 2, comment: 0, edit: 0, manage: 0 }, main_source: "workspace" },
  ],
  truncated: false,
};

function serve() {
  requestMock.mockImplementation(async (path: string) => {
    const url = new URL(path, "http://api.test");
    if (url.pathname === SUMMARY_PATH) return totals;
    if (url.pathname === PRINCIPALS_PATH) return principals;
    if (url.pathname === REPORT_PATH) return page;
    throw new Error(`unexpected request ${path}`);
  });
}

function renderView(url = BASE_URL) {
  render(
    wrapWithNav(
      <AccessReportView wsId={WS} workspaceName="Đội" workspaceSlug="doi" libraryHref="/acme/doi/documents" documentHref={(id) => `/acme/doi/documents/${id}`} />,
      fakeNav(url),
    ),
  );
}

const classes = (value: string) => value.split(" ").filter(Boolean);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(vectors.dates.now));
  requestMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  resetAuthStoreForTests();
  setSessionUser(viewer);
  serve();
});
afterEach(async () => {
  vi.useRealTimers();
  await setLocale("vi");
});

describe("access report frame - page header", () => {
  it("heads the screen like the other Documents screens: the title and the table sit in one max-w-6xl column", async () => {
    renderView();
    const title = screen.getByRole("heading", { level: 1, name: at("title") });
    expect(title).toHaveClass("text-title", "font-semibold");
    const table = await screen.findByRole("table", { name: at("title") });
    const column = title.closest(".max-w-6xl");
    expect(column).not.toBeNull();
    expect(column).toHaveClass("mx-auto", "px-4", "sm:px-6");
    expect(column).toContainElement(table);
    // The column scrolls with the page, as the other screens do.
    expect(column!.parentElement).toHaveClass("overflow-y-auto");
  });
});

describe("access report frame - toolbar", () => {
  it("styles the dropdown filters as the shared filter bar does and keeps single choices on the shared Select", async () => {
    renderView();
    await screen.findByRole("table", { name: at("title") });
    // A multi-choice filter stays a menu but wears the Select trigger's classes.
    expect(screen.getByRole("button", { name: new RegExp(`^${at("filter_level")}`) })).toHaveClass(...classes(FILTER_SELECT));
    // A single-choice filter is the shared Select (a combobox), named "Label: choice".
    const scope = screen.getByRole("combobox", { name: `${at("filter_scope")}: ${at("filter_all")}` });
    expect(scope).toHaveClass(...classes(FILTER_SELECT));
  });

  it("draws the active tile's chip with the shared pill", async () => {
    renderView(`${BASE_URL}?flag=public_link`);
    const chip = await screen.findByRole("button", { name: at("clear_chip", { name: at("flag_public_link") }) });
    // The chip carries an X, so it tightens the shared pill's gap on purpose.
    expect(chip).toHaveClass(...classes(PILL).filter((c) => c !== "gap-1.5"), ...classes(PILL_ON));
    expect(chip).toHaveClass("gap-1");
  });

  it("keeps the By person filters on the same pieces", async () => {
    renderView(`${BASE_URL}?view=person`);
    await screen.findByRole("table", { name: at("tab_people") });
    expect(screen.getByRole("combobox", { name: `${at("filter_kind")}: ${at("filter_all")}` })).toHaveClass(...classes(FILTER_SELECT));
  });
});

describe("access report frame - table", () => {
  it.each([
    ["documents", BASE_URL, "title"],
    ["people", `${BASE_URL}?view=person`, "tab_people"],
  ])("By %s: the shared header and row classes, one sorted column, its button inside", async (_name, url, label) => {
    renderView(url);
    const table = await screen.findByRole("table", { name: at(label) });
    // The shared list's box; a wide table scrolls inside it.
    expect(table.closest(".rounded-lg")).toHaveClass("overflow-hidden", "border", "border-border");
    expect(table).toHaveClass("text-left");
    const head = table.querySelector("thead")!;
    expect(head).toHaveClass("bg-muted/50");
    const headRow = head.querySelector("tr")!;
    expect(headRow).toHaveClass("border-b", "border-border", "text-caption", "text-muted-foreground");
    for (const th of within(headRow).getAllByRole("columnheader")) {
      expect(th).toHaveClass("py-2", "font-medium");
    }
    const row = table.querySelector("tbody > tr")!;
    expect(row).toHaveClass("border-b", "border-border", "hover:bg-accent/40");

    const sorted = within(headRow).getAllByRole("columnheader").filter((th) => /^(ascending|descending)$/.test(th.getAttribute("aria-sort") ?? ""));
    expect(sorted).toHaveLength(1);
    const button = within(sorted[0]!).getByRole("button");
    expect(button).toHaveClass(...classes(SORT_HEADER_BUTTON));
    // The arrow sits only on the sorted column.
    expect(headRow.querySelectorAll("svg")).toHaveLength(1);
    expect(sorted[0]!.querySelector("svg")).not.toBeNull();
  });
});

describe("access report frame - shared cells", () => {
  const rows = (dateCase: { at: string }) =>
    DocumentAccessReportSchema.parse({
      scope: { kind: "workspace", workspace_id: WS },
      documents: [entry("d1", "Hợp đồng ABC", { access_changed_at: dateCase.at }, [ownerRow, shareRow])],
    }).documents;

  function renderTable(documents = rows({ at: "2026-10-20T14:41:00" })) {
    return render(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={viewer}>
          <AccessReportTable wsId={WS} documents={documents} sort="changed" order="desc" onSortChange={vi.fn()} />
        </WorkspaceProvider>,
        fakeNav(BASE_URL),
      ),
    );
  }

  // The vectors that share the file's `now` and carry a date (the null one is the formatter's own empty case).
  const cases = vectors.dates.cases.filter((c): c is typeof c & { at: string } => c.at !== null && !("now" in c)).slice(0, 8);
  for (const locale of ["vi", "en"] as const) {
    for (const [index, c] of cases.entries()) {
      it(`#${index} the last-change cell reads the shared date format (${locale}): ${c[locale]}`, async () => {
        await setLocale(locale);
        renderTable(rows(c));
        const row = screen.getByText("Hợp đồng ABC").closest("tr")!;
        expect(within(row).getAllByRole("cell").at(-2)!.textContent).toBe(c[locale]);
      });
    }
  }

  it("reads a grant's date and its granter through the shared date format and person cell", async () => {
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: at("expand_document", { name: "Hợp đồng ABC" }) }));
    const grants = screen.getByRole("table", { name: "Hợp đồng ABC" });
    const grant = within(grants).getByText("Trần Bình").closest("tr")!;
    // 2026-10-20 16:30 is "yesterday" against the vectors' now.
    expect(within(grant).getByText(vectors.dates.cases[2]!.vi)).toBeInTheDocument();
    const granter = render(<DocPersonCell name="Nguyễn An" />).container.innerHTML;
    expect(grant.innerHTML).toContain(granter);
  });

  it("draws the general-access pill with the Badge primitive and the shared pill tones", async () => {
    renderTable();
    const pill = screen.getByText(at("scope_workspace_level", { level: at("level_view") }));
    const badge = pill.closest("[data-slot=badge]") ?? pill;
    expect(badge).toHaveClass(...classes(ACCESS_PILL.workspace));
    // The label still wraps inside its cell to two lines, as before.
    expect(pill).toHaveClass("line-clamp-2");
  });
});

describe("access report frame - nothing else moves", () => {
  it("still lists every UNI-2039 column and both views", async () => {
    renderView();
    const table = await screen.findByRole("table", { name: at("title") });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(6);
    expect(screen.getByRole("tab", { name: at("tab_documents") })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: at("tab_people") })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: at("export") })).toBeInTheDocument());
  });
});
