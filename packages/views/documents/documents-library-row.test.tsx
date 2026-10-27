import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { DocumentsLibraryList } from "./documents-library-list";
import { formatLockTime } from "./edit-lock-copy";
import { LibraryRowView, type LibraryRowHandlers } from "./documents-library-row";
import { specLadder } from "./library-columns";
import { documentRow, type DocumentSummaryRow } from "./library-rows";
import { favoriteRow } from "./starred-rows";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import type { DocListScreen } from "./doclist/columns";

// TRASH-01 Area 2 (UNI-1841): the documents table takes the board's six columns
// (Tên · Truy cập · Người sửa gần nhất · Cập nhật · Dung lượng · Thao tác) at
// Home and inside a folder alike, Truy cập shows the visibility + the viewer's
// level on two lines, and folder rows offer Star / Unstar in their ⋯ menu (SV-4).

const { t } = initI18n();

beforeAll(async () => {
  await setLocale("vi");
});
afterAll(async () => {
  await setLocale("en");
});

// A row's scope comes from `share_scope` only; it is never guessed from `visibility`.
const SCOPE_PRIVATE = { users: 0, home_workspace: false, workspaces: 0, organization: false, public_link: false };
const SCOPE_HOME = { ...SCOPE_PRIVATE, home_workspace: true };

function doc(id: string, title: string, over: Partial<DocumentSummaryRow> = {}): DocumentSummaryRow {
  return {
    id,
    organization_id: "org1",
    workspace_id: "ws1",
    kind: "file",
    title,
    visibility: "workspace",
    revision: "1",
    current_version: 1,
    position: 0,
    my_level: "edit",
    created_by: "",
    created_by_kind: "human",
    updated_by: "u1",
    updated_by_kind: "human",
    created_at: "",
    updated_at: "2026-09-28T03:00:00Z",
    size_bytes: 2500,
    ...over,
  };
}

const handlers: LibraryRowHandlers = {
  onOpen: vi.fn(),
  onFolder: vi.fn(),
  onGoToSource: vi.fn(),
  onDownloadSource: vi.fn(),
  onSaveSource: vi.fn(),
  onToggleStar: vi.fn(),
  isStarred: () => false,
  personName: () => "An",
};

function renderList(rows: DocumentSummaryRow[], over: Partial<LibraryRowHandlers> = {}, opts: { screen?: DocListScreen } = {}) {
  return render(
    <DocumentsLibraryList
      groups={[{ key: "all", rows: rows.map(documentRow) }]}
      loading={false}
      failure={null}
      filteredBy={null}
      hasMore={false}
      loadingMore={false}
      onLoadMore={vi.fn()}
      onRetry={vi.fn()}
      onClearFilters={vi.fn()}
      handlers={{ ...handlers, ...over }}
      screen={opts.screen}
      empty={{ title: "empty", description: "empty" }}
    />,
  );
}

function renderRow(row: DocumentSummaryRow, over: Partial<LibraryRowHandlers> = {}) {
  return render(
    <table>
      <tbody>
        <LibraryRowView row={documentRow(row)} handlers={{ ...handlers, ...over }} ladder={specLadder("workspace", { selectable: false })} />
      </tbody>
    </table>,
  );
}

const cellsOf = (id: string) => Array.from(document.querySelector(`[data-library-row="${id}"]`)!.querySelectorAll("td"));

async function openMenu(id: string, title: string) {
  const row = document.querySelector(`[data-library-row="${id}"]`) as HTMLElement;
  fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.menu", { title }) }));
  await screen.findByRole("menu");
  return row;
}

describe("board columns", () => {
  it("renders the six board columns in order", () => {
    renderList([doc("a", "A.docx")]);
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Tên",
      "Truy cập",
      "Người sửa gần nhất",
      "Cập nhật",
      "Dung lượng",
      "Thao tác",
    ]);
  });

  it("renders the same six columns for the open folder view too (no Type column)", () => {
    // The folder view used to swap in a Type column; the board uses one layout.
    renderList([doc("fo1", "Dự án", { kind: "folder" })]);
    const names = screen.getAllByRole("columnheader").map((th) => th.textContent);
    expect(names).toEqual(["Tên", "Truy cập", "Người sửa gần nhất", "Cập nhật", "Dung lượng", "Thao tác"]);
    expect(names).not.toContain("Loại");
    expect(names).not.toContain("Nguồn");
  });
});

