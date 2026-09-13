import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { AssigneePicker, type AssigneeOption } from "./assignee-picker";

initI18n();

const fewOptions: AssigneeOption[] = [
  { id: "u1", kind: "human", name: "An Nguyễn", secondaryLabel: "an@example.com" },
  { id: "u2", kind: "human", name: "Bình Trần", secondaryLabel: "binh@example.com" },
  { id: "a1", kind: "agent", name: "Trợ lý QA" },
];

// One more than SEARCH_VISIBILITY_THRESHOLD (8) so the search box renders.
const manyOptions: AssigneeOption[] = Array.from({ length: 9 }, (_, i) => ({
  id: `u${i}`,
  kind: "human" as const,
  name: i === 4 ? "Đặng Khánh Linh" : `Thành viên ${i}`,
  secondaryLabel: `member${i}@example.com`,
}));

function renderPicker(props: Partial<React.ComponentProps<typeof AssigneePicker>> = {}) {
  const onChange = vi.fn();
  render(
    <AssigneePicker
      value={null}
      options={fewOptions}
      onChange={onChange}
      ariaLabel="Người phụ trách"
      unassignedLabel="Chưa giao"
      searchPlaceholder="Tìm thành viên"
      noResultsLabel="Không tìm thấy"
      {...props}
    >
      Chưa giao
    </AssigneePicker>,
  );
  return { onChange };
}

