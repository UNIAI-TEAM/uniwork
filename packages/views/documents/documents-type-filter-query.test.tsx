import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { FeatureFlagsProvider, FeatureFlagService, StaticProvider } from "@uniwork/core/feature-flags";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { fakeNav, requestMock, wrapWithNav } from "../test/api-mock";
import { pickTypeFilter, typeChipRemove } from "../test/type-filter";
import { DocumentsPageView } from "./documents-page-view";

// UNI-2113 Step 2: the Loại menu's picks reach the server as the repeated `type`
// parameter of every list route, and the query changes with the selection.

const WS = "ws1";
const ORG = "o1";
const LIST_BASE = `/api/v1/workspaces/${WS}/documents`;

const user: User = {
  id: "u1",
  email: "an@acme.vn",
  display_name: "An",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};
const workspace: Workspace = { id: WS, slug: "team", name: "Team", organization_id: ORG, organization_slug: "acme", organization_name: "Acme" };

function renderView(initialUrl?: string) {
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: true } }));
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <FeatureFlagsProvider service={service}>
          <DocumentsPageView wsId={WS} onOpen={vi.fn()} />
        </FeatureFlagsProvider>
      </WorkspaceProvider>,
      fakeNav(initialUrl),
    ),
  );
}

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const doc = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  workspace_id: WS,
  kind: "file",
  title: id,
  revision: "1",
  my_level: "manage",
  updated_at: ago(5),
  updated_by: "u1",
  current_version: 1,
  organization_id: ORG,
  ...over,
});

const queryOf = (path: string) => new URLSearchParams(String(path).split("?")[1] ?? "");
const typesOf = (path: string) => queryOf(path).getAll("type");
const noLegacy = (path: string) => [queryOf(path).has("format"), queryOf(path).has("kind")];

/** Answers a list the way the server would: the rows of the requested types, all rows with none. */
function byType(path: string) {
  const rows: Record<string, unknown>[] = [
    doc("note", { kind: "page", title: "note" }),
    doc("a.docx", { format: "docx" }),
    doc("b.xlsx", { format: "xlsx" }),
    doc("c.txt", { format: "txt" }),
  ];
  const wanted = typesOf(path);
  return wanted.length === 0 ? rows : rows.filter((row) => wanted.includes(row.kind === "page" ? "page" : String(row.format)));
}

function route(list: (path: string) => unknown[] = byType) {
  requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
    const p = String(path);
    if (p.startsWith(`${LIST_BASE}/tree`)) {
      return Promise.resolve({ documents: [{ id: "fo1", title: "Dự án", kind: "folder", position: 0, children: [] }] });
    }
    if (p.startsWith("/api/v1/documents/fo1")) return Promise.resolve({ document: doc("fo1", { kind: "folder", title: "Dự án" }) });
    if (p === `/api/v1/orgs/${ORG}/documents/favorites`) return Promise.resolve({ favorites: [] });
    if (p.startsWith(`/api/v1/workspaces/${WS}/members`)) return Promise.resolve({ members: [] });
    if (p.startsWith(`${LIST_BASE}/sources`)) return Promise.resolve({ items: [], next_cursor: null });
    if (p.startsWith(LIST_BASE) && (opts?.method ?? "GET") === "GET") return Promise.resolve({ documents: list(p), next_cursor: null });
    return Promise.resolve({});
  });
}

const allCalls = () => requestMock.mock.calls.map(([path]) => String(path));
const lastOf = (match: (path: string) => boolean) => allCalls().filter(match).at(-1) ?? "";
/** The flat list route itself (home, an open folder, Tôi đã chia sẻ, Lưu trữ), not a sub-route. */
const isFlatList = (path: string) => path.split("?")[0] === LIST_BASE;
const lastFlat = () => lastOf(isFlatList);