describe("access column", () => {
  it("shows the visibility on line 1 and 'Bạn: <level>' on line 2", () => {
    renderList([
      doc("a", "A.docx", { my_level: "manage", visibility: "restricted", share_scope: SCOPE_PRIVATE }),
      doc("b", "B.docx", { my_level: "view", visibility: "workspace", share_scope: SCOPE_HOME }),
    ]);
    const accessA = cellsOf("a")[1]!;
    expect(within(accessA).getByText("Riêng tư")).toBeTruthy();
    expect(within(accessA).getByText("Bạn: Quản lý")).toBeTruthy();
    // UNI-2045 W1b: a restricted row is a filled grey pill (muted tokens) with the lock ahead of the label.
    const pillA = accessA.querySelector("[data-access-kind='restricted']")!;
    expect(pillA).toHaveClass("bg-muted", "text-muted-foreground");
    expect(pillA.querySelector("svg")).toBeTruthy();
    const accessB = cellsOf("b")[1]!;
    expect(within(accessB).getByText("Workspace")).toBeTruthy();
    // UNI-2045: the shared level words (Xem / Bình luận / Sửa / Quản lý).
    expect(within(accessB).getByText("Bạn: Xem")).toBeTruthy();
  });

  it("reads 'Chủ sở hữu' when the row's via is owner (until SV-5 sends is_owner)", () => {
    renderList([doc("a", "A.docx", { my_level: "manage", via: "owner" as DocumentSummaryRow["via"] })]);
    const access = cellsOf("a")[1]!;
    expect(within(access).getByText("Chủ sở hữu")).toBeTruthy();
    expect(within(access).queryByText("Bạn: Quản lý")).toBeNull();
  });

  it("reads is_owner (SV-5) over via, both ways", () => {
    renderList([
      doc("a", "A.docx", { my_level: "manage", via: "share" as DocumentSummaryRow["via"], is_owner: true }),
      doc("b", "B.docx", { my_level: "edit", via: "owner" as DocumentSummaryRow["via"], is_owner: false }),
    ]);
    expect(within(cellsOf("a")[1]!).getByText("Chủ sở hữu")).toBeTruthy();
    expect(within(cellsOf("b")[1]!).getByText("Bạn: Sửa")).toBeTruthy();
    expect(within(cellsOf("b")[1]!).queryByText("Chủ sở hữu")).toBeNull();
  });

  it("names the editor from updated_by_user (SV-6) with the photo, else from the member list", () => {
    const member = (id: string) => (id === "u1" ? { name: "An", avatarUrl: "https://cdn.test/member-an.png" } : ("former" as const));
    renderList(
      [
        doc("a", "A.docx", { updated_by_user: { name: "Nguyễn Văn An", avatar_url: "https://cdn.test/an.png" } }),
        doc("b", "B.docx", { updated_by_user: { name: "Lê Bảo" } }),
        doc("c", "C.docx"),
      ],
      { member },
    );
    const editor = (id: string) => cellsOf(id).find((td) => td.dataset.column === "editor")!;
    expect(within(editor("a")).getByText("Nguyễn Văn An")).toBeTruthy();
    expect(editor("a").querySelector("img")?.getAttribute("src")).toBe("https://cdn.test/an.png");
    // A photo-less editor draws the initial, never another person's photo.
    expect(within(editor("b")).getByText("Lê Bảo")).toBeTruthy();
    expect(editor("b").querySelector("img")).toBeNull();
    // Today's server: the member list names the editor and gives the photo.
    expect(within(editor("c")).getByText("An")).toBeTruthy();
    expect(editor("c").querySelector("img")?.getAttribute("src")).toBe("https://cdn.test/member-an.png");
  });

  it("labels unshared restricted rows as 'Riêng tư'", () => {
    renderList([doc("a", "A.docx", { visibility: "restricted", share_scope: SCOPE_PRIVATE, via: "owner" as DocumentSummaryRow["via"] })]);
    expect(screen.getAllByText("Riêng tư").length).toBeGreaterThanOrEqual(1);
  });

  it("reads an unknown visibility as Riêng tư with no level line, and keeps the narrow-row level off the secondary line", () => {
    renderList([doc("c", "C.docx", { my_level: undefined, visibility: "weird" as DocumentSummaryRow["visibility"] })]);
    // UNI-2045: the shared pill never guesses a wider scope; with no level there is no "Bạn:" line.
    expect(cellsOf("c")[1]!.querySelector("[data-access-kind]")).toHaveAttribute("data-access-kind", "restricted");
    expect(cellsOf("c")[1]!.textContent).not.toMatch(/Bạn:/);
    const line = document.querySelector('[data-library-row="c"] [data-library-access-line]')!;
    expect(line.textContent).not.toMatch(/Bạn:/);
  });

  it("keeps the scope tooltip out of the name button's accessible name while it still describes the badge (R3-03)", () => {
    renderList([
      doc("a", "Kế hoạch Q4", {
        share_scope: { users: 2, home_workspace: true, workspaces: 0, organization: false, public_link: false },
      }),
    ]);

    const row = document.querySelector('[data-library-row="a"]') as HTMLElement;
    const nameButton = within(row).getAllByRole("button")[0]!;
    expect(nameButton).toHaveAccessibleName(/Kế hoạch Q4/);
    expect(nameButton).not.toHaveAccessibleName(/Workspace · 2 người/);

    const badge = within(row).getAllByTestId("document-share-scope-badge")[0]!;
    const descId = badge.getAttribute("aria-describedby");
    expect(descId).toBeTruthy();
    expect(document.getElementById(descId!)?.textContent).toBe("Workspace · 2 người");
  });
});

