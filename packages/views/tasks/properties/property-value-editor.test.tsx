import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { TaskProperty } from "@uniwork/core/types";
import { PropertyValueEditor } from "./property-value-editor";

function property(overrides: Partial<TaskProperty> & { type: string }): TaskProperty {
  return {
    id: "p1",
    organization_id: "o1",
    workspace_id: "w1",
    name: "Thuộc tính",
    description: "",
    config: {},
    position: 0,
    usage_count: 0,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  } as TaskProperty;
}

initI18n();

describe("PropertyValueEditor", () => {
  describe("text", () => {
    const prop = property({ type: "text", name: "Ghi chú" });

    it("bấm trigger, sửa rồi Enter thì commit giá trị đã trim", () => {
      const onChange = vi.fn();
      render(
        <PropertyValueEditor property={prop} value="hello" onChange={onChange} onClear={vi.fn()} ariaLabel="Ghi chú" />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Ghi chú" }));
      const input = screen.getByRole("textbox", { name: "Ghi chú" });
      fireEvent.change(input, { target: { value: "  world  " } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onChange).toHaveBeenCalledWith("world");
    });

    it("Escape hủy chỉnh sửa: không gọi onChange, trigger giữ giá trị cũ", () => {
      const onChange = vi.fn();
      render(
        <PropertyValueEditor property={prop} value="hello" onChange={onChange} onClear={vi.fn()} ariaLabel="Ghi chú" />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Ghi chú" }));
      const input = screen.getByRole("textbox", { name: "Ghi chú" });
      fireEvent.change(input, { target: { value: "world" } });
      fireEvent.keyDown(input, { key: "Escape" });
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Ghi chú" })).toHaveTextContent("hello");
    });

    it("xóa hết chữ rồi commit thì gọi onClear", () => {
      const onClear = vi.fn();
      render(
        <PropertyValueEditor property={prop} value="hello" onChange={vi.fn()} onClear={onClear} ariaLabel="Ghi chú" />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Ghi chú" }));
      const input = screen.getByRole("textbox", { name: "Ghi chú" });
      fireEvent.change(input, { target: { value: "   " } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onClear).toHaveBeenCalled();
    });
  });

  describe("url", () => {
    const prop = property({ type: "url", name: "Đường dẫn" });

    it("URL hợp lệ thì commit", () => {
      const onChange = vi.fn();
      render(
        <PropertyValueEditor property={prop} value={undefined} onChange={onChange} onClear={vi.fn()} ariaLabel="Đường dẫn" />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Đường dẫn" }));
      const input = screen.getByRole("textbox", { name: "Đường dẫn" });
      fireEvent.change(input, { target: { value: "https://uniwork.app" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onChange).toHaveBeenCalledWith("https://uniwork.app");
    });

    it("URL không hợp lệ thì hiện aria-invalid + thông báo lỗi, không gọi onChange", () => {
      const onChange = vi.fn();
      render(
        <PropertyValueEditor property={prop} value={undefined} onChange={onChange} onClear={vi.fn()} ariaLabel="Đường dẫn" />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Đường dẫn" }));
      const input = screen.getByRole("textbox", { name: "Đường dẫn" });
      fireEvent.change(input, { target: { value: "not a url" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByText("URL không hợp lệ")).toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("number", () => {
    const prop = property({ type: "number", name: "Số lượng" });

    it("Input dạng text/inputMode decimal, nhận dấu phẩy làm thập phân rồi commit Number", () => {
      const onChange = vi.fn();
      render(
        <PropertyValueEditor property={prop} value={undefined} onChange={onChange} onClear={vi.fn()} ariaLabel="Số lượng" />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Số lượng" }));
      const input = screen.getByRole("textbox", { name: "Số lượng" });
      expect(input).toHaveAttribute("inputmode", "decimal");
      fireEvent.change(input, { target: { value: "12,5" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onChange).toHaveBeenCalledWith(12.5);
    });

    it("giá trị không phải số thì hiện lỗi và không gọi onChange", () => {
      const onChange = vi.fn();
      render(
        <PropertyValueEditor property={prop} value={undefined} onChange={onChange} onClear={vi.fn()} ariaLabel="Số lượng" />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Số lượng" }));
      const input = screen.getByRole("textbox", { name: "Số lượng" });
      fireEvent.change(input, { target: { value: "abc" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(screen.getByText("Số không hợp lệ")).toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("select", () => {
    const prop = property({
      type: "select",
      name: "Trạng thái phụ",
      config: { options: [{ value: "a", label: "Alpha", color: "#ff0000" }, { value: "b", label: "Beta" }] },
    });

    it("chọn một mục trong radio list thì gọi onChange với id của mục đó", () => {
      const onChange = vi.fn();
      render(
        <PropertyValueEditor property={prop} value={undefined} onChange={onChange} onClear={vi.fn()} ariaLabel="Trạng thái phụ" />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Trạng thái phụ" }));
      fireEvent.click(screen.getByRole("menuitemradio", { name: "Beta" }));
      expect(onChange).toHaveBeenCalledWith("b");
    });

    it("có giá trị thì menu hiện mục Xóa giá trị, bấm thì gọi onClear", () => {
      const onClear = vi.fn();
      render(
        <PropertyValueEditor property={prop} value="a" onChange={vi.fn()} onClear={onClear} ariaLabel="Trạng thái phụ" />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Trạng thái phụ" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Xóa giá trị" }));
      expect(onClear).toHaveBeenCalled();
    });
  });

  describe("multi_select", () => {
    const prop = property({
      type: "multi_select",
      name: "Nhãn phụ",
      config: { options: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }] },
    });

    it("bật thêm một mục thì gọi onChange với mảng id đầy đủ", () => {
      const onChange = vi.fn();
      render(
        <PropertyValueEditor property={prop} value={["a"]} onChange={onChange} onClear={vi.fn()} ariaLabel="Nhãn phụ" />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Nhãn phụ" }));
      fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Beta" }));
      expect(onChange).toHaveBeenCalledWith(["a", "b"]);
    });

    it("tắt mục đã chọn duy nhất thì gọi onClear thay vì onChange mảng rỗng", () => {
      const onChange = vi.fn();
      const onClear = vi.fn();
      render(
        <PropertyValueEditor property={prop} value={["a"]} onChange={onChange} onClear={onClear} ariaLabel="Nhãn phụ" />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Nhãn phụ" }));
      fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Alpha" }));
      expect(onClear).toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("date", () => {
    const prop = property({ type: "date", name: "Hạn chót" });

    beforeAll(async () => {
      await import("@uniwork/ui/components/ui/calendar");
    }, 60_000);

    it("chọn một ngày trên lịch thì commit YYYY-MM-DD", async () => {
      const onChange = vi.fn();
      render(
        <PropertyValueEditor property={prop} value="2026-09-06" onChange={onChange} onClear={vi.fn()} ariaLabel="Hạn chót" />,
      );
      fireEvent.click(screen.getByLabelText("Hạn chót"));
      await screen.findAllByRole("gridcell", {}, { timeout: 20_000 });
      fireEvent.click(
        screen
          .getAllByRole("gridcell")
          .map((c) => c.querySelector("button"))
          .find((b) => b?.textContent === "10")!,
      );
      expect(onChange).toHaveBeenCalledWith("2026-09-10");
    });
  });

  describe("checkbox", () => {
    const prop = property({ type: "checkbox", name: "Đã duyệt" });

    it("bấm thì toggle ngay và gọi onChange", () => {
      const onChange = vi.fn();
      render(
        <PropertyValueEditor property={prop} value={false} onChange={onChange} onClear={vi.fn()} ariaLabel="Đã duyệt" />,
      );
      fireEvent.click(screen.getByRole("checkbox", { name: "Đã duyệt" }));
      expect(onChange).toHaveBeenCalledWith(true);
    });
  });

  describe("thuộc tính đã lưu trữ (archived_at)", () => {
    const prop = property({
      type: "text",
      name: "Thuộc tính cũ",
      archived_at: "2026-01-01T00:00:00Z",
    });

    it("chỉ hiển thị, không có ô nhập; nút Xóa giá trị vẫn gọi onClear", () => {
      const onClear = vi.fn();
      render(
        <PropertyValueEditor
          property={prop}
          value="giá trị cũ"
          onChange={vi.fn()}
          onClear={onClear}
          ariaLabel="Thuộc tính cũ"
        />,
      );
      expect(screen.getByText("giá trị cũ")).toBeInTheDocument();
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      // No editable trigger under the property's own name — display only.
      expect(screen.queryByRole("button", { name: "Thuộc tính cũ" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Xóa giá trị" }));
      expect(onClear).toHaveBeenCalled();
    });
  });
});
