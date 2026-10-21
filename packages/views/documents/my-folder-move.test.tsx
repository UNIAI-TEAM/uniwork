import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { DocumentTreeNode } from "@uniwork/core/types/document";
import { requestMock, wrap } from "../test/api-mock";
import type { BulkPlan } from "./doclist/bulk-actions";
import { useDocListBulkCommands } from "./doclist/use-bulk-commands";
import { FolderPickerDialog } from "./folder-picker-dialog";
import type { DocumentSummaryRow } from "./library-rows";
import { useLibraryRowDialogs } from "./use-library-row-dialogs";

// UNI-2055 A2: a workspace folder never lands in My Folder (picker guard), and
// moving a folder out of My Folder asks first (client-only confirm, W3).

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { t } = initI18n();
const WS = "ws1";

function folder(id: string, parentId: string | null, over: Partial<DocumentTreeNode> = {}, children: DocumentTreeNode[] = []): DocumentTreeNode {
  return { id, title: `Thư mục ${id}`, kind: "folder", parent_id: parentId, position: 0, visibility: "workspace", children, ...over };
}

// My Folder (restricted) with a sub-folder, plus two workspace folders.
const tree: DocumentTreeNode[] = [
  folder("mf", null, { title: "Thư mục của tôi", system_kind: "my_folder", visibility: "restricted" }, [
    folder("mf-sub", "mf", { visibility: "restricted" }, [folder("mf-deep", "mf-sub", { visibility: "restricted" })]),
    folder("mf-other", "mf", { visibility: "restricted" }),
  ]),
  folder("wf", null, {}, [folder("wf-sub", "wf"), folder("wf-page", "wf", { kind: "page" })]),
  folder("wf2", null),
];

function row(id: string, kind: "folder" | "page" | "file", parentId: string | null): DocumentSummaryRow {
  return {
    id,
    organization_id: "org1",
    workspace_id: WS,
    kind,
    title: `Mục ${id}`,
    visibility: "workspace",
    revision: "4",
    current_version: 1,
    position: 0,
    parent_id: parentId,
    my_level: "manage",
    created_by: "",
    created_by_kind: "human",
    updated_by: "u1",
    updated_by_kind: "human",
    created_at: "",
    updated_at: "2026-09-28T03:00:00Z",
  } as DocumentSummaryRow;
}

const moveReason = () => t("documents.home.move.reason_workspace_folder");
const posts = () => requestMock.mock.calls.filter(([, opts]) => (opts as { method?: string } | undefined)?.method === "POST");

function renderPicker(over: Partial<React.ComponentProps<typeof FolderPickerDialog>> = {}) {
  render(
    <FolderPickerDialog
      open
      onOpenChange={vi.fn()}
      title={t("documents.home.move.picker_title")}
      description="Chọn"
      submitLabel={t("documents.home.move.submit")}
      tree={tree}
      initialFolderId={null}
      pending={false}
      error={null}
      onSubmit={vi.fn()}
      {...over}
    />,
  );
}

function myFolderRows() {
  return ["mf", "mf-sub", "mf-deep", "mf-other"].map((id) => ({
    id,
    el: screen.getByRole("treeitem", { name: id === "mf" ? t("documents.home.my_folder.label") : `Thư mục ${id}` }),
  }));
}