describe("shared by me scope line (SW-V2, SW-V4)", () => {
  it("shows the plain home-workspace scope on the narrow line only on Shared by me", () => {
    renderList([doc("a", "A.docx", { visibility: "workspace", share_scope: SCOPE_HOME })], {}, { screen: "shared-by-me" });
    const line = document.querySelector('[data-library-row="a"] [data-library-access-line]') as HTMLElement;
    const badge = within(line).getByTestId("document-share-scope-badge");
    expect(badge.textContent).toBe("Workspace");
    expect(badge.getAttribute("data-scope-kind")).toBe("workspace");
  });

  it("shows no scope badge on a folder row, whatever share_scope a legacy row carries", () => {
    renderList([doc("fo", "Thư mục", { kind: "folder", visibility: "workspace", share_scope: SCOPE_HOME })]);
    const row = document.querySelector('[data-library-row="fo"]') as HTMLElement;
    expect(within(row).queryByTestId("document-share-scope-badge")).toBeNull();
  });

  it("keeps the plain home-workspace scope off the narrow line on the other views", () => {
    renderList([doc("a", "A.docx", { visibility: "workspace", share_scope: SCOPE_HOME })]);
    const line = document.querySelector('[data-library-row="a"] [data-library-access-line]') as HTMLElement;
    expect(within(line).queryByTestId("document-share-scope-badge")).toBeNull();
  });

  it("points the name button's aria-describedby at the scope composition (SW-V4)", () => {
    renderList([
      doc("a", "Kế hoạch Q4", {
        share_scope: { users: 2, home_workspace: true, workspaces: 0, organization: false, public_link: false },
      }),
    ]);
    const row = document.querySelector('[data-library-row="a"]') as HTMLElement;
    const nameButton = within(row).getAllByRole("button")[0]!;
    // The composition is a description, not part of the accessible name (R3-03).
    expect(nameButton).toHaveAccessibleName(/Kế hoạch Q4/);
    expect(nameButton).not.toHaveAccessibleName(/Workspace · 2 người/);
    const descId = nameButton.getAttribute("aria-describedby");
    expect(descId).toBeTruthy();
    expect(document.getElementById(descId!)?.textContent).toBe("Workspace · 2 người");
  });

  it("exposes the scope composition to sighted keyboard/touch users in the ⋯ menu (SW-V4)", async () => {
    renderList([
      doc("a", "Kế hoạch Q4", {
        share_scope: { users: 2, home_workspace: true, workspaces: 0, organization: false, public_link: false },
      }),
    ]);
    await openMenu("a", "Kế hoạch Q4");
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("Workspace · 2 người")).toBeTruthy();
  });

  it("leaves a row without scope untouched: no describedby, no menu label (SW-V4)", async () => {
    renderList([doc("a", "Kế hoạch Q4")]);
    const row = document.querySelector('[data-library-row="a"]') as HTMLElement;
    const nameButton = within(row).getAllByRole("button")[0]!;
    expect(nameButton.getAttribute("aria-describedby")).toBeNull();
    await openMenu("a", "Kế hoạch Q4");
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByText(/người/)).toBeNull();
  });

  it("builds no scope composition for a plain home-workspace row off Shared by me, even with a resolved workspace name", async () => {
    const workspace: Workspace = { id: "ws1", slug: "team", name: "Đội", organization_id: "org1", organization_slug: "acme", organization_name: "Acme" };
    const sessionUser: User = {
      id: "u1",
      email: "an@acme.vn",
      display_name: "An",
      onboarded_at: "2026-08-25T00:00:00Z",
      email_verified_at: "2026-08-25T00:00:00Z",
      onboarding_questionnaire: {},
      locale: "vi",
    };
    render(
      <WorkspaceProvider workspace={workspace} user={sessionUser}>
        <table>
          <tbody>
            <LibraryRowView row={documentRow(doc("a", "A.docx", { share_scope: SCOPE_HOME }))} handlers={handlers} ladder={specLadder("workspace", { selectable: false })} />
          </tbody>
        </table>
      </WorkspaceProvider>,
    );
    const row = document.querySelector('[data-library-row="a"]') as HTMLElement;
    expect(within(row).getAllByRole("button")[0]!.getAttribute("aria-describedby")).toBeNull();
    await openMenu("a", "A.docx");
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByText(/Workspace|Đội/)).toBeNull();
  });
});

