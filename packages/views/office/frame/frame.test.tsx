import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OfficeFrame } from "./office-frame";
import { OfficeStatusBar, OfficeStatusZoom } from "./office-status-bar";

describe("OfficeFrame", () => {
  it("renders only the canvas when every slot is absent", () => {
    const { container } = render(<OfficeFrame>page</OfficeFrame>);
    const frame = container.querySelector("[data-office-frame]")!;
    expect(frame.className).toContain("font-sans");
    expect(frame.querySelector("[data-office-canvas]")?.textContent).toBe("page");
    expect(container.querySelector("[data-office-status-bar]")).toBeNull();
    // frame > row > column > canvas: no extra children anywhere
    expect(frame.children).toHaveLength(1);
    expect(frame.querySelectorAll("[data-office-canvas]")).toHaveLength(1);
  });

  it("orders ribbon, subbar, [rail canvas bottom aside] and status bar", () => {
    const { container } = render(
      <OfficeFrame ribbon={<i data-s="ribbon" />} subbar={<i data-s="subbar" />} rail={<i data-s="rail" />}
        aside={<i data-s="aside" />} bottom={<i data-s="bottom" />} statusBar={<i data-s="status" />}>x</OfficeFrame>,
    );
    const order = Array.from(container.querySelectorAll("[data-s],[data-office-canvas]"))
      .map((el) => el.getAttribute("data-s") ?? "canvas");
    expect(order).toEqual(["ribbon", "subbar", "rail", "canvas", "bottom", "aside", "status"]);
  });
});

describe("OfficeStatusBar", () => {
  it("is one 28px row with start, end and help last", () => {
    render(<OfficeStatusBar start={<span>Page 1</span>} end={<span>Words</span>} help={<button type="button">?</button>} />);
    const bar = screen.getByRole("group", { name: "Thanh trạng thái" });
    expect(bar.className).toContain("h-7");
    expect(bar.hasAttribute("data-office-status-bar")).toBe(true);
    expect(bar.textContent).toBe("Page 1Words?");
    expect(bar.lastElementChild?.lastElementChild?.tagName).toBe("BUTTON");
  });
});

describe("OfficeStatusZoom", () => {
  it("calls handlers and shows the value", () => {
    const onZoomIn = vi.fn(); const onZoomOut = vi.fn(); const onReset = vi.fn();
    render(<OfficeStatusZoom value={125} onZoomIn={onZoomIn} onZoomOut={onZoomOut} onReset={onReset} />);
    fireEvent.click(screen.getByRole("button", { name: "Phóng to" }));
    fireEvent.click(screen.getByRole("button", { name: "Thu nhỏ" }));
    // Label in name: the accessible name starts with the visible value.
    fireEvent.click(screen.getByRole("button", { name: "125% Đặt lại thu phóng" }));
    expect(screen.getByRole("button", { name: "125% Đặt lại thu phóng" }).textContent).toBe("125%");
    expect([onZoomIn, onZoomOut, onReset].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it("renders a dash for an unknown value", () => {
    render(<OfficeStatusZoom value={null} onZoomIn={() => undefined} />);
    expect(screen.getByText("–")).toBeTruthy();
  });

  it("blocks the action at the bounds", () => {
    const onZoomIn = vi.fn(); const onZoomOut = vi.fn();
    const { rerender } = render(<OfficeStatusZoom value={500} max={500} onZoomIn={onZoomIn} onZoomOut={onZoomOut} />);
    const zoomIn = screen.getByRole("button", { name: "Phóng to" });
    expect(zoomIn.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(zoomIn);
    expect(onZoomIn).not.toHaveBeenCalled();
    rerender(<OfficeStatusZoom value={10} min={10} onZoomIn={onZoomIn} onZoomOut={onZoomOut} />);
    fireEvent.click(screen.getByRole("button", { name: "Thu nhỏ" }));
    expect(onZoomOut).not.toHaveBeenCalled();
  });
});
