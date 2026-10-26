import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../test/api-mock";
import { AiSummaryTasksDialog, type AiSummaryTaskSeed, type AiSummaryTasksDialogCopy } from "./ai-summary-tasks-dialog";

const { t } = initI18n();

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.endsWith("/members")) return Promise.resolve({ members: [] });
    if (p.includes("/projects")) return Promise.resolve({ projects: [project], total: 1 });
    return Promise.resolve({});
  });
});

const project = {
  id: "p1", organization_id: "o1", workspace_id: "w1", title: "Ra mắt Q4", description: "", status: "in_progress",
  priority: "none", revision: 1, task_count: 0, done_count: 0, resource_count: 0,
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
};

const seed: AiSummaryTaskSeed = {
  index: 0,
  title: "Gửi biên bản",
  draft: { assigneeId: null, priority: "none", dueDate: "2026-09-25" },
};

const copyFor = (count: number): AiSummaryTasksDialogCopy => ({
  title: "Tạo việc từ tóm tắt",
  description: `Xem lại ${count} việc`,
  projectLabel: "Dự án",
  projectNone: "Không thuộc dự án",
  unassignedLabel: "Không gán",
  suggestedOwner: (name) => `AI ghi: ${name}`,
  submit: `Tạo ${count} việc`,
});

function Harness({
  open,
  seeds,
  notes,
  onConfirm = vi.fn(),
}: {
  open: boolean;
  seeds: AiSummaryTaskSeed[];
  notes?: Record<number, string>;
  onConfirm?: (input: { projectId?: string }) => void;
}) {
  return (
    <AiSummaryTasksDialog
      open={open}
      onOpenChange={vi.fn()}
      wsId="w1"
      idPrefix="t"
      seeds={seeds}
      copy={copyFor(seeds.length)}
      itemNotes={notes}
      pending={false}
      onConfirm={onConfirm}
    />
  );
}

describe("AiSummaryTasksDialog", () => {
  it("keeps what it showed while the popup closes, even when the caller clears its seeds", async () => {
    // jsdom runs no animations: hold the exit transition open, as a browser does.
    Object.defineProperty(Element.prototype, "getAnimations", {
      configurable: true,
      value: () => [{ finished: new Promise(() => {}) }],
    });
    try {
      const client = new QueryClient();
      const { rerender } = render(wrap(<Harness open seeds={[seed]} />, client));
      expect(within(await screen.findByRole("dialog")).getByText("Gửi biên bản")).toBeInTheDocument();

      // The caller closes and clears its selection in one update.
      rerender(wrap(<Harness open={false} seeds={[]} />, client));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      const closing = screen.getByRole("dialog", { hidden: true });
      expect(within(closing).getByText("Gửi biên bản")).toBeInTheDocument();
      expect(within(closing).getByText("Tạo việc từ tóm tắt")).toBeInTheDocument();
      expect(within(closing).getByText("Xem lại 1 việc")).toBeInTheDocument();
    } finally {
      Reflect.deleteProperty(Element.prototype, "getAnimations");
    }
  });

  it("starts every opening from the seeds, not from the last opening's edits", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(wrap(<Harness open seeds={[seed]} onConfirm={onConfirm} />, client));
    await user.click(within(screen.getByRole("dialog")).getByRole("combobox", { name: "Dự án" }));
    await user.click(await screen.findByRole("option", { name: /Ra mắt Q4/ }));
    await waitFor(() =>
      expect(within(screen.getByRole("dialog")).getByRole("combobox", { name: "Dự án" })).toHaveTextContent("Ra mắt Q4"),
    );

    rerender(wrap(<Harness open={false} seeds={[seed]} onConfirm={onConfirm} />, client));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    rerender(wrap(<Harness open seeds={[seed]} onConfirm={onConfirm} />, client));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Tạo 1 việc" }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ projectId: undefined }));
  });

  it("labels the editable title and refuses a blank one on the field, not by reverting it", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      wrap(
        <AiSummaryTasksDialog
          open
          onOpenChange={vi.fn()}
          wsId="w1"
          idPrefix="t"
          seeds={[seed]}
          copy={{ ...copyFor(1), titleLabel: "Tên việc" }}
          pending={false}
          onConfirm={onConfirm}
        />,
      ),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Tên việc", { selector: "label" })).toBeInTheDocument();
    const title = within(dialog).getByRole("textbox", { name: "Tên việc" });
    expect(title).not.toHaveAttribute("aria-invalid");

    await user.clear(title);
    expect(title).toHaveValue("");
    expect(title).toHaveAttribute("aria-invalid", "true");
    const error = within(dialog).getByText(t("tasks.summary_title_required"));
    expect(title.getAttribute("aria-describedby")).toContain(error.closest("[id]")?.id);
    fireEvent.click(within(dialog).getByRole("button", { name: "Tạo 1 việc" }));
    expect(onConfirm).not.toHaveBeenCalled();

    await user.type(title, "Gửi biên bản đã sửa");
    expect(title).not.toHaveAttribute("aria-invalid");
    fireEvent.click(within(dialog).getByRole("button", { name: "Tạo 1 việc" }));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ drafts: { 0: expect.objectContaining({ title: "Gửi biên bản đã sửa" }) } }),
    );
  });

  it("names the said owner only when it is not who is picked, in a neutral chip", async () => {
    requestMock.mockImplementation((path: unknown) =>
      String(path).endsWith("/members")
        ? Promise.resolve({ members: [{ workspace_id: "w1", user_id: "u-mai", role: "member", email: "m@x.com", display_name: "Mai Anh" }] })
        : Promise.resolve({}),
    );
    const picked = { ...seed, owner: "mai anh", draft: { ...seed.draft, assigneeId: "u-mai" } };
    const other = { ...seed, index: 1, title: "Đặt phòng", owner: "Bảo", draft: { ...seed.draft, assigneeId: "u-mai" } };
    render(wrap(<Harness open seeds={[picked, other]} />));
    const dialog = await screen.findByRole("dialog");
    const chip = await within(dialog).findByText("AI ghi: Bảo");
    await waitFor(() => expect(within(dialog).queryByText("AI ghi: mai anh")).not.toBeInTheDocument());
    // Muted, not the brand fill of a selection.
    expect(chip).toHaveClass("bg-muted");
    expect(chip).not.toHaveClass("bg-brand-subtle");
    expect(within(dialog).getAllByRole("combobox", { name: "Người phụ trách" })).toHaveLength(2);
  });

  it("cannot be closed while the tasks are being created", async () => {
    const onOpenChange = vi.fn();
    render(
      wrap(
        <AiSummaryTasksDialog
          open
          onOpenChange={onOpenChange}
          wsId="w1"
          idPrefix="t"
          seeds={[seed]}
          copy={copyFor(1)}
          pending
          onConfirm={vi.fn()}
        />,
      ),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Hủy" }));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(within(dialog).queryByRole("button", { name: "Đóng" })).not.toBeInTheDocument();
  });

  it("marks the item a refusal named on its card", () => {
    render(wrap(<Harness open seeds={[seed]} notes={{ 0: "Trùng tên với một việc đang mở" }} />));
    expect(within(screen.getByRole("dialog")).getByText("Trùng tên với một việc đang mở")).toBeInTheDocument();
  });
});
