import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { renderInTableRow } from "../../test/table-row";
import { EnumFieldPicker } from "./enum-field-picker";

initI18n();

const options = [
  { value: "todo", label: "Cần làm" },
  { value: "doing", label: "Đang làm" },
];

const nextFrame = () =>
  act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));

const manyOptions = Array.from({ length: 10 }, (_, index) => ({
  value: `s${index}`,
  label: index === 7 ? "Chờ kiểm thử" : `Trạng thái ${index}`,
}));

describe("EnumFieldPicker", () => {
  it("gọi onChange với giá trị được chọn và đóng danh sách", async () => {
    const onChange = vi.fn();
    render(
      <EnumFieldPicker value="todo" options={options} onChange={onChange} ariaLabel="Trạng thái">
        Trạng thái
      </EnumFieldPicker>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Trạng thái" }));
    expect(screen.getByRole("button", { name: "Cần làm" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Đang làm" }));
    expect(onChange).toHaveBeenCalledWith("doing");
    await nextFrame();
    expect(screen.queryByRole("button", { name: "Đang làm" })).not.toBeInTheDocument();
  });

  it("tên truy cập của trigger chứa cả trường và giá trị đang hiển thị", () => {
    render(
      <EnumFieldPicker
        value="doing"
        options={options}
        onChange={vi.fn()}
        ariaLabel="Trạng thái"
        valueLabel="Đang làm"
      >
        Đang làm
      </EnumFieldPicker>,
    );
    const trigger = screen.getByRole("button", { name: "Trạng thái: Đang làm" });
    expect(trigger).toHaveTextContent("Đang làm");
  });

  it("appearance pill vẽ trigger dạng viên thuốc, vẫn giữ tên truy cập", () => {
    render(
      <EnumFieldPicker
        value="doing"
        options={options}
        onChange={vi.fn()}
        ariaLabel="Trạng thái"
        valueLabel="Đang làm"
        appearance="pill"
      >
        Đang làm
      </EnumFieldPicker>,
    );
    expect(screen.getByRole("button", { name: "Trạng thái: Đang làm" })).toHaveClass("rounded-full");
  });

  it("nhiều lựa chọn thì có ô tìm kiếm lọc theo nhãn, không phân biệt dấu", () => {
    render(
      <EnumFieldPicker
        value="s0"
        options={manyOptions}
        onChange={vi.fn()}
        ariaLabel="Trạng thái"
        searchPlaceholder="Tìm trạng thái"
        noResultsLabel="Không có kết quả"
      >
        Trạng thái
      </EnumFieldPicker>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Trạng thái" }));
    const search = screen.getByRole("textbox", { name: "Tìm trạng thái" });
    fireEvent.change(search, { target: { value: "cho kiem" } });
    expect(screen.getByRole("button", { name: "Chờ kiểm thử" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Trạng thái 1" })).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText("Không có kết quả")).toBeInTheDocument();
  });

  it("ít lựa chọn thì không có ô tìm kiếm", () => {
    render(
      <EnumFieldPicker
        value="todo"
        options={options}
        onChange={vi.fn()}
        ariaLabel="Trạng thái"
        searchPlaceholder="Tìm trạng thái"
      >
        Trạng thái
      </EnumFieldPicker>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Trạng thái" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("disabled thì trigger giữ aria-disabled, không mở danh sách, không gọi onChange", async () => {
    const onChange = vi.fn();
    render(
      <EnumFieldPicker value="todo" options={options} onChange={onChange} disabled ariaLabel="Trạng thái">
        Trạng thái
      </EnumFieldPicker>,
    );
    const trigger = screen.getByRole("button", { name: "Trạng thái" });
    fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
    fireEvent.mouseDown(trigger, { button: 0 });
    fireEvent.click(trigger);
    await nextFrame();
    expect(screen.queryByRole("button", { name: "Đang làm" })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger).toHaveAttribute("aria-disabled", "true");
    expect(trigger).not.toBeDisabled();
  });

  it("bị disabled khi đang mở rồi bật lại thì danh sách không tự mở lại", async () => {
    const picker = (disabled: boolean) => (
      <EnumFieldPicker
        value="todo"
        options={options}
        onChange={vi.fn()}
        disabled={disabled}
        ariaLabel="Trạng thái"
      >
        Trạng thái
      </EnumFieldPicker>
    );
    const { rerender } = render(picker(false));
    fireEvent.click(screen.getByRole("button", { name: "Trạng thái" }));
    expect(screen.getByRole("button", { name: "Đang làm" })).toBeInTheDocument();

    rerender(picker(true));
    await nextFrame();
    rerender(picker(false));
    await nextFrame();
    expect(screen.queryByRole("button", { name: "Đang làm" })).not.toBeInTheDocument();
  });

  it("không để click mở trigger lọt tới bộ xử lý click của hàng bảng", () => {
    // DataTable's row only skips navigating when the click arrives with
    // defaultPrevented set; stopping pointerdown does not stop the click.
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
        <EnumFieldPicker
          value="todo"
          options={options}
          onChange={vi.fn()}
          ariaLabel="Trạng thái"
          onTriggerNavigationGuard={stopRowNavigation}
        >
          Trạng thái
        </EnumFieldPicker>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Trạng thái" }));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  describe("trong hàng bảng thật (renderInTableRow)", () => {
    function renderInRow() {
      const onChange = vi.fn();
      const row = renderInTableRow(
        <EnumFieldPicker
          value="todo"
          options={options}
          onChange={onChange}
          ariaLabel="Trạng thái"
          onTriggerNavigationGuard={(event) => event.stopPropagation()}
        >
          Trạng thái
        </EnumFieldPicker>,
      );
      return { onChange, onOpenRow: row.onOpenRow };
    }

    it("mở danh sách rồi chọn một mục chỉ đổi giá trị, không mở task", () => {
      const { onChange, onOpenRow } = renderInRow();
      fireEvent.click(screen.getByRole("button", { name: "Trạng thái" }));
      fireEvent.click(screen.getByRole("button", { name: "Đang làm" }));
      expect(onChange).toHaveBeenCalledWith("doing");
      expect(onOpenRow).not.toHaveBeenCalled();
    });

    it("middle-click trên một mục không mở task", () => {
      const { onOpenRow } = renderInRow();
      fireEvent.click(screen.getByRole("button", { name: "Trạng thái" }));
      fireEvent(
        screen.getByRole("button", { name: "Đang làm" }),
        new MouseEvent("auxclick", { bubbles: true, button: 1 }),
      );
      expect(onOpenRow).not.toHaveBeenCalled();
    });
  });
});