describe("FolderPickerDialog: workspace folders and My Folder (UNI-2055 A2)", () => {
  it("disables My Folder and every folder under it for a workspace folder, with the reason", () => {
    renderPicker({ movingId: "wf", currentFolderId: null });
    for (const { el } of myFolderRows()) {
      expect(el).toHaveAttribute("aria-disabled", "true");
      expect(el).toHaveAccessibleDescription(moveReason());
    }
    // Other workspace folders and the root stay open as targets.
    expect(screen.getByRole("treeitem", { name: "Thư mục wf2" })).not.toHaveAttribute("aria-disabled");
  });

  it("does not select a refused My Folder row", () => {
    const onSubmit = vi.fn();
    renderPicker({ movingId: "wf", onSubmit });
    const mf = screen.getByRole("treeitem", { name: t("documents.home.my_folder.label") });
    fireEvent.click(mf);
    expect(mf).toHaveAttribute("aria-selected", "false");
  });

  it("disables them when ANY folder of a bulk selection is a workspace folder", () => {
    renderPicker({ movingIds: ["wf2", "mf-sub"] });
    for (const { el } of myFolderRows()) expect(el).toHaveAttribute("aria-disabled", "true");
  });

  it("keeps My Folder open for a document, and for a folder that already lives in it", () => {
    renderPicker({ movingId: "wf-page" });
    expect(screen.getByRole("treeitem", { name: t("documents.home.my_folder.label") })).not.toHaveAttribute("aria-disabled");
  });

  it("does not guard a folder that sits inside My Folder (W3 is a confirm, not a refusal)", () => {
    renderPicker({ movingId: "mf-sub", currentFolderId: "mf" });
    expect(screen.getByRole("treeitem", { name: "Thư mục mf-other" })).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("treeitem", { name: "Thư mục wf" })).not.toHaveAttribute("aria-disabled");
  });
});

function Harness({ item }: { item: DocumentSummaryRow }) {
  const dialogs = useLibraryRowDialogs({ wsId: WS, tree, folderId: null });
  return (
    <>
      <button type="button" onClick={() => dialogs.onMove(item)}>
        cmd-move
      </button>
      {dialogs.dialogs}
    </>
  );
}

function answerMoves() {
  requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
    if (opts?.method === "POST") return Promise.resolve({ document: { ...row("x", "folder", null), revision: "5" } });
    return Promise.resolve({ document: row(path.split("/")[4] ?? "x", "folder", "mf") });
  });
}

async function openPicker() {
  fireEvent.click(screen.getByText("cmd-move"));
  return screen.findByRole("dialog");
}

