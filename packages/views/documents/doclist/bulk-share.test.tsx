import { QueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { documentKeys } from "@uniwork/core/documents/keys";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../../test/api-mock";
import { DocumentsLibraryList } from "../documents-library-list";
import type { LibraryRowHandlers } from "../documents-library-row";
import { documentRow, type DocumentSummaryRow } from "../library-rows";
import type { BulkPlan, DocListBulk } from "./bulk-actions";
import type { DocListScreen } from "./columns";
import { useDocListBulkCommands } from "./use-bulk-commands";

// UNI-2045 W13: Chia sẻ on the live bulk bar opens one dialog for every
// selected document the viewer manages. It fans out over the single-document
// share routes (fake transport only), skips the others unsent and names them,
// invalidates once and toasts "Đã chia sẻ 3/5 tài liệu".

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const clipboard = vi.hoisted(() => ({ copyText: vi.fn<(text: string) => Promise<boolean>>() }));
vi.mock("@uniwork/ui/lib/clipboard", () => clipboard);

const { t } = initI18n();
const WS = "ws1";

function doc(id: string, over: Partial<DocumentSummaryRow> = {}): DocumentSummaryRow {
  return {
    id,
    organization_id: "org1",
    workspace_id: WS,
    kind: "file",
    title: `Tệp ${id}`,
    visibility: "workspace",
    revision: "1",
    current_version: 1,
    position: 0,
    my_level: "manage",
    created_by: "",
    created_by_kind: "human",
    updated_by: "u1",
    updated_by_kind: "human",
    created_at: "",
    updated_at: "2026-09-28T03:00:00Z",
    ...over,
  };
}

const candidates = {
  items: [
    { principal_type: "user", principal_id: "u2", name: "Nguyễn An", secondary: "an@acme.vn", direct_level: "view", is_home_workspace: false },
    { principal_type: "organization", principal_id: "org1", name: "Acme", secondary: "", direct_level: null, is_home_workspace: false },
  ],
  next_cursor: "",
};

const accessAnswer = { batch_id: "b1", dry_run: false, results: [{ index: 0, status: "granted" }], preview: { users: [], groups: [], warnings: [] } };

type Call = { path: string; method?: string; body?: unknown };

function transport(over: (call: Call) => unknown = () => undefined) {
  const calls: Call[] = [];
  requestMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
    const call = { path, method: opts?.method, body: opts?.body };
    if (path.includes("/share-candidates")) return Promise.resolve(candidates);
    calls.push(call);
    const answer = over(call);
    if (answer instanceof Error) return Promise.reject(answer);
    if (answer !== undefined) return Promise.resolve(answer);
    if (path.endsWith("/links")) return Promise.resolve({ link: { id: "l1" }, token: "t", url: `/share/${path.split("/")[4]}` });
    return Promise.resolve(accessAnswer);
  });
  return calls;
}

function Harness({ plan, onDone }: { plan: BulkPlan; onDone: () => void }) {
  const { bulk, dialogs } = useDocListBulkCommands({ wsId: WS, tree: [], onDownloadOne: () => {} });
  return (
    <>
      <button type="button" onClick={() => bulk.run(plan, onDone)}>
        go
      </button>
      {dialogs}
    </>
  );
}

function open(plan: BulkPlan) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const onDone = vi.fn();
  render(wrap(<Harness plan={plan} onDone={onDone} />, client));
  fireEvent.click(screen.getByRole("button", { name: "go" }));
  return { invalidate, onDone };
}

function descriptionText(options: unknown): string {
  const description = (options as { description?: ReactNode } | undefined)?.description;
  const { container, unmount } = render(<>{description}</>);
  const text = container.textContent ?? "";
  unmount();
  return text;
}

const five = ["a", "b", "c", "d", "e"].map((id) => doc(id));
const titles = new Map(five.map((d) => [d.id, d.title]));
const sharePlan = (docs: DocumentSummaryRow[], skipped: BulkPlan["skipped"] = [], total = docs.length + skipped.length): BulkPlan => ({
  action: "share",
  docs,
  skipped,
  total,
  titles,
});

async function pickPerson(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, name: RegExp) {
  await user.click(within(dialog).getByRole("combobox", { name: t("documents.share.principal_placeholder") }));
  const listbox = await screen.findByRole("listbox");
  await user.click(await within(listbox).findByRole("option", { name }));
}

