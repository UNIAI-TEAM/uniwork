import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../test/api-mock";
import { AiSummaryTasksDialog, type AiSummaryTaskSeed, type AiSummaryTasksDialogCopy } from "./ai-summary-tasks-dialog";

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
  onConfirm = vi.fn(),
}: {
  open: boolean;
  seeds: AiSummaryTaskSeed[];
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
});
