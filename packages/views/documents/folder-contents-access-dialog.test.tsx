import { QueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import {
  backgroundAccepted,
  batchCompleted,
  batchFailed,
  batchRunning,
  dryRunMerge,
  dryRunReplace,
  errorAccessRejected,
  errorBatchRunning,
  errorNotAFolder,
  syncResult,
} from "@uniwork/core/documents/folder-contents-access.fixtures";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../test/api-mock";
import { DocumentTree } from "./document-tree";
import type { DocumentSummaryRow } from "./library-rows";
import { useFolderContentsAccess } from "./use-folder-contents-access";

// UNI-2244: "Chia sẻ các tài liệu bên trong…". The transport is the fake of
// the core fixtures; the dialog is mounted the way hosts mount it, through
// useFolderContentsAccess, so a background batch outliving the dialog is real.

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { t } = initI18n();
const WS = "ws1";
const FOLDER_PATH = "/api/v1/documents/f1/contents-access";

const folder = {
  id: "f1",
  organization_id: "org1",
  workspace_id: WS,
  kind: "folder",
  title: "Hợp đồng",
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
  updated_at: "2026-10-27T03:00:00Z",
} as DocumentSummaryRow;

const candidates = {
  items: [
    { principal_type: "user", principal_id: "u2", name: "Nguyễn An", secondary: "an@acme.vn", direct_level: null, is_home_workspace: false },
    { principal_type: "organization", principal_id: "org1", name: "Acme", secondary: "", direct_level: null, is_home_workspace: false },
  ],
  next_cursor: "",
};

interface Call {
  path: string;
  method?: string;
  body?: { mode: string; items: Array<{ principal_type: string; principal_id: string; level: string }>; dry_run: boolean };
}

/** Routes the fake: candidates, the PUT (dry run or real) and the batch GET. */
function transport(handlers: { dry?: () => unknown; real?: () => unknown; batch?: () => unknown } = {}) {
  const calls: Call[] = [];
  requestMock.mockImplementation((path: string, opts?: { method?: string; body?: Call["body"] }) => {
    if (path.includes("/share-candidates")) return Promise.resolve(candidates);
    calls.push({ path, method: opts?.method, body: opts?.body });
    const answer = path === FOLDER_PATH
      ? (opts?.body?.dry_run ? (handlers.dry ?? (() => dryRunMerge))() : (handlers.real ?? (() => syncResult))())
      : (handlers.batch ?? (() => batchRunning))();
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  });
  return calls;
}

const puts = (calls: Call[]) => calls.filter((c) => c.method === "PUT");
const apiError = (body: { error: { code: string; message: string; fields?: Record<string, unknown> } }, status: number) =>
  new ApiError(body.error.message, body.error.code, status, undefined, body.error.fields);

function Harness() {
  const { onShareContents, dialogs } = useFolderContentsAccess(WS);
  return (
    <>
      <button type="button" onClick={() => onShareContents(folder)}>go</button>
      <button type="button" onClick={() => onShareContents({ ...folder, kind: "file" })}>go-file</button>
      {dialogs}
    </>
  );
}

async function openDialog() {
  const user = userEvent.setup();
  render(wrap(<Harness />, new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })));
  fireEvent.click(screen.getByRole("button", { name: "go" }));
  const dialog = await screen.findByRole("dialog");
  return { user, dialog };
}

async function pick(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, name: RegExp) {
  await user.click(within(dialog).getByRole("combobox", { name: t("documents.share.principal_placeholder") }));
  const listbox = await screen.findByRole("listbox", { name: t("documents.share.principal_placeholder") });
  await user.click(await within(listbox).findByRole("option", { name }));
}

async function chooseMode(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, label: string) {
  await user.click(within(dialog).getByRole("combobox", { name: t("documents.folderAccess.mode_label") }));
  await user.click(await screen.findByRole("option", { name: label }));
}

async function chooseWorkspaceLevel(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, label: string) {
  await user.click(within(dialog).getByRole("combobox", { name: t("documents.folderAccess.workspace_level_label") }));
  await user.click(await screen.findByRole("option", { name: label }));
}

const confirmButton = (dialog: HTMLElement) => within(dialog).getByRole("button", { name: t("documents.folderAccess.confirm") });

async function review(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  await user.click(confirmButton(dialog));
  return await within(dialog).findByTestId("folder-access-summary");
}