describe("narrow secondary line at 390 (< 34rem, UNI-1902)", () => {
  it("draws the separators inside a wrapping line only from 34rem, so a wrapped line never ends in one (N5)", () => {
    renderList([
      doc("a", "Hợp đồng mẫu.docx", {
        my_level: "manage",
        via: "owner" as DocumentSummaryRow["via"],
        visibility: "restricted",
        share_scope: SCOPE_PRIVATE,
        updated_at: "2026-10-17T03:00:00Z",
        size_bytes: 2500,
      }),
    ]);
    const line = document.querySelector('[data-library-row="a"] [data-library-access-line]') as HTMLElement;
    const metaGroup = line.querySelector("[data-library-meta-line]") as HTMLElement;
    const accessGroup = line.querySelector("[data-library-access-group]") as HTMLElement;
    // Editor and date · size are two rows below 34rem (no separator between rows); from 34rem they share one.
    const [editorEl, dateDot, dateSize] = Array.from(metaGroup.children) as HTMLElement[];
    expect(editorEl).toHaveClass("truncate", "basis-full", "@min-[34rem]/library:basis-auto");
    expect(dateDot).toHaveTextContent("·");
    expect(dateDot).toHaveClass("hidden", "@min-[34rem]/library:inline", "@min-[31rem]/library:hidden!");
    // The date and size never split from each other.
    expect(dateSize).toHaveClass("shrink-0", "whitespace-nowrap");
    // The level and the scope badge: the dot between them leaves with the wrap.
    const levelDot = Array.from(accessGroup.children).find((el) => el.textContent === "·") as HTMLElement;
    expect(levelDot).toHaveClass("hidden", "@min-[34rem]/library:inline");
  });

  it("wraps meta (editor · date · size) above level · share scope below 34rem with a non-truncating date and no orphan separator", () => {
    renderList([
      doc("a", "Hợp đồng mẫu.docx", {
        my_level: "manage",
        via: "owner" as DocumentSummaryRow["via"],
        visibility: "restricted",
        share_scope: SCOPE_PRIVATE,
        updated_at: "2026-10-17T03:00:00Z",
        size_bytes: 2500,
      }),
      doc("b", "Không người sửa.docx", {
        updated_by: "",
        my_level: "view",
        visibility: "workspace",
        updated_at: "2026-10-17T03:00:00Z",
        size_bytes: 2500,
      }),
    ]);
    const line = document.querySelector('[data-library-row="a"] [data-library-access-line]') as HTMLElement;
    expect(line).toHaveClass("flex-wrap", "@min-[34rem]/library:flex-nowrap");

    const metaGroup = line.querySelector("[data-library-meta-line]") as HTMLElement;
    const accessGroup = line.querySelector("[data-library-access-group]") as HTMLElement;
    expect(metaGroup).toBeTruthy();
    expect(accessGroup).toBeTruthy();
    // UNI-2045: the editor part leaves when Người sửa gần nhất joins (48rem on the workspace screen).
    expect(metaGroup).toHaveClass("basis-full", "min-w-0", "@min-[34rem]/library:basis-auto", "@min-[48rem]/library:hidden");
    expect(accessGroup).toHaveClass("shrink-0");

    const editorEl = within(metaGroup).getByText("An");
    expect(editorEl).toHaveClass("min-w-0", "truncate");

    const dateSizeEl = Array.from(metaGroup.querySelectorAll("span")).find((el) => el.textContent?.includes("2,4 KB")) as HTMLElement;
    expect(dateSizeEl).toBeTruthy();
    // The shared list date drops the year inside the current year (today is not pinned here).
    expect(dateSizeEl.textContent).toMatch(/^17\/10(\/2026)? · 2,4 KB$/);
    expect(dateSizeEl).toHaveClass("shrink-0");
    expect(dateSizeEl).not.toHaveClass("truncate");

    expect(within(accessGroup).getByText("Chủ sở hữu")).toBeTruthy();
    expect(within(accessGroup).getByTestId("document-share-scope-badge")).toBeTruthy();

    expect(metaGroup.firstElementChild?.textContent).not.toBe("·");
    expect(metaGroup.lastElementChild?.textContent).not.toBe("·");
    expect(accessGroup.firstElementChild?.textContent).not.toBe("·");
    expect(accessGroup.lastElementChild?.textContent).not.toBe("·");

    const interDot = Array.from(line.children).find((el) => el.textContent === "·") as HTMLElement;
    expect(interDot).toBeTruthy();
    // UNI-2045: the dot leaves with the access group, at the access rung (39rem on the workspace screen; the `!` wins over the dot's own 34rem `inline`).
    expect(interDot).toHaveClass("hidden", "@min-[34rem]/library:inline", "@min-[39rem]/library:hidden!");

    const lineB = document.querySelector('[data-library-row="b"] [data-library-access-line]') as HTMLElement;
    const metaB = lineB.querySelector("[data-library-meta-line]") as HTMLElement;
    const accessB = lineB.querySelector("[data-library-access-group]") as HTMLElement;
    // UNI-2045: without an editor the meta group is updated · size, gone at the table rung (31rem).
    expect(metaB).toHaveClass("@min-[31rem]/library:hidden");
    expect(metaB.firstElementChild?.textContent).not.toBe("·");
    expect(metaB.lastElementChild?.textContent).not.toBe("·");
    expect(accessB.firstElementChild?.textContent).not.toBe("·");
    expect(accessB.lastElementChild?.textContent).not.toBe("·");
    expect(Array.from(lineB.children).find((el) => el.textContent === "·")).toBeUndefined();
  });
});