describe("row move: confirm when a folder leaves My Folder (UNI-2055 A2)", () => {
  beforeEach(() => {
    requestMock.mockReset();
    for (const fn of Object.values(toast)) fn.mockReset();
    answerMoves();
  });

  it("asks before moving a My Folder folder to a workspace folder and sends nothing until confirmed", async () => {
    render(wrap(<Harness item={row("mf-sub", "folder", "mf")} />));
    const picker = await openPicker();
    fireEvent.click(within(picker).getByRole("treeitem", { name: "Thư mục wf" }));
    fireEvent.click(within(picker).getByRole("button", { name: t("documents.home.move.submit") }));

    const confirm = await screen.findByRole("alertdialog", { name: t("documents.home.move.out_confirm.title") });
    expect(confirm).toHaveTextContent(t("documents.home.move.out_confirm.body"));
    expect(posts()).toHaveLength(0);

    fireEvent.click(within(confirm).getByRole("button", { name: t("documents.home.move.out_confirm.confirm") }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]![0]).toBe("/api/v1/documents/mf-sub/move");
    expect((posts()[0]![1] as { body: unknown }).body).toEqual({ parent_id: "wf", revision: "4" });
  });

  it("asks for a move to the workspace root as well, and Cancel sends nothing", async () => {
    render(wrap(<Harness item={row("mf-sub", "folder", "mf")} />));
    const picker = await openPicker();
    fireEvent.click(within(picker).getByRole("treeitem", { name: t("documents.home.move.root") }));
    fireEvent.click(within(picker).getByRole("button", { name: t("documents.home.move.submit") }));

    const confirm = await screen.findByRole("alertdialog", { name: t("documents.home.move.out_confirm.title") });
    fireEvent.click(within(confirm).getByRole("button", { name: t("common.cancel") }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(posts()).toHaveLength(0);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("moves a document out of My Folder without a dialog (W4)", async () => {
    render(wrap(<Harness item={row("mf-page", "page", "mf")} />));
    const picker = await openPicker();
    fireEvent.click(within(picker).getByRole("treeitem", { name: "Thư mục wf" }));
    fireEvent.click(within(picker).getByRole("button", { name: t("documents.home.move.submit") }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("moves a folder between two places inside My Folder without a dialog", async () => {
    render(wrap(<Harness item={row("mf-deep", "folder", "mf-sub")} />));
    const picker = await openPicker();
    fireEvent.click(within(picker).getByRole("treeitem", { name: "Thư mục mf-other" }));
    fireEvent.click(within(picker).getByRole("button", { name: t("documents.home.move.submit") }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("moves a workspace folder between workspace places without a dialog", async () => {
    render(wrap(<Harness item={row("wf-sub", "folder", "wf")} />));
    const picker = await openPicker();
    fireEvent.click(within(picker).getByRole("treeitem", { name: "Thư mục wf2" }));
    fireEvent.click(within(picker).getByRole("button", { name: t("documents.home.move.submit") }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

function BulkHarness({ plan }: { plan: BulkPlan }) {
  const { bulk, dialogs } = useDocListBulkCommands({ wsId: WS, tree, onDownloadOne: vi.fn(), zipPollMs: 1 });
  return (
    <>
      <button type="button" onClick={() => bulk.run(plan, vi.fn())}>
        go
      </button>
      {dialogs}
    </>
  );
}

function movePlan(docs: DocumentSummaryRow[]): BulkPlan {
  return { action: "move", docs, skipped: [], total: docs.length, titles: new Map(docs.map((d) => [d.id, d.title])) };
}

describe("bulk move: My Folder guards (UNI-2055 A2)", () => {
  beforeEach(() => {
    requestMock.mockReset();
    for (const fn of Object.values(toast)) fn.mockReset();
    answerMoves();
  });

  it("disables My Folder in the batch picker when a selected folder is a workspace folder", async () => {
    render(wrap(<BulkHarness plan={movePlan([row("wf2", "folder", null), row("mf-page", "page", "mf")])} />));
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    const picker = await screen.findByRole("dialog");
    const mf = within(picker).getByRole("treeitem", { name: t("documents.home.my_folder.label") });
    expect(mf).toHaveAttribute("aria-disabled", "true");
    expect(mf).toHaveAccessibleDescription(moveReason());
  });

  it("asks once for the whole batch when any selected folder leaves My Folder, and Cancel sends nothing", async () => {
    const plan = movePlan([row("mf-sub", "folder", "mf"), row("mf-other", "folder", "mf"), row("mf-page", "page", "mf")]);
    render(wrap(<BulkHarness plan={plan} />));
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    const picker = await screen.findByRole("dialog");
    fireEvent.click(within(picker).getByRole("treeitem", { name: "Thư mục wf" }));
    fireEvent.click(within(picker).getByRole("button", { name: t("documents.home.move.submit") }));

    const confirm = await screen.findByRole("alertdialog", { name: t("documents.home.move.out_confirm.title") });
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
    fireEvent.click(within(confirm).getByRole("button", { name: t("common.cancel") }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("runs the batch after the confirm", async () => {
    const plan = movePlan([row("mf-sub", "folder", "mf"), row("mf-page", "page", "mf")]);
    render(wrap(<BulkHarness plan={plan} />));
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    const picker = await screen.findByRole("dialog");
    fireEvent.click(within(picker).getByRole("treeitem", { name: "Thư mục wf" }));
    fireEvent.click(within(picker).getByRole("button", { name: t("documents.home.move.submit") }));
    const confirm = await screen.findByRole("alertdialog", { name: t("documents.home.move.out_confirm.title") });
    fireEvent.click(within(confirm).getByRole("button", { name: t("documents.home.move.out_confirm.confirm") }));
    await waitFor(() => expect(posts()).toHaveLength(2));
  });

  it("does not ask for a batch of documents alone (W4)", async () => {
    const plan = movePlan([row("mf-page", "page", "mf"), row("mf-file", "file", "mf")]);
    render(wrap(<BulkHarness plan={plan} />));
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    const picker = await screen.findByRole("dialog");
    fireEvent.click(within(picker).getByRole("treeitem", { name: "Thư mục wf" }));
    fireEvent.click(within(picker).getByRole("button", { name: t("documents.home.move.submit") }));
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