describe("folder contents access dialog", () => {
  beforeEach(async () => {
    await setLocale("vi");
    requestMock.mockReset();
    for (const fn of Object.values(toast)) fn.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("opens in Add mode with the fixed sentence, no workspace row, and Confirm held until someone is picked", async () => {
    const calls = transport();
    const { user, dialog } = await openDialog();
    expect(within(dialog).getByRole("heading", { name: t("documents.folderAccess.title", { title: "Hợp đồng" }) })).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Áp dụng cho các tài liệu hiện có. Tài liệu thêm sau không tự nhận quyền.");
    expect(within(dialog).getByRole("combobox", { name: t("documents.folderAccess.mode_label") })).toHaveTextContent("Thêm vào quyền đã có");
    expect(within(dialog).queryByTestId("folder-access-workspace-row")).toBeNull();

    await user.click(confirmButton(dialog));
    expect(confirmButton(dialog)).toHaveAttribute("aria-disabled", "true");
    expect(puts(calls)).toHaveLength(0);

    await pick(user, dialog, /Nguyễn An/);
    expect(within(dialog).getByRole("combobox", { name: t("documents.share.level_for", { name: "Nguyễn An" }) })).toHaveTextContent("Chỉ xem");
    expect(confirmButton(dialog)).not.toHaveAttribute("aria-disabled");
  });

  it("keeps the fixed sentence in every step", async () => {
    transport();
    const { user, dialog } = await openDialog();
    await pick(user, dialog, /Nguyễn An/);
    await review(user, dialog);
    expect(dialog).toHaveTextContent(t("documents.folderAccess.fixed_sentence"));
  });

  it("dry-runs the picked principals with their own levels, then summarizes with the primary Áp dụng", async () => {
    const calls = transport();
    const { user, dialog } = await openDialog();
    await pick(user, dialog, /Nguyễn An/);
    await user.click(within(dialog).getByRole("combobox", { name: t("documents.share.level_for", { name: "Nguyễn An" }) }));
    await user.click(await screen.findByRole("option", { name: "Chỉnh sửa" }));
    await pick(user, dialog, /Acme/);

    const summary = await review(user, dialog);
    expect(puts(calls)[0]?.body).toEqual({
      mode: "merge",
      dry_run: true,
      items: [
        { principal_type: "user", principal_id: "u2", level: "edit" },
        { principal_type: "organization", principal_id: "org1", level: "view" },
      ],
    });
    expect(summary).toHaveTextContent("Sẽ đổi 37 tài liệu · bỏ qua 5 bạn không quản lý");
    expect(summary).not.toHaveTextContent("mất quyền");
    expect(within(dialog).getByRole("button", { name: t("documents.folderAccess.apply") })).not.toHaveAttribute("aria-disabled");
    expect(within(dialog).queryByRole("button", { name: t("documents.folderAccess.apply_replace") })).toBeNull();
  });

  it("says how many are locked only when above zero", async () => {
    transport({ dry: () => ({ ...dryRunMerge, preview: { ...dryRunMerge.preview, skipped_locked: 3 } }) });
    const { user, dialog } = await openDialog();
    await pick(user, dialog, /Nguyễn An/);
    expect(await review(user, dialog)).toHaveTextContent("3 đang bị khóa");
  });

  it("counts with the English plural forms", async () => {
    await setLocale("en");
    transport({ dry: () => ({ ...dryRunMerge, preview: { ...dryRunMerge.preview, changed: 1, skipped_not_manageable: 1 } }) });
    const { user, dialog } = await openDialog();
    await pick(user, dialog, /Nguyễn An/);
    await user.click(within(dialog).getByRole("button", { name: t("documents.folderAccess.confirm") }));
    expect(await within(dialog).findByTestId("folder-access-summary")).toHaveTextContent("Will change 1 document · skip 1 you don't manage");
  });

  it("exposes the stable test ids the e2e lane drives", async () => {
    transport({ dry: () => dryRunReplace });
    const { user, dialog } = await openDialog();
    expect(dialog).toHaveAttribute("data-testid", "folder-access-dialog");
    expect(within(dialog).queryByTestId("folder-access-workspace-row")).toBeNull();

    await user.click(within(dialog).getByTestId("folder-access-mode"));
    expect(await screen.findByTestId("folder-access-mode-merge")).toBeInTheDocument();
    await user.click(await screen.findByTestId("folder-access-mode-replace"));
    expect(within(dialog).getByTestId("folder-access-mode")).toHaveTextContent("Thay thế quyền cũ");
    expect(within(dialog).getByTestId("folder-access-workspace-row")).toBeInTheDocument();

    await pick(user, dialog, /Nguyễn An/);
    expect(within(dialog).getByTestId("folder-access-principal-u2")).toHaveTextContent("Nguyễn An");

    await user.click(within(dialog).getByTestId("folder-access-workspace-level"));
    await user.click(await screen.findByRole("option", { name: "Riêng tư" }));
    await user.click(within(dialog).getByTestId("folder-access-confirm"));
    expect(await within(dialog).findByTestId("folder-access-summary")).toBeInTheDocument();
    expect(within(dialog).getByTestId("folder-access-apply")).toHaveTextContent(t("documents.folderAccess.apply_replace"));
  });

  it("starts the workspace row unchosen in Replace mode and holds Confirm until a level or Riêng tư is picked", async () => {
    const calls = transport({ dry: () => dryRunReplace });
    const { user, dialog } = await openDialog();
    await chooseMode(user, dialog, "Thay thế quyền cũ");
    const workspaceSelect = within(dialog).getByRole("combobox", { name: t("documents.folderAccess.workspace_level_label") });
    expect(workspaceSelect).toHaveTextContent(t("documents.folderAccess.workspace_level_choose"));
    expect(workspaceSelect).not.toHaveTextContent("Riêng tư");
    expect(confirmButton(dialog)).toHaveAttribute("aria-disabled", "true");
    await user.click(confirmButton(dialog));
    expect(puts(calls)).toHaveLength(0);

    await chooseWorkspaceLevel(user, dialog, "Chỉ xem");
    expect(workspaceSelect).toHaveTextContent("Chỉ xem");
    expect(confirmButton(dialog)).not.toHaveAttribute("aria-disabled");
  });

  it("lets Replace go on once Riêng tư is picked, and sends no workspace row", async () => {
    const calls = transport({ dry: () => dryRunReplace });
    const { user, dialog } = await openDialog();
    await chooseMode(user, dialog, "Thay thế quyền cũ");
    expect(confirmButton(dialog)).toHaveAttribute("aria-disabled", "true");
    await chooseWorkspaceLevel(user, dialog, "Riêng tư");
    expect(confirmButton(dialog)).not.toHaveAttribute("aria-disabled");
    await review(user, dialog);
    expect(puts(calls)[0]?.body).toEqual({ mode: "replace", dry_run: true, items: [] });
  });

  it("shows the workspace row and the destructive Thay thế quyền in Replace mode, with who loses access", async () => {
    transport({ dry: () => dryRunReplace });
    const { user, dialog } = await openDialog();
    await chooseMode(user, dialog, "Thay thế quyền cũ");
    const row = within(dialog).getByTestId("folder-access-workspace-row");
    expect(row).toHaveTextContent(t("documents.folderAccess.workspace_row_unnamed"));
    expect(row).toHaveTextContent(t("documents.share.home_badge"));

    await chooseWorkspaceLevel(user, dialog, "Riêng tư");
    const summary = await review(user, dialog);
    expect(summary).toHaveTextContent("12 người mất quyền ở ít nhất một tài liệu");
    const apply = within(dialog).getByRole("button", { name: t("documents.folderAccess.apply_replace") });
    expect(apply.className).toMatch(/destructive/);
    expect(within(dialog).queryByRole("button", { name: t("documents.folderAccess.apply") })).toBeNull();
  });

  it("writes the workspace row at the chosen level in Replace mode", async () => {
    const calls = transport({ dry: () => dryRunReplace });
    const { user, dialog } = await openDialog();
    await chooseMode(user, dialog, "Thay thế quyền cũ");
    await chooseWorkspaceLevel(user, dialog, "Chỉnh sửa");
    await review(user, dialog);
    expect(puts(calls)[0]?.body?.items).toEqual([{ principal_type: "workspace", principal_id: WS, level: "edit" }]);
  });

  it("gives each known warning its own line", async () => {
    transport({ dry: () => dryRunReplace });
    const { user, dialog } = await openDialog();
    await chooseMode(user, dialog, "Thay thế quyền cũ");
    await chooseWorkspaceLevel(user, dialog, "Riêng tư");
    const summary = await review(user, dialog);
    expect(within(summary).getByTestId("folder-access-warning-wide_scope")).toHaveTextContent(t("documents.folderAccess.warning_wide_scope"));
    expect(within(summary).getByTestId("folder-access-warning-to_private")).toHaveTextContent(t("documents.folderAccess.warning_to_private"));
    expect(within(summary).queryByTestId("folder-access-warning-downgrade")).toBeNull();
  });

  it("warns about a downgrade with its count", async () => {
    transport({ dry: () => ({ ...dryRunMerge, preview: { ...dryRunMerge.preview, downgraded_users: 3, warnings: ["downgrade"] } }) });
    const { user, dialog } = await openDialog();
    await pick(user, dialog, /Nguyễn An/);
    const summary = await review(user, dialog);
    expect(within(summary).getByTestId("folder-access-warning-downgrade")).toHaveTextContent("3 người bị hạ mức quyền ở ít nhất một tài liệu");
  });

  it("says nothing will change and holds Áp dụng when the dry run changes no document", async () => {
    const calls = transport({ dry: () => ({ total: 4, preview: { ...dryRunMerge.preview, changed: 0, unchanged: 4, skipped_not_manageable: 0 } }) });
    const { user, dialog } = await openDialog();
    await pick(user, dialog, /Nguyễn An/);
    const summary = await review(user, dialog);
    expect(summary).toHaveTextContent(t("documents.folderAccess.nothing_to_change"));
    const apply = within(dialog).getByRole("button", { name: t("documents.folderAccess.apply") });
    expect(apply).toHaveAttribute("aria-disabled", "true");
    await user.click(apply);
    expect(puts(calls).filter((c) => c.body?.dry_run === false)).toHaveLength(0);
  });

  it("applies a small subtree at once: a result toast, then the dialog closes", async () => {
    const calls = transport();
    const { user, dialog } = await openDialog();
    await pick(user, dialog, /Nguyễn An/);
    await review(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: t("documents.folderAccess.apply") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(puts(calls).map((c) => c.body?.dry_run)).toEqual([true, false]);
    expect(puts(calls)[1]?.body?.items).toEqual(puts(calls)[0]?.body?.items);
    expect(toast.success).toHaveBeenCalledWith("Đã đổi quyền 37 tài liệu", { description: "Bỏ qua 5 tài liệu bạn không quản lý." });
  });

  it("shows the progress of a background batch, lets the dialog close, and toasts when it completes", async () => {
    let polls = 0;
    transport({
      real: () => backgroundAccepted,
      batch: () => (++polls < 2 ? batchRunning : batchCompleted),
    });
    const { user, dialog } = await openDialog();
    await pick(user, dialog, /Nguyễn An/);
    await review(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: t("documents.folderAccess.apply") }));

    const progress = await within(dialog).findByTestId("folder-access-progress");
    await waitFor(() => expect(within(progress).getByTestId("folder-access-progress-count")).toHaveTextContent("600/1800 tài liệu"));
    expect(within(progress).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "33");
    expect(toast.success).not.toHaveBeenCalled();

    // Closing does not cancel the batch: the watcher keeps polling and speaks.
    await user.click(within(dialog).getByRole("button", { name: t("documents.folderAccess.progress_close") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã đổi quyền 1750 tài liệu", { description: "Bỏ qua 25 tài liệu bạn không quản lý. 5 tài liệu đang bị khóa nên chưa đổi." }), { timeout: 6000 });
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("toasts the failure of a background batch once", async () => {
    transport({ real: () => backgroundAccepted, batch: () => batchFailed });
    const { user, dialog } = await openDialog();
    await pick(user, dialog, /Nguyễn An/);
    await review(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: t("documents.folderAccess.apply") }));
    expect(await within(dialog).findByText(t("documents.folderAccess.batch_failed"))).toBeInTheDocument();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t("documents.folderAccess.batch_failed")));
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("switches to the progress of the running batch on a 409", async () => {
    const calls = transport({ real: () => apiError(errorBatchRunning, 409) });
    const { user, dialog } = await openDialog();
    await pick(user, dialog, /Nguyễn An/);
    await review(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: t("documents.folderAccess.apply") }));

    const progress = await within(dialog).findByTestId("folder-access-progress");
    expect(progress).toHaveTextContent(t("documents.folderAccess.progress_already_running"));
    await waitFor(() => expect(within(progress).getByTestId("folder-access-progress-count")).toHaveTextContent("600/1800"));
    expect(calls.some((c) => c.path === `${FOLDER_PATH}/${errorBatchRunning.error.fields.batch_id}`)).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("says the folder is busy on a 409 without a batch id: no progress, no batch query, choices kept, Confirm usable again", async () => {
    const calls = transport({ real: () => apiError({ error: { code: "folder_access_batch_running", message: "busy" } }, 409) });
    const { user, dialog } = await openDialog();
    await pick(user, dialog, /Nguyễn An/);
    await user.click(within(dialog).getByRole("combobox", { name: t("documents.share.level_for", { name: "Nguyễn An" }) }));
    await user.click(await screen.findByRole("option", { name: "Chỉnh sửa" }));
    await review(user, dialog);
    await user.click(within(dialog).getByTestId("folder-access-apply"));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(t("documents.folderAccess.busy"));
    expect(within(dialog).queryByTestId("folder-access-progress")).toBeNull();
    expect(calls.some((c) => c.method === "GET" && c.path.startsWith(`${FOLDER_PATH}/`))).toBe(false);
    expect(toast.error).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("combobox", { name: t("documents.share.level_for", { name: "Nguyễn An" }) })).toHaveTextContent("Chỉnh sửa");
    expect(confirmButton(dialog)).not.toHaveAttribute("aria-disabled");

    // Confirm runs the dry run again with the same choices.
    await user.click(confirmButton(dialog));
    expect(await within(dialog).findByTestId("folder-access-summary")).toBeInTheDocument();
    expect(puts(calls).map((c) => c.body?.dry_run)).toEqual([true, false, true]);
    expect(puts(calls)[2]?.body?.items).toEqual([{ principal_type: "user", principal_id: "u2", level: "edit" }]);
  });

  it("marks the rejected row on a 422 and sends the person back to the list", async () => {
    transport({ dry: () => apiError(errorAccessRejected, 422) });
    const { user, dialog } = await openDialog();
    await pick(user, dialog, /Nguyễn An/);
    await pick(user, dialog, /Acme/);
    await user.click(confirmButton(dialog));

    // index 1 of the request is the organization row.
    const reason = await within(dialog).findByTestId("rejected-reason-org1");
    expect(reason).toHaveTextContent(t("documents.share.rejected_not_in_org"));
    expect(within(dialog).queryByTestId("rejected-reason-u2")).toBeNull();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(t("documents.folderAccess.error_rejected"));
    expect(within(dialog).queryByTestId("folder-access-summary")).toBeNull();
  });

  it("toasts an error for not_a_folder and keeps the dialog on the list", async () => {
    transport({ dry: () => apiError(errorNotAFolder, 422) });
    const { user, dialog } = await openDialog();
    await pick(user, dialog, /Nguyễn An/);
    await user.click(confirmButton(dialog));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t("documents.folderAccess.error_not_a_folder")));
    expect(within(dialog).queryByTestId("folder-access-summary")).toBeNull();
  });

  it("opens nothing for a row that is not a folder", async () => {
    transport();
    render(wrap(<Harness />));
    fireEvent.click(screen.getByRole("button", { name: "go-file" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("folder contents access from the sidebar tree", () => {
  it("opens the dialog from a folder's right-click menu and dry-runs it", async () => {
    await setLocale("vi");
    requestMock.mockReset();
    const forest = [{ id: "f1", title: "Hợp đồng", kind: "folder", parent_id: null, position: 0, children: [] }];
    requestMock.mockImplementation((path: string) => {
      if (path.includes("/share-candidates")) return Promise.resolve(candidates);
      if (path.startsWith(`/api/v1/workspaces/${WS}/documents/tree`)) return Promise.resolve({ documents: forest });
      if (path === "/api/v1/documents/f1") return Promise.resolve({ document: { ...folder } });
      return Promise.resolve({});
    });
    const user = userEvent.setup();
    render(wrap(<DocumentTree wsId={WS} folders />));
    fireEvent.contextMenu(await screen.findByRole("treeitem", { name: /Hợp đồng/ }));
    await user.click(await screen.findByRole("menuitem", { name: t("documents.folderAccess.menu") }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(t("documents.folderAccess.title", { title: "Hợp đồng" }));
    expect(dialog).toHaveTextContent(t("documents.folderAccess.fixed_sentence"));
  });
});