describe("size column", () => {
  it("is right-aligned and tabular-nums in header and cell", () => {
    renderList([doc("a", "A.docx")]);
    const sizeTh = screen.getAllByRole("columnheader").find((th) => th.textContent === "Dung lượng")!;
    expect(sizeTh.className).toContain("text-right");
    const sizeTd = cellsOf("a")[4]!;
    expect(sizeTd.className).toContain("text-right");
    expect(sizeTd.className).toContain("tabular-nums");
  });
});

describe("folder contents access menu item (UNI-2244)", () => {
  it("offers Chia sẻ các tài liệu bên trong… on a folder row under a stable test id, and hands the folder over", async () => {
    const onShareContents = vi.fn();
    renderList([doc("fo1", "Hợp đồng", { kind: "folder" })], { onShareContents });
    await openMenu("fo1", "Hợp đồng");
    const entry = screen.getByTestId("folder-access-menu-item");
    expect(entry).toHaveTextContent(t("documents.folderAccess.menu"));
    fireEvent.click(entry);
    expect(onShareContents).toHaveBeenCalledWith(expect.objectContaining({ id: "fo1" }));
  });

  it("is absent on a document row", async () => {
    renderList([doc("a", "A.docx")], { onShareContents: vi.fn() });
    await openMenu("a", "A.docx");
    expect(screen.queryByTestId("folder-access-menu-item")).toBeNull();
  });
});

