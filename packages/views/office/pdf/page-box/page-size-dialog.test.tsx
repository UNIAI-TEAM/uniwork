// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PdfPageSizeDialog, resolvePageSelection } from "./index";
import type { PdfPageBoxOperationProvider, PdfPageSizeDialogProps } from "./index";

function provider(overrides: Partial<PdfPageBoxOperationProvider> = {}): PdfPageBoxOperationProvider {
  return { setPageBox: vi.fn(async () => undefined), setNUp: vi.fn(async () => undefined), ...overrides };
}

/** Base UI's span/button-based primitives carry `aria-disabled`, not the native
    attribute; a native input carries `disabled`. Accept either. */
function isDisabled(element: HTMLElement): boolean {
  return element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true";
}

describe("resolvePageSelection", () => {
  it("returns every displayed page for the all-pages choice", () => {
    expect(resolvePageSelection([1, 2, 3], true, "")).toEqual([1, 2, 3]);
  });

  it("parses a range against the displayed pages", () => {
    expect(resolvePageSelection([1, 2, 3, 4], false, "2-3")).toEqual([2, 3]);
  });

  it("refuses a blank, malformed or out-of-document range", () => {
    expect(resolvePageSelection([1, 2, 3], false, "")).toBeNull();
    expect(resolvePageSelection([1, 2, 3], false, "nope")).toBeNull();
    expect(resolvePageSelection([1, 2, 3], false, "9")).toBeNull();
    expect(resolvePageSelection([], true, "")).toBeNull();
  });
});

describe("PdfPageSizeDialog", () => {
  it("submits one setPageBox envelope for every page with the full-page rect", async () => {
    const host = provider();
    const onApplied = vi.fn();
    const onOpenChange = vi.fn();
    const props: PdfPageSizeDialogProps = { open: true, pages: [1, 2, 3], provider: host, onOpenChange, onApplied };
    render(<PdfPageSizeDialog {...props} />);

    expect(screen.getByRole("checkbox", { name: "Tất cả 3 trang" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng kích thước" }));

    await waitFor(() =>
      expect(host.setPageBox).toHaveBeenCalledWith({ pages: [1, 2, 3], box: "crop", rect: [0, 0, 595.28, 841.89] }),
    );
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("submits only the typed range and the picked media box", async () => {
    const host = provider();
    render(<PdfPageSizeDialog open pages={[1, 2, 3, 4]} provider={host} onOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Tất cả 4 trang" }));
    fireEvent.change(screen.getByLabelText("Khoảng trang"), { target: { value: "2-3" } });
    fireEvent.click(screen.getByRole("combobox", { name: "Hộp trang" }));
    const media = await screen.findByRole("option", { name: "Khổ giấy (media)" });
    fireEvent.pointerDown(media, { pointerType: "mouse" });
    fireEvent.pointerUp(media, { pointerType: "mouse" });
    fireEvent.click(media);
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng kích thước" }));

    await waitFor(() =>
      expect(host.setPageBox).toHaveBeenCalledWith({ pages: [2, 3], box: "media", rect: [0, 0, 595.28, 841.89] }),
    );
  });

  it("fills the rect from a preset measured against the host page size", async () => {
    const host = provider();
    render(
      <PdfPageSizeDialog
        open
        pages={[1]}
        provider={host}
        pageSize={{ width: 400, height: 500 }}
        onOpenChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Nửa trái" }));
    expect(screen.getByLabelText("Phải")).toHaveValue(200);
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng kích thước" }));

    await waitFor(() => expect(host.setPageBox).toHaveBeenCalledWith({ pages: [1], box: "crop", rect: [0, 0, 200, 500] }));
  });

  it("rejects a malformed range with a localized alert and no submit", () => {
    const host = provider();
    render(<PdfPageSizeDialog open pages={[1, 2]} provider={host} onOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Tất cả 2 trang" }));
    fireEvent.change(screen.getByLabelText("Khoảng trang"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng kích thước" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Chọn ít nhất một trang trong tài liệu.");
    expect(host.setPageBox).not.toHaveBeenCalled();
  });

  it("rejects an inverted typed rect", () => {
    const host = provider();
    render(<PdfPageSizeDialog open pages={[1]} provider={host} onOpenChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Phải"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng kích thước" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Hình chữ nhật không hợp lệ.");
    expect(host.setPageBox).not.toHaveBeenCalled();
  });

  it("blocks a second submit while the host applies and stays open when it fails", async () => {
    let fail!: (reason: unknown) => void;
    const setPageBox = vi.fn(() => new Promise<void>((_resolve, reject) => { fail = reject; }));
    const onOpenChange = vi.fn();
    render(<PdfPageSizeDialog open pages={[1]} provider={provider({ setPageBox })} onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Áp dụng kích thước" }));
    const busy = screen.getByRole("button", { name: "Đang áp dụng…" });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(setPageBox).toHaveBeenCalledTimes(1);

    fail(Object.assign(new Error("nope"), { code: "invalid_input" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("disables every control when the host is read-only", () => {
    render(<PdfPageSizeDialog open pages={[1, 2]} provider={provider()} disabled onOpenChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Áp dụng kích thước" })).toBeDisabled();
    expect(isDisabled(screen.getByLabelText("Khoảng trang"))).toBe(true);
    expect(isDisabled(screen.getByRole("checkbox", { name: "Tất cả 2 trang" }))).toBe(true);
  });
});
