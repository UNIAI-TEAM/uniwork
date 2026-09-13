import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { renderInTableRow } from "../../test/table-row";
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
    const onTriggerNavigationGuard = vi.fn();
    render(
      <EnumFieldPicker
        value="todo"
        options={options}
        onChange={vi.fn()}
        ariaLabel="Trạng thái"
        onTriggerNavigationGuard={onTriggerNavigationGuard}
      >
        Trạng thái
      </EnumFieldPicker>,
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: "Trạng thái" }));
    expect(onTriggerNavigationGuard).toHaveBeenCalled();
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

  it("không để middle-click trên một mục trong menu lọt tới bộ xử lý của hàng bảng", () => {
    // Regression for the row-navigation bug: DataTable's row handler reacts
    // to onAuxClick (middle-click), and DropdownMenuContent only stops
    // onClick from bubbling out of the portalled menu — not onAuxClick.
    // Without forwarding onTriggerNavigationGuard to the content's onAuxClick
    // too, a middle-click on an open menu item still reaches this row
    // handler and would navigate.
    const onRowAuxClick = vi.fn();
    // Mirrors the real `stopRowNavigation` callback (table-cell-editors.tsx),
    // which actually calls stopPropagation — a bare `vi.fn()` spy wouldn't,
    // so it wouldn't exercise the bug this test guards against.
    const onTriggerNavigationGuard = vi.fn((event: { stopPropagation: () => void }) =>
      event.stopPropagation(),
    );
    render(
      <div onAuxClick={onRowAuxClick}>
        <EnumFieldPicker
          value="todo"
          options={options}
          onChange={vi.fn()}
          ariaLabel="Trạng thái"
          onTriggerNavigationGuard={onTriggerNavigationGuard}
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

    it("mở menu rồi chọn một mục chỉ đổi giá trị, không mở task", () => {
      const { onChange, onOpenRow } = renderInRow();
      fireEvent.click(screen.getByRole("button", { name: "Trạng thái" }));
      fireEvent.click(screen.getByRole("menuitemradio", { name: "Đang làm" }));
      expect(onChange).toHaveBeenCalledWith("doing");
      expect(onOpenRow).not.toHaveBeenCalled();
    });

    it("middle-click trên một mục không mở task", () => {
      const { onOpenRow } = renderInRow();
      fireEvent.click(screen.getByRole("button", { name: "Trạng thái" }));
      fireEvent(
        screen.getByRole("menuitemradio", { name: "Đang làm" }),
        new MouseEvent("auxclick", { bubbles: true, button: 1 }),
      );
      expect(onOpenRow).not.toHaveBeenCalled();
    });
  });
});