describe("folder star menu (SV-4)", () => {
  it("offers Gắn sao on an unstarred folder row and reports the current state", async () => {
    const onToggleStar = vi.fn();
    renderList([doc("fo1", "Hợp đồng", { kind: "folder" })], { onToggleStar });
    await openMenu("fo1", "Hợp đồng");
    expect(screen.queryByRole("menuitem", { name: t("documents.home.row.unstar") })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: t("documents.home.row.star") }));
    expect(onToggleStar).toHaveBeenCalledWith("fo1", false);
  });

  it("offers Bỏ gắn sao on a starred folder row", async () => {
    const onToggleStar = vi.fn();
    renderList([doc("fo1", "Hợp đồng", { kind: "folder" })], { onToggleStar, isStarred: (id) => id === "fo1" });
    const row = await openMenu("fo1", "Hợp đồng");
    // The Star action carries the state, so the inline marker is not drawn a second time (N4).
    expect(within(row).queryByRole("img", { name: t("documents.home.row.starred") })).toBeNull();
    expect(within(row).getByRole("button", { name: t("documents.home.row.unstar_item", { title: "Hợp đồng" }) })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("menuitem", { name: t("documents.home.row.unstar") }));
    expect(onToggleStar).toHaveBeenCalledWith("fo1", true);
  });

  it("keeps the star items on a document row", async () => {
    const onToggleStar = vi.fn();
    renderList([doc("a", "A.docx")], { onToggleStar });
    await openMenu("a", "A.docx");
    fireEvent.click(screen.getByRole("menuitem", { name: t("documents.home.row.star") }));
    expect(onToggleStar).toHaveBeenCalledWith("a", false);
  });

  it("offers no star item on a trashed folder", async () => {
    renderRow(doc("fo1", "Hợp đồng", { kind: "folder", my_level: "manage", archived_at: "2026-10-01T00:00:00Z" }), { onToggleStar: vi.fn() });
    const row = document.querySelector('[data-library-row="fo1"]') as HTMLElement;
    // A trashed row is inert in a live list: no ⋯ menu, and neither star item exists.
    expect(within(row).queryByRole("button", { name: t("documents.home.row.menu", { title: "Hợp đồng" }) })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("documents.home.row.star") })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("documents.home.row.unstar") })).toBeNull();
  });
});

