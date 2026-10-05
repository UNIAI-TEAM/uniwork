// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PdfNUpDialog } from "./index";
import type { PdfNUpDialogProps, PdfPageBoxOperationProvider } from "./index";

function provider(overrides: Partial<PdfPageBoxOperationProvider> = {}): PdfPageBoxOperationProvider {
  return { setPageBox: vi.fn(async () => undefined), setNUp: vi.fn(async () => undefined), ...overrides };
}

function isDisabled(element: HTMLElement): boolean {
  return element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true";
}

describe("PdfNUpDialog", () => {
  it("submits one setNUp envelope for every page without a paper size", async () => {
    const host = provider();
    const onApplied = vi.fn();
    const onOpenChange = vi.fn();
    const props: PdfNUpDialogProps = { open: true, pages: [1, 2, 3], provider: host, onOpenChange, onApplied };
    render(<PdfNUpDialog {...props} />);

    expect(screen.getByText("2 trang mỗi tờ")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xếp nhiều trang" }));

    await waitFor(() =>
      expect(host.setNUp).toHaveBeenCalledWith({ pages: [1, 2, 3], layout: { rows: 1, cols: 2 } }),
    );
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("submits a typed range on a chosen paper size", async () => {
    const host = provider();
    render(<PdfNUpDialog open pages={[1, 2, 3, 4, 5, 6]} provider={host} onOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Tất cả 6 trang" }));
    fireEvent.change(screen.getByLabelText("Khoảng trang"), { target: { value: "1-4" } });
    fireEvent.change(screen.getByLabelText("Số hàng"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Số cột"), { target: { value: "2" } });
    expect(screen.getByText("4 trang mỗi tờ")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("combobox", { name: "Khổ giấy" }));
    const a4 = await screen.findByRole("option", { name: "A4" });
    fireEvent.pointerDown(a4, { pointerType: "mouse" });
    fireEvent.pointerUp(a4, { pointerType: "mouse" });
    fireEvent.click(a4);
    fireEvent.click(screen.getByRole("button", { name: "Xếp nhiều trang" }));

    await waitFor(() =>
      expect(host.setNUp).toHaveBeenCalledWith({ pages: [1, 2, 3, 4], layout: { rows: 2, cols: 2 }, paper: "a4" }),
    );
  });

  it("refuses a grid outside the engine's pages-per-sheet range", () => {
    const host = provider();
    render(<PdfNUpDialog open pages={[1, 2]} provider={host} onOpenChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Số hàng"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Số cột"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Xếp nhiều trang" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Cách xếp trang không được hỗ trợ.");

    fireEvent.change(screen.getByLabelText("Số hàng"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Số cột"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Xếp nhiều trang" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Cách xếp trang không được hỗ trợ.");
    expect(host.setNUp).not.toHaveBeenCalled();
  });

  it("reports an empty typed range and a host failure as a localized alert", async () => {
    const host = provider({ setNUp: vi.fn(async () => { throw Object.assign(new Error("x"), { code: "invalid_input" }); }) });
    const onOpenChange = vi.fn();
    render(<PdfNUpDialog open pages={[1, 2]} provider={host} onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Tất cả 2 trang" }));
    fireEvent.click(screen.getByRole("button", { name: "Xếp nhiều trang" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Chọn ít nhất một trang trong tài liệu.");
    expect(host.setNUp).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Khoảng trang"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Xếp nhiều trang" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Yêu cầu không hợp lệ. Thử lại."));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("disables every control when the host is read-only", () => {
    render(<PdfNUpDialog open pages={[1, 2]} provider={provider()} disabled onOpenChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Xếp nhiều trang" })).toBeDisabled();
    expect(isDisabled(screen.getByLabelText("Số hàng"))).toBe(true);
    expect(isDisabled(screen.getByLabelText("Khoảng trang"))).toBe(true);
  });
});
