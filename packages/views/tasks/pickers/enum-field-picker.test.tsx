import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { EnumFieldPicker } from "./enum-field-picker";

initI18n();

const options = [
  { value: "todo", label: "Cần làm" },
  { value: "doing", label: "Đang làm" },
];

describe("EnumFieldPicker", () => {
  it("gọi onChange với giá trị được chọn", () => {
    const onChange = vi.fn();
    render(
      <EnumFieldPicker value="todo" options={options} onChange={onChange} ariaLabel="Trạng thái">
        Trạng thái
      </EnumFieldPicker>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Trạng thái" }));
    fireEvent.click(screen.getByText("Đang làm"));
    expect(onChange).toHaveBeenCalledWith("doing");
  });

  it("không gọi onChange khi disabled", () => {
    const onChange = vi.fn();
    render(
      <EnumFieldPicker value="todo" options={options} onChange={onChange} disabled ariaLabel="Trạng thái">
        Trạng thái
      </EnumFieldPicker>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Trạng thái" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("chuyển tiếp sự kiện con trỏ trên trigger cho nơi gọi", () => {
    const onTriggerPointerDown = vi.fn();
    render(
      <EnumFieldPicker
        value="todo"
        options={options}
        onChange={vi.fn()}
        ariaLabel="Trạng thái"
        onTriggerPointerDown={onTriggerPointerDown}
      >
        Trạng thái
      </EnumFieldPicker>,
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: "Trạng thái" }));
    expect(onTriggerPointerDown).toHaveBeenCalled();
  });

  it("không để middle-click trên một mục trong menu lọt tới bộ xử lý của hàng bảng", () => {
    // Regression for the row-navigation bug: DataTable's row handler reacts
    // to onAuxClick (middle-click), and DropdownMenuContent only stops
    // onClick from bubbling out of the portalled menu — not onAuxClick.
    // Without forwarding onTriggerPointerDown to the content's onAuxClick
    // too, a middle-click on an open menu item still reaches this row
    // handler and would navigate.
    const onRowAuxClick = vi.fn();
    // Mirrors the real `stopRowNavigation` callback (table-cell-editors.tsx),
    // which actually calls stopPropagation — a bare `vi.fn()` spy wouldn't,
    // so it wouldn't exercise the bug this test guards against.
    const onTriggerPointerDown = vi.fn((event: { stopPropagation: () => void }) =>
      event.stopPropagation(),
    );
    render(
      <div onAuxClick={onRowAuxClick}>
        <EnumFieldPicker
          value="todo"
          options={options}
          onChange={vi.fn()}
          ariaLabel="Trạng thái"
          onTriggerPointerDown={onTriggerPointerDown}
        >
          Trạng thái
        </EnumFieldPicker>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Trạng thái" }));
    const option = screen.getByText("Đang làm");
    fireEvent(
      option,
      new MouseEvent("auxclick", { bubbles: true, button: 1 }),
    );
    expect(onRowAuxClick).not.toHaveBeenCalled();
  });
});