describe("trash vs archive icons", () => {
  it("draws Move to trash with the trash icon and Archive with the archive icon on a document row", async () => {
    renderList([doc("a", "A.docx", { my_level: "manage" })], { onArchive: vi.fn(), onShelve: vi.fn() });
    await openMenu("a", "A.docx");
    const trash = screen.getByRole("menuitem", { name: t("documents.home.row.archive") });
    const shelve = screen.getByRole("menuitem", { name: t("documents.shelved_list.shelve") });
    expect(trash.querySelector("svg.lucide-trash-2")).not.toBeNull();
    expect(shelve.querySelector("svg.lucide-archive")).not.toBeNull();
  });
});

describe("quick star button on a live row (RFD-04)", () => {
  const starButton = (title: string, starred: boolean) =>
    screen.queryByRole("button", { name: t(starred ? "documents.home.row.unstar_item" : "documents.home.row.star_item", { title }) });

  it("toggles the star from the row, before the ⋯ menu, with the state in aria-pressed and a 44px coarse target", () => {
    const onToggleStar = vi.fn();
    renderList([doc("a", "A.docx")], { onToggleStar });
    const button = starButton("A.docx", false)!;
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button.className).toContain("pointer-coarse:size-11");
    expect(button.compareDocumentPosition(screen.getByRole("button", { name: t("documents.home.row.menu", { title: "A.docx" }) })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(button);
    expect(onToggleStar).toHaveBeenCalledWith("a", false);
  });

  it("reads pressed on a starred row and unstars it", () => {
    const onToggleStar = vi.fn();
    renderList([doc("a", "A.docx")], { onToggleStar, isStarred: () => true });
    const button = starButton("A.docx", true)!;
    expect(button).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(button);
    expect(onToggleStar).toHaveBeenCalledWith("a", true);
  });

  it("draws a starred row's star once: the action, not an inline marker beside the title (N4)", () => {
    renderList([doc("a", "A.docx")], { onToggleStar: vi.fn(), isStarred: () => true });
    expect(starButton("A.docx", true)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: t("documents.home.row.starred") })).toBeNull();
  });

  it("keeps the inline marker where the row has no Star action", () => {
    // A starred row the host cannot toggle (no handler) and a shelved or trashed one still say it is starred.
    renderList([doc("a", "A.docx")], { onToggleStar: undefined, isStarred: () => true });
    expect(screen.getByRole("img", { name: t("documents.home.row.starred") })).toBeInTheDocument();
    cleanup();
    renderList([doc("c", "C.docx", { archived_at: "2026-10-20T01:00:00Z" })], { onToggleStar: vi.fn(), onRestore: vi.fn(), onPurge: vi.fn(), onViewDetails: vi.fn(), isStarred: () => true }, { screen: "trash" });
    expect(screen.getByRole("img", { name: t("documents.home.row.starred") })).toBeInTheDocument();
  });

  it("is absent where the row menu has no star: no host handler, a shelved row, a trashed row", () => {
    renderList([doc("a", "A.docx")], { onToggleStar: undefined });
    expect(starButton("A.docx", false)).toBeNull();
    cleanup();
    renderList([doc("b", "B.docx", { shelved_at: "2026-10-20T01:00:00Z" })], { onToggleStar: vi.fn(), onUnshelve: vi.fn() }, { screen: "shelved" });
    expect(starButton("B.docx", false)).toBeNull();
    cleanup();
    renderList([doc("c", "C.docx", { archived_at: "2026-10-20T01:00:00Z" })], { onToggleStar: vi.fn(), onRestore: vi.fn(), onPurge: vi.fn(), onViewDetails: vi.fn() }, { screen: "trash" });
    expect(starButton("C.docx", false)).toBeNull();
  });
});

