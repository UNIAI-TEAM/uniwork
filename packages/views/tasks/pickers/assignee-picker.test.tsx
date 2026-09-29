import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { renderInTableRow } from "../../test/table-row";
import { AssigneePicker, type AssigneeOption } from "./assignee-picker";

initI18n();

const fewOptions: AssigneeOption[] = [
  { id: "u1", kind: "human", name: "An Nguyễn", secondaryLabel: "an@example.com" },
  { id: "u2", kind: "human", name: "Bình Trần", secondaryLabel: "binh@example.com" },
  { id: "a1", kind: "agent", name: "Trợ lý QA" },
];

const manyOptions: AssigneeOption[] = Array.from({ length: 9 }, (_, i) => ({
  id: `u${i}`,
  kind: "human" as const,
  name: i === 4 ? "Đặng Khánh Linh" : `Thành viên ${i}`,
  secondaryLabel: `member${i}@example.com`,
}));

const baseProps = {
  ariaLabel: "Người phụ trách",
  unassignedLabel: "Chưa giao",
  searchPlaceholder: "Tìm thành viên",
  noResultsLabel: "Không tìm thấy",
};

function renderPicker(props: Partial<React.ComponentProps<typeof AssigneePicker>> = {}) {
  const onChange = vi.fn();
  render(
    <AssigneePicker value={null} options={fewOptions} onChange={onChange} {...baseProps} {...props}>
      Chưa giao
    </AssigneePicker>,
  );
  return { onChange };
}

const openPicker = (name: string | RegExp = "Người phụ trách") =>
  fireEvent.click(screen.getByRole("button", { name }));