beforeEach(() => {
  requestMock.mockReset();
  resetAuthStoreForTests();
  setSessionUser({ ...user, email: "an@example.com" });
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("the Loại menu sends the repeated type parameter (UNI-2113)", () => {
  it("sends type=docx&type=xlsx for two picks, and no format or kind", async () => {
    route();
    renderView();
    await screen.findByText("a.docx");
    await pickTypeFilter("docx", "xlsx");
    await waitFor(() => expect(typesOf(lastFlat())).toEqual(["docx", "xlsx"]));
    expect(noLegacy(lastFlat())).toEqual([false, false]);
    await waitFor(() => expect(screen.queryByText("c.txt")).toBeNull());
    expect(screen.getByText("a.docx")).toBeInTheDocument();
    expect(screen.getByText("b.xlsx")).toBeInTheDocument();
    expect(screen.queryByText("note")).toBeNull();
  });

  it("sends type=page for UniNote and type=docx for one file type", async () => {
    route();
    renderView();
    await screen.findByText("a.docx");
    await pickTypeFilter("page");
    await waitFor(() => expect(typesOf(lastFlat())).toEqual(["page"]));
    expect(noLegacy(lastFlat())).toEqual([false, false]);
    await pickTypeFilter("page", "docx");
    await waitFor(() => expect(typesOf(lastFlat())).toEqual(["docx"]));
    expect(noLegacy(lastFlat())).toEqual([false, false]);
  });

  it("sends no type for Tất cả and for the default state", async () => {
    route();
    renderView();
    await screen.findByText("a.docx");
    expect(typesOf(lastFlat())).toEqual([]);
    await pickTypeFilter("docx", "xlsx");
    await waitFor(() => expect(typesOf(lastFlat())).toEqual(["docx", "xlsx"]));
    await pickTypeFilter("all");
    await waitFor(() => expect(typesOf(lastFlat())).toEqual([]));
    expect(await screen.findByText("c.txt")).toBeInTheDocument();
  });

  it("drops one value when its chip is removed", async () => {
    route();
    renderView();
    await screen.findByText("a.docx");
    await pickTypeFilter("docx", "xlsx", "txt");
    await waitFor(() => expect(typesOf(lastFlat())).toEqual(["docx", "xlsx", "txt"]));
    fireEvent.click(typeChipRemove("xlsx")!);
    await waitFor(() => expect(typesOf(lastFlat())).toEqual(["docx", "txt"]));
    await waitFor(() => expect(screen.queryByText("b.xlsx")).toBeNull());
  });

  it("keys the list query by the selection: no row of another selection stays", async () => {
    route();
    renderView();
    await screen.findByText("a.docx");
    await pickTypeFilter("docx");
    await waitFor(() => expect(screen.queryByText("b.xlsx")).toBeNull());
    await pickTypeFilter("xlsx");
    expect(await screen.findByText("b.xlsx")).toBeInTheDocument();
    await pickTypeFilter("xlsx");
    await waitFor(() => expect(screen.queryByText("b.xlsx")).toBeNull());
    expect(screen.getByText("a.docx")).toBeInTheDocument();
    // A different pair is a different entry, not the cached docx + xlsx rows.
    await pickTypeFilter("txt");
    expect(await screen.findByText("c.txt")).toBeInTheDocument();
    expect(screen.queryByText("b.xlsx")).toBeNull();
  });

  it.each([
    ["Gần đây", "/?view=recent", (path: string) => path.startsWith(`${LIST_BASE}/recent`)],
    ["Có gắn sao", "/?view=starred", (path: string) => path.startsWith(`${LIST_BASE}/favorites`)],
    ["Được chia sẻ với tôi", "/?view=shared", (path: string) => path.startsWith(`${LIST_BASE}/shared-with-me`)],
    ["Tôi đã chia sẻ", "/?view=shared-by-me", isFlatList],
    ["Lưu trữ", "/?view=shelved", isFlatList],
  ])("sends the repeated type on %s", async (_name, url, match) => {
    route();
    renderView(url);
    await screen.findByText("a.docx");
    await pickTypeFilter("docx", "xlsx");
    await waitFor(() => expect(typesOf(lastOf(match))).toEqual(["docx", "xlsx"]));
    expect(noLegacy(lastOf(match))).toEqual([false, false]);
  });

  it("sends the repeated type for an open folder too", async () => {
    route((path) => (queryOf(path).get("parent_id") === "fo1" ? byType(path).map((row) => ({ ...row, parent_id: "fo1" })) : []));
    renderView("/?folder=fo1");
    await screen.findByText("a.docx");
    await pickTypeFilter("docx", "xlsx");
    await waitFor(() => expect(typesOf(lastFlat())).toEqual(["docx", "xlsx"]));
  });
});