describe("starred view rows (SV-1)", () => {
  const fav = { document_id: "f1", workspace_id: "ws1", title: "Bản nháp", kind: "page" };

  it("shows the trash badge on a trashed starred row built from the known copy", () => {
    render(
      <table>
        <tbody>
          <LibraryRowView
            row={documentRow(favoriteRow(fav, { id: "f1", archived_at: "2026-10-01T00:00:00Z" }))}
            handlers={{ ...handlers, isStarred: () => true }}
            ladder={specLadder("workspace", { selectable: false })}
          />
        </tbody>
      </table>,
    );
    expect(screen.getByText(t("documents.library.archived_badge"))).toBeInTheDocument();
  });

  it("keeps the owner's level label on a starred row (via comes through with the known copy)", () => {
    render(
      <table>
        <tbody>
          <LibraryRowView
            row={documentRow(favoriteRow(fav, { id: "f1", my_level: "manage", via: "owner" as DocumentSummaryRow["via"] }))}
            handlers={{ ...handlers, isStarred: () => true }}
            ladder={specLadder("workspace", { selectable: false })}
          />
        </tbody>
      </table>,
    );
    // The column and the narrow line both say it (only one is on screen at a time).
    expect(screen.getAllByText("Chủ sở hữu")).toHaveLength(2);
  });
});

// UNI-1645 (addendum §11.4): a row whose document someone is editing shows the holder's avatar.

const HOLD = (() => {
  const d = new Date();
  d.setHours(22, 30, 0, 0);
  return d.toISOString();
})();

function lockItem(over: Partial<DocumentSummaryRow> = {}): DocumentSummaryRow {
  return doc("d1", "Kế hoạch Q4", { kind: "page", updated_by: "", size_bytes: undefined, ...over });
}

describe("library row edit-lock holder", () => {
  it("shows who is editing: avatar, the word, and the full name for screen readers", () => {
    renderRow(lockItem({ edit_lock: { holder_id: "u2", holder_name: "Bình Trần", holder_avatar_url: null, since: "2026-10-15T03:12:00Z", held_by_me: false } }));
    const holder = screen.getByRole("img", { name: t("documents.editLock.rowEditingLabel", { name: "Bình Trần" }) });
    expect(holder).toHaveAttribute("title", "Bình Trần đang sửa");
    expect(within(holder).getByText("đang sửa")).toBeTruthy();
    expect(within(holder).getByText("BT")).toBeTruthy();
  });

  it("shows 'đang sửa · offline đến HH:mm' and includes the offline end time in the accessible name when offline_hold_until is set (V3-8, R6-2)", () => {
    renderRow(
      lockItem({
        edit_lock: {
          holder_id: "u2",
          holder_name: "Hưng Nguyễn",
          holder_avatar_url: null,
          since: "2026-10-15T03:12:00Z",
          offline_hold_until: HOLD,
          held_by_me: false,
        },
      }),
    );
    const time = formatLockTime(HOLD, "vi");
    const expectedLabel = t("documents.editLock.bannerOfflineHold", { name: "Hưng Nguyễn", time });
    const holder = screen.getByLabelText(expectedLabel);
    expect(holder).toBe(screen.getByRole("img", { name: expectedLabel }));
    expect(holder).toHaveAttribute("title", expectedLabel);
    expect(within(holder).getByText(`đang sửa · offline đến ${time}`)).toBeTruthy();
  });

  it("omits the holder chip when the lock is held by the current user (V3-7)", () => {
    renderRow(lockItem({ edit_lock: { holder_id: "me", holder_name: "Bạn", holder_avatar_url: null, since: "2026-10-15T03:12:00Z", held_by_me: true } }));
    expect(screen.queryByTestId("edit-lock-holder")).toBeNull();
  });

  it("shows nothing when no one is editing", () => {
    renderRow(lockItem({ edit_lock: null }));
    expect(screen.queryByTestId("edit-lock-holder")).toBeNull();
    renderRow(lockItem({ id: "d2" }));
    expect(screen.queryByTestId("edit-lock-holder")).toBeNull();
  });
});

describe("library row trashed badge (ARCHIVE-01 RAR-02)", () => {
  it("says the row is in the trash, not the shelf's 'Đã lưu trữ'", () => {
    renderRow(doc("d1", "Kế hoạch Q4", { archived_at: "2026-10-16T03:00:00Z" }));
    expect(screen.getByText("Trong thùng rác")).toBeTruthy();
    expect(screen.queryByText("Đã lưu trữ")).toBeNull();
  });
});