describe("AssigneePicker", () => {
  it("gọi onChange với id và kind của thành viên được chọn", async () => {
    const { onChange } = renderPicker();
    openPicker();
    fireEvent.click(await screen.findByRole("button", { name: "An Nguyễn" }));
    expect(onChange).toHaveBeenCalledWith({ id: "u1", kind: "human" });
  });

  it("chọn agent gọi onChange với kind agent", async () => {
    const { onChange } = renderPicker();
    openPicker();
    fireEvent.click(await screen.findByRole("button", { name: "Trợ lý QA" }));
    expect(onChange).toHaveBeenCalledWith({ id: "a1", kind: "agent" });
  });

  it("bỏ gán gọi onChange với null", async () => {
    const { onChange } = renderPicker({ value: { id: "u1", kind: "human" } });
    openPicker();
    fireEvent.click(await screen.findByRole("button", { name: "Chưa giao" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("chia thành viên và agent thành hai nhóm, đánh dấu người đang chọn", async () => {
    renderPicker({ value: { id: "a1", kind: "agent" } });
    openPicker();
    expect(await screen.findByText("Thành viên")).toBeInTheDocument();
    expect(screen.getByText("Agent")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trợ lý QA" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "An Nguyễn" })).toHaveAttribute("aria-pressed", "false");
  });

  it("luôn hiện ô tìm kiếm, kể cả khi danh sách ngắn", async () => {
    renderPicker();
    openPicker();
    expect(await screen.findByPlaceholderText("Tìm thành viên")).toBeInTheDocument();
  });

  it("tìm không dấu, theo cả email", async () => {
    renderPicker({ options: manyOptions });
    openPicker();
    const search = await screen.findByPlaceholderText("Tìm thành viên");
    fireEvent.change(search, { target: { value: "khanh linh" } });
    expect(screen.getByRole("button", { name: "Đặng Khánh Linh" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Thành viên 0" })).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "member7@" } });
    expect(screen.getByRole("button", { name: "Thành viên 7" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Đặng Khánh Linh" })).not.toBeInTheDocument();
  });

  it("báo không có kết quả", async () => {
    renderPicker();
    openPicker();
    fireEvent.change(await screen.findByPlaceholderText("Tìm thành viên"), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("Không tìm thấy")).toBeInTheDocument();
  });

  it("đi hết danh sách bằng bàn phím và chọn bằng Enter", async () => {
    const { onChange } = renderPicker({ options: manyOptions });
    openPicker();
    const search = await screen.findByPlaceholderText("Tìm thành viên");
    // First ArrowDown highlights "Chưa giao"; the second lands on the first member.
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith({ id: "u0", kind: "human" });
  });

  it("gõ tìm rồi Enter chọn kết quả đầu, không bỏ gán", async () => {
    const { onChange } = renderPicker({ options: manyOptions });
    openPicker();
    const search = await screen.findByPlaceholderText("Tìm thành viên");
    fireEvent.change(search, { target: { value: "Khánh Linh" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith({ id: "u4", kind: "human" });
  });

  it("không để click mở trigger lọt tới bộ xử lý click của hàng bảng", () => {
    const onRowClick = vi.fn();
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
          {...baseProps}
          onTriggerNavigationGuard={(event) => event.stopPropagation()}
        >
          Chưa giao
        </AssigneePicker>
      </div>,
    );
    openPicker();
    expect(onRowClick).not.toHaveBeenCalled();
  });

  describe("chọn một mục không lọt tới điều hướng hàng bảng", () => {
    function renderInRow(props: Partial<React.ComponentProps<typeof AssigneePicker>> = {}) {
      const onChange = vi.fn();
      const { onOpenRow: onOpenTask } = renderInTableRow(
        <AssigneePicker
          value={null}
          options={fewOptions}
          onChange={onChange}
          {...baseProps}
          onTriggerNavigationGuard={(event) => event.stopPropagation()}
          {...props}
        >
          Chưa giao
        </AssigneePicker>,
      );
      return { onChange, onOpenTask };
    }

    it("chọn một thành viên chỉ gán, không mở task", async () => {
      const { onChange, onOpenTask } = renderInRow();
      openPicker();
      fireEvent.click(await screen.findByRole("button", { name: "An Nguyễn" }));
      expect(onChange).toHaveBeenCalledWith({ id: "u1", kind: "human" });
      expect(onOpenTask).not.toHaveBeenCalled();
    });

    it("chọn Chưa giao chỉ bỏ gán, không mở task", async () => {
      const { onChange, onOpenTask } = renderInRow({ value: { id: "u1", kind: "human" } });
      openPicker();
      fireEvent.click(await screen.findByRole("button", { name: "Chưa giao" }));
      expect(onChange).toHaveBeenCalledWith(null);
      expect(onOpenTask).not.toHaveBeenCalled();
    });

    it("bấm vào ô tìm kiếm, gõ và Enter vẫn chọn được, không mở task", async () => {
      const { onChange, onOpenTask } = renderInRow({ options: manyOptions });
      openPicker();
      const search = await screen.findByPlaceholderText("Tìm thành viên");
      fireEvent.click(search);
      fireEvent.change(search, { target: { value: "Khánh Linh" } });
      fireEvent.keyDown(search, { key: "Enter" });
      expect(onChange).toHaveBeenCalledWith({ id: "u4", kind: "human" });
      expect(onOpenTask).not.toHaveBeenCalled();
    });
  });

  it("tên truy cập của trigger chứa cả trường và người đang hiển thị", () => {
    render(
      <AssigneePicker
        value={{ id: "u1", kind: "human" }}
        options={fewOptions}
        onChange={vi.fn()}
        {...baseProps}
        valueLabel="An Nguyễn"
      >
        An Nguyễn
      </AssigneePicker>,
    );
    const trigger = screen.getByRole("button", { name: "Người phụ trách: An Nguyễn" });
    expect(trigger).toHaveTextContent("An Nguyễn");
  });

  it("không mở danh sách khi disabled, trigger vẫn nằm trong tab order", () => {
    const { onChange } = renderPicker({ disabled: true });
    const trigger = screen.getByRole("button", { name: "Người phụ trách" });
    expect(trigger).toHaveAttribute("aria-disabled", "true");
    expect(trigger).not.toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByPlaceholderText("Tìm thành viên")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("bị disabled khi danh sách đang mở rồi bật lại thì danh sách không tự mở lại", async () => {
    const nextFrame = () =>
      act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
    const picker = (disabled: boolean) => (
      <AssigneePicker
        value={null}
        options={fewOptions}
        onChange={vi.fn()}
        disabled={disabled}
        {...baseProps}
      >
        Chưa giao
      </AssigneePicker>
    );
    const { rerender } = render(picker(false));
    openPicker();
    expect(await screen.findByPlaceholderText("Tìm thành viên")).toBeInTheDocument();

    rerender(picker(true));
    await waitFor(() =>
      expect(screen.queryByPlaceholderText("Tìm thành viên")).not.toBeInTheDocument(),
    );

    rerender(picker(false));
    await nextFrame();
    expect(screen.queryByPlaceholderText("Tìm thành viên")).not.toBeInTheDocument();
  });
});