describe("bulk share dialog", () => {
  beforeEach(() => {
    requestMock.mockReset();
    for (const fn of Object.values(toast)) fn.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows the people picker with a level, the workspace row and the link row, in Vietnamese", async () => {
    transport();
    open(sharePlan(five.slice(0, 3), [{ id: "d", code: "forbidden" }]));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Chia sẻ 3 tài liệu" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent(t("documents.list.bulk.share.skipped_note", { count: 1 }));
    expect(within(dialog).getByRole("combobox", { name: t("documents.share.principal_placeholder") })).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: "Mức quyền" })).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: t("documents.list.bulk.share.workspace_label") })).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: t("documents.list.bulk.share.link_label") })).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: t("documents.list.bulk.share.update_existing") })).not.toBeChecked();
    // No per-document access list: it differs per document.
    expect(within(dialog).queryByText(t("documents.share.home_badge"))).toBeNull();
  });

  it("reads in English too", async () => {
    await setLocale("en");
    transport();
    open(sharePlan(five.slice(0, 2)));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Share 2 documents" })).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: "Level" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Share" })).toBeInTheDocument();
  });

  it("sends one request per eligible document with the same recipients, skips the rest unsent, invalidates once and toasts 3/5", async () => {
    const calls = transport((call) => (call.path === "/api/v1/documents/b/access" ? new ApiError("no", "forbidden", 403) : undefined));
    const plan = sharePlan(five.slice(0, 4), [{ id: "e", code: "forbidden" }], 5);
    const { invalidate, onDone } = open(plan);
    const user = userEvent.setup();
    const dialog = await screen.findByRole("dialog");
    await pickPerson(user, dialog, /Nguyễn An/);
    await user.click(within(dialog).getByRole("button", { name: t("documents.share.submit") }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(calls.map((c) => c.path).sort()).toEqual([
      "/api/v1/documents/a/access",
      "/api/v1/documents/b/access",
      "/api/v1/documents/c/access",
      "/api/v1/documents/d/access",
    ]);
    for (const call of calls) {
      expect(call.method).toBe("PUT");
      // Already-shared people keep their level, as the single dialog's default does.
      expect(call.body).toEqual({ items: [{ principal_type: "user", principal_id: "u2", level: "view", on_existing: "keep" }], dry_run: false });
    }
    const [title, options] = toast.success.mock.calls[0]!;
    expect(title).toBe("Đã chia sẻ 3/5 tài liệu");
    const text = descriptionText(options);
    expect(text).toContain("Tệp b");
    expect(text).toContain("Tệp e");
    expect(text).toContain(t("documents.list.bulk.error.forbidden"));
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: documentKeys.workspace(WS) });
    expect(onDone).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("updates people who already have access when asked, and sets each document's own workspace", async () => {
    const calls = transport();
    open(sharePlan([doc("a"), doc("b", { workspace_id: "ws9" })]));
    const user = userEvent.setup();
    const dialog = await screen.findByRole("dialog");
    await pickPerson(user, dialog, /Nguyễn An/);
    await user.click(within(dialog).getByRole("checkbox", { name: t("documents.list.bulk.share.update_existing") }));
    await user.click(within(dialog).getByRole("combobox", { name: t("documents.list.bulk.share.workspace_label") }));
    await user.click(await screen.findByRole("option", { name: t("documents.list.bulk.share.workspace_level", { level: t("documents.share.level_edit") }) }));
    await user.click(within(dialog).getByRole("button", { name: t("documents.share.submit") }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(calls.find((c) => c.path === "/api/v1/documents/b/access")?.body).toEqual({
      items: [
        { principal_type: "user", principal_id: "u2", level: "view", on_existing: "update" },
        { principal_type: "workspace", principal_id: "ws9", level: "edit", on_existing: "update" },
      ],
      dry_run: false,
    });
  });

  it("creates a link per document and shows each URL once, with the document's name", async () => {
    const calls = transport();
    open(sharePlan(five.slice(0, 2)));
    const user = userEvent.setup();
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("combobox", { name: t("documents.list.bulk.share.link_label") }));
    await user.click(await screen.findByRole("option", { name: t("documents.list.bulk.share.link_create") }));
    await user.click(within(dialog).getByRole("button", { name: t("documents.share.submit") }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(calls.map((c) => `${c.method} ${c.path}`).sort()).toEqual(["POST /api/v1/documents/a/links", "POST /api/v1/documents/b/links"]);
    expect(calls[0]!.body).toEqual({ expires_in_days: 7 });
    const created = await screen.findByRole("list", { name: t("documents.list.bulk.share.links_created") });
    expect(within(created).getAllByRole("listitem")).toHaveLength(2);
    expect(created).toHaveTextContent("Tệp a");
    expect(created).toHaveTextContent("/share/a");
  });

  it("copies every created link through the shared clipboard helper and says when the copy failed", async () => {
    transport();
    clipboard.copyText.mockReset();
    clipboard.copyText.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    open(sharePlan(five.slice(0, 2)));
    const user = userEvent.setup();
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("combobox", { name: t("documents.list.bulk.share.link_label") }));
    await user.click(await screen.findByRole("option", { name: t("documents.list.bulk.share.link_create") }));
    await user.click(within(dialog).getByRole("button", { name: t("documents.share.submit") }));
    await screen.findByRole("list", { name: t("documents.list.bulk.share.links_created") });
    toast.error.mockClear();
    const copyAll = () => screen.getByRole("button", { name: new RegExp(`${t("documents.list.bulk.share.copy_all")}|${t("documents.share.link_copied")}`) });
    await user.click(copyAll());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t("documents.list.menu.link_copy_failed")));
    expect(clipboard.copyText.mock.calls[0]![0]).toMatch(/^Tệp a\t.*\/share\/a\nTệp b\t.*\/share\/b$/);
    expect(copyAll()).toHaveTextContent(t("documents.list.bulk.share.copy_all"));
    await user.click(copyAll());
    await waitFor(() => expect(copyAll()).toHaveTextContent(t("documents.share.link_copied")));
  });

  it("cannot apply with nothing to change, and cancel sends nothing", async () => {
    const calls = transport();
    const { onDone } = open(sharePlan(five.slice(0, 2)));
    const user = userEvent.setup();
    const dialog = await screen.findByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: t("documents.share.submit") });
    expect(submit).toHaveAttribute("aria-disabled", "true");
    await user.click(submit);
    await pickPerson(user, dialog, /Acme/);
    await user.click(within(dialog).getByRole("button", { name: t("common.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls).toEqual([]);
    expect(toast.success).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });
});

const noop = () => {};
const liveHandlers: LibraryRowHandlers = {
  onOpen: noop,
  onFolder: noop,
  onGoToSource: noop,
  onDownloadSource: noop,
  onSaveSource: noop,
  isStarred: () => false,
  personName: () => "An",
  onShare: noop,
  onMove: noop,
  onDownload: noop,
  onShelve: noop,
  onArchive: noop,
};

function list(rows: DocumentSummaryRow[], bulk: DocListBulk, screenName: DocListScreen = "workspace", handlers: LibraryRowHandlers = liveHandlers) {
  return (
    <DocumentsLibraryList
      groups={[{ key: "all", rows: rows.map(documentRow) }]}
      loading={false}
      failure={null}
      hasMore={false}
      loadingMore={false}
      onLoadMore={noop}
      onRetry={noop}
      onClearFilters={noop}
      handlers={handlers}
      screen={screenName}
      selectable
      bulk={bulk}
      selectionKey="k1"
      empty={{ title: "empty", description: "empty" }}
    />
  );
}

const allBox = () => screen.getByRole("checkbox", { name: t("documents.list.bulk.select_all") });
const bar = () => screen.getByRole("toolbar", { name: t("documents.list.bulk.toolbar") });
const shareButton = () => within(bar()).queryByRole("button", { name: t("documents.list.bulk.action.share") });

function BarHarness({ rows, screenName, handlers, run }: { rows: DocumentSummaryRow[]; screenName?: DocListScreen; handlers?: LibraryRowHandlers; run?: DocListBulk["run"] }) {
  const { bulk } = useDocListBulkCommands({ wsId: WS, tree: [], onDownloadOne: noop });
  return list(rows, run ? { ...bulk, run } : bulk, screenName, handlers);
}

describe("bulk bar Chia sẻ", () => {
  beforeEach(() => requestMock.mockReset());

  it("is offered on a live screen when one selected document can be shared, and skips the rest by reason", () => {
    const run = vi.fn<DocListBulk["run"]>();
    render(wrap(<BarHarness rows={[doc("a"), doc("b", { my_level: "edit" }), doc("f", { kind: "folder", current_version: 0 })]} run={run} />));
    fireEvent.click(allBox());
    fireEvent.click(shareButton()!);
    const plan = run.mock.calls[0]![0];
    expect(plan.action).toBe("share");
    expect(plan.docs.map((d) => d.id)).toEqual(["a"]);
    expect(plan.skipped).toEqual([
      { id: "b", code: "forbidden" },
      { id: "f", code: "not_shareable" },
    ]);
    expect(t("documents.list.bulk.error.not_shareable")).not.toBe("documents.list.bulk.error.not_shareable");
  });

  it("is hidden when no selected document can be shared", () => {
    render(wrap(<BarHarness rows={[doc("a", { my_level: "edit" }), doc("b", { my_level: "view" })]} />));
    fireEvent.click(allBox());
    expect(shareButton()).toBeNull();
  });

  it("is hidden on the shelved and trash bars", () => {
    const shelvedRows = [doc("a", { shelved_at: "2026-10-20T01:00:00Z" })];
    const shelved = render(wrap(<BarHarness rows={shelvedRows} screenName="shelved" handlers={{ ...liveHandlers, onUnshelve: noop }} />));
    fireEvent.click(allBox());
    expect(shareButton()).toBeNull();
    shelved.unmount();
    const trashRows = [doc("a", { archived_at: "2026-10-20T01:00:00Z" })];
    render(wrap(<BarHarness rows={trashRows} screenName="trash" handlers={{ ...liveHandlers, onRestore: noop, onPurge: noop, onViewDetails: noop }} />));
    fireEvent.click(allBox());
    expect(shareButton()).toBeNull();
  });
});