describe("AssigneePicker", () => {
  it("gọi onChange với id và kind của thành viên được chọn", async () => {
    const { onChange } = renderPicker();
    fireEvent.click(screen.getByRole("combobox", { name: "Người phụ trách" }));
    const option = await screen.findByText("An Nguyễn");
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith({ id: "u1", kind: "human" });
  });

  it("chọn agent gọi onChange với kind agent", async () => {
    const { onChange } = renderPicker();
    fireEvent.click(screen.getByRole("combobox", { name: "Người phụ trách" }));
    const option = await screen.findByText("Trợ lý QA");
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith({ id: "a1", kind: "agent" });
  });

  it("bỏ gán gọi onChange với null", async () => {
    const { onChange } = renderPicker({ value: { id: "u1", kind: "human" } });
    fireEvent.click(screen.getByRole("combobox", { name: "Người phụ trách" }));
    const list = await screen.findByRole("listbox");
    fireEvent.click(within(list).getByText("Chưa giao"));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("không để click mở trigger lọt tới bộ xử lý click của hàng bảng", () => {
    // Mirrors DataTable's actual row-click bail condition exactly
    // (packages/ui/components/ui/data-table.tsx): the row only skips
    // navigating when the click event arrives with defaultPrevented already
    // set. stopPropagation on pointerdown does NOT stop the click event that
    // follows — they are separate events — so this only holds if the guard
    // is also wired to the trigger's onClick.
    const onRowClick = vi.fn();
    const stopRowNavigation = vi.fn((event: { stopPropagation: () => void }) =>
      event.stopPropagation(),
    );
    render(
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- stands in for DataTable's row wrapper; child control is interactive
      <div
        onClick={(e) => {
          if (e.defaultPrevented) return;
          onRowClick();
        }}
      >
        <AssigneePicker
          value={null}
          options={fewOptions}
          onChange={vi.fn()}
          ariaLabel="Người phụ trách"
          unassignedLabel="Chưa giao"
          searchPlaceholder="Tìm thành viên"
          noResultsLabel="Không tìm thấy"
          onTriggerNavigationGuard={stopRowNavigation}
        >
          Chưa giao
        </AssigneePicker>
      </div>,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Người phụ trách" }));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  describe("chọn một mục không lọt tới điều hướng hàng bảng", () => {
    // Exact copy of the real row handler: DataTable's bail
    // (packages/ui/components/ui/data-table.tsx) followed by table-view.tsx's
    // `closest` filter. A bare `defaultPrevented` check is not enough — it
    // missed this bug. The combobox popup is portalled, so the item is not a
    // DOM descendant of any button in the row and its role is `option`, which
    // the filter does not match; only stopping React propagation keeps the
    // click from reaching the row.
    function renderInRow(props: Partial<React.ComponentProps<typeof AssigneePicker>> = {}) {
      const onChange = vi.fn();
      const onOpenTask = vi.fn();
      const onRowClick = (event: React.MouseEvent) => {
        if (event.defaultPrevented) return;
        if ((event.target as HTMLElement).closest("button, input, a, [role='menuitem']")) return;
        onOpenTask();
      };
      render(
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- stands in for DataTable's row wrapper; child control is interactive
        <div onClick={onRowClick}>
          <AssigneePicker
            value={null}
            options={fewOptions}
            onChange={onChange}
            ariaLabel="Người phụ trách"
            unassignedLabel="Chưa giao"
            searchPlaceholder="Tìm thành viên"
            noResultsLabel="Không tìm thấy"
            onTriggerNavigationGuard={(event) => event.stopPropagation()}
            {...props}
          >
            Chưa giao
          </AssigneePicker>
        </div>,
      );
      return { onChange, onOpenTask };
    }

    it("chọn một thành viên chỉ gán, không mở task", async () => {
      const { onChange, onOpenTask } = renderInRow();
      fireEvent.click(screen.getByRole("combobox", { name: "Người phụ trách" }));
      const option = await screen.findByText("An Nguyễn");
      fireEvent.click(option);
      expect(onChange).toHaveBeenCalledWith({ id: "u1", kind: "human" });
      expect(onOpenTask).not.toHaveBeenCalled();
    });

    it("chọn Chưa giao chỉ bỏ gán, không mở task", async () => {
      const { onChange, onOpenTask } = renderInRow({ value: { id: "u1", kind: "human" } });
      fireEvent.click(screen.getByRole("combobox", { name: "Người phụ trách" }));
      const list = await screen.findByRole("listbox");
      fireEvent.click(within(list).getByText("Chưa giao"));
      expect(onChange).toHaveBeenCalledWith(null);
      expect(onOpenTask).not.toHaveBeenCalled();
    });

    it("gõ tìm và Enter vẫn chọn được, không mở task", async () => {
      const { onChange, onOpenTask } = renderInRow({ options: manyOptions });
      fireEvent.click(screen.getByRole("combobox", { name: "Người phụ trách" }));
      const search = await screen.findByPlaceholderText("Tìm thành viên");
      fireEvent.click(search);
      fireEvent.change(search, { target: { value: "Khánh Linh" } });
      await waitFor(() => {
        expect(screen.queryByText("Thành viên 0")).not.toBeInTheDocument();
      });
      fireEvent.keyDown(search, { key: "ArrowDown" });
      fireEvent.keyDown(search, { key: "Enter" });
      expect(onChange).toHaveBeenCalledWith({ id: "u4", kind: "human" });
      expect(onOpenTask).not.toHaveBeenCalled();
    });
  });

  it("không mở danh sách khi disabled", () => {
    const { onChange } = renderPicker({ disabled: true });
    fireEvent.click(screen.getByRole("combobox", { name: "Người phụ trách" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ẩn ô tìm kiếm khi danh sách ngắn", async () => {
    renderPicker();
    fireEvent.click(screen.getByRole("combobox", { name: "Người phụ trách" }));
    await screen.findByText("An Nguyễn");
    expect(screen.queryByPlaceholderText("Tìm thành viên")).not.toBeInTheDocument();
  });

  it("hiện ô tìm kiếm và gõ vào đó lọc danh sách", async () => {
    renderPicker({ options: manyOptions });
    fireEvent.click(screen.getByRole("combobox", { name: "Người phụ trách" }));
    const search = await screen.findByPlaceholderText("Tìm thành viên");
    fireEvent.change(search, { target: { value: "Khánh Linh" } });
    await waitFor(() => {
      expect(screen.getByText("Đặng Khánh Linh")).toBeInTheDocument();
      expect(screen.queryByText("Thành viên 0")).not.toBeInTheDocument();
    });
  });

  it("đi hết danh sách bằng bàn phím và chọn bằng Enter", async () => {
    const { onChange } = renderPicker({ options: manyOptions });
    fireEvent.click(screen.getByRole("combobox", { name: "Người phụ trách" }));
    const search = await screen.findByPlaceholderText("Tìm thành viên");
    // First ArrowDown highlights "Chưa giao" (unassigned); the second lands
    // on the first member in the list.
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith({ id: "u1", kind: "human" });
  });
});
