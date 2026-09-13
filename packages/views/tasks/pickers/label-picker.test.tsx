import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SyntheticEvent } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { initI18n } from "@uniwork/core/i18n";
import type { TaskLabel } from "@uniwork/core/types";
import { requestMock, wrap } from "../../test/api-mock";
import { renderInTableRow } from "../../test/table-row";
import { LabelPicker } from "./label-picker";
import { useTaskLabelToggle } from "./use-task-label-toggle";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

function label(id: string, name: string, color = "#3b82f6"): TaskLabel {
  return {
    id,
    organization_id: "o1",
    workspace_id: "w1",
    name,
    description: "",
    color,
    usage_count: 0,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
  };
}

const catalog = [label("l1", "Bug"), label("l2", "Frontend"), label("l3", "Backend")];

/** Wires the real toggle hook (real endpoints, mocked transport) to the picker. */
function Harness({
  labels = catalog,
  selectedIds = [],
  onTriggerNavigationGuard,
}: {
  labels?: TaskLabel[];
  selectedIds?: string[];
  onTriggerNavigationGuard?: (event: SyntheticEvent) => void;
}) {
  const { toggle, pendingIds } = useTaskLabelToggle("w1", "t1");
  return (
    <LabelPicker
      labels={labels}
      selectedIds={new Set(selectedIds)}
      pendingIds={pendingIds}
      onToggle={toggle}
      ariaLabel="Nhãn"
      emptyLabel="Workspace chưa có nhãn"
      onTriggerNavigationGuard={onTriggerNavigationGuard}
    >
      Nhãn
    </LabelPicker>
  );
}

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Nhãn" }));
}

function writeCalls() {
  return requestMock.mock.calls.filter(
    ([, init]) => (init as { method?: string } | undefined)?.method,
  );
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue(undefined);
  vi.mocked(toast.error).mockReset();
});

describe("LabelPicker", () => {
  it("bật một nhãn chưa gắn thì gắn đúng id nhãn đó", async () => {
    render(wrap(<Harness />));
    openMenu();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Frontend" }));
    await waitFor(() => expect(writeCalls()).toHaveLength(1));
    expect(writeCalls()[0]).toEqual([
      "/api/v1/tasks/t1/labels",
      { method: "POST", body: { label_id: "l2" } },
    ]);
  });

  it("tắt một nhãn đang gắn thì gỡ đúng id nhãn đó", async () => {
    render(wrap(<Harness selectedIds={["l1"]} />));
    openMenu();
    const bug = screen.getByRole("menuitemcheckbox", { name: "Bug" });
    expect(bug).toHaveAttribute("aria-checked", "true");
    fireEvent.click(bug);
    await waitFor(() => expect(writeCalls()).toHaveLength(1));
    expect(writeCalls()[0]).toEqual([
      "/api/v1/tasks/t1/labels/l1",
      { method: "DELETE" },
    ]);
  });

  it("danh mục rỗng hiện trạng thái rỗng thay vì popup trắng", () => {
    render(wrap(<Harness labels={[]} />));
    openMenu();
    expect(screen.getByRole("menu")).toHaveTextContent("Workspace chưa có nhãn");
    expect(screen.queryByRole("menuitemcheckbox")).not.toBeInTheDocument();
  });

  it("bật hai nhãn trong một lần mở: menu vẫn mở và cả hai lần gắn đều xảy ra", async () => {
    render(wrap(<Harness />));
    openMenu();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Bug" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Backend" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await waitFor(() => expect(writeCalls()).toHaveLength(2));
    expect(writeCalls().map(([, init]) => init)).toEqual([
      { method: "POST", body: { label_id: "l1" } },
      { method: "POST", body: { label_id: "l3" } },
    ]);
  });

  it("gắn thất bại thì hiện toast lỗi", async () => {
    requestMock.mockRejectedValue(new Error("boom"));
    render(wrap(<Harness />));
    openMenu();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Bug" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
  });

  it("gỡ thất bại thì hiện toast lỗi", async () => {
    requestMock.mockRejectedValue(new Error("boom"));
    render(wrap(<Harness selectedIds={["l1"]} />));
    openMenu();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Bug" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
  });

  it("hai lần gắn thất bại liên tiếp trong một lần mở hiện đủ hai toast", async () => {
    // TanStack's per-call `mutate(vars, { onError })` only fires for the
    // latest call on an observer; the first failure would be silent.
    requestMock.mockRejectedValue(new Error("boom"));
    render(wrap(<Harness />));
    openMenu();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Bug" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Backend" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2));
  });

  describe("chặn điều hướng hàng bảng", () => {
    // Mirrors DataTable's row handler (packages/ui/components/ui/data-table.tsx):
    // onClick bails only when defaultPrevented, and the real guard
    // (stopRowNavigation in table-cell-editors.tsx) calls stopPropagation.
    function renderInRow(onRowClick: () => void) {
      const stopRowNavigation = (event: SyntheticEvent) => event.stopPropagation();
      render(
        wrap(
          // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- stands in for DataTable's row wrapper; child control is interactive
          <div
            onClick={(e) => {
              if (e.defaultPrevented) return;
              onRowClick();
            }}
          >
            <Harness onTriggerNavigationGuard={stopRowNavigation} />
          </div>,
        ),
      );
    }

    it("bấm trigger không điều hướng hàng", () => {
      const onRowClick = vi.fn();
      renderInRow(onRowClick);
      openMenu();
      expect(screen.getByRole("menu")).toBeInTheDocument();
      expect(onRowClick).not.toHaveBeenCalled();
    });

    it("bấm một checkbox item trong menu đang mở không điều hướng hàng", async () => {
      const onRowClick = vi.fn();
      renderInRow(onRowClick);
      openMenu();
      fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Bug" }));
      await waitFor(() => expect(writeCalls()).toHaveLength(1));
      expect(onRowClick).not.toHaveBeenCalled();
    });
  });

  describe("trong hàng bảng thật (renderInTableRow)", () => {
    const stopRowNavigation = (event: SyntheticEvent) => event.stopPropagation();

    it("bấm trigger rồi bấm một checkbox item không mở task", async () => {
      const { onOpenRow } = renderInTableRow(
        <Harness onTriggerNavigationGuard={stopRowNavigation} />,
        { wrapper: wrap },
      );
      openMenu();
      fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Bug" }));
      await waitFor(() => expect(writeCalls()).toHaveLength(1));
      expect(onOpenRow).not.toHaveBeenCalled();
    });
  });
});
