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
});
