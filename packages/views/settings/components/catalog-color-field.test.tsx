import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { TINTS } from "@uniwork/ui/components/common/icon-tile";
import { tintFromColor } from "@uniwork/ui/lib/tint-from-color";
import { CatalogColorField, hexToHsv, hsvToHex, isHexColor, SWATCH_HEX } from "./catalog-color-field";

initI18n();

describe("SWATCH_HEX", () => {
  it("stores a colour that renders back as the swatch picked", () => {
    for (const tint of TINTS) expect(tintFromColor(SWATCH_HEX[tint])).toBe(tint);
  });
});

describe("isHexColor", () => {
  it("takes only a #rrggbb the server accepts", () => {
    expect(isHexColor("#3B82F6")).toBe(true);
    expect(isHexColor(" #3b82f6 ")).toBe(true);
    expect(isHexColor("3b82f6")).toBe(false);
    expect(isHexColor("#fff")).toBe(false);
  });
});

describe("hexToHsv / hsvToHex", () => {
  it("round-trips every swatch", () => {
    for (const hex of Object.values(SWATCH_HEX)) expect(hsvToHex(hexToHsv(hex))).toBe(hex);
  });
  it("reads the primaries", () => {
    expect(hexToHsv("#ff0000")).toEqual({ h: 0, s: 1, v: 1 });
    expect(hsvToHex({ h: 120, s: 1, v: 1 })).toBe("#00ff00");
    expect(hsvToHex({ h: 240, s: 0, v: 0 })).toBe("#000000");
  });
});

function Harness({ initial = "#3b82f6" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <CatalogColorField value={value} onChange={setValue} />
      <output data-testid="value">{value}</output>
    </>
  );
}

const value = () => screen.getByTestId("value").textContent;

describe("CatalogColorField", () => {
  it("opens a palette and takes a preset", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Chọn màu: #3b82f6" }));
    const palette = await screen.findByRole("dialog", { name: "Bảng màu" });
    fireEvent.click(within(palette).getByRole("button", { name: "Đỏ" }));
    expect(value()).toBe("#ef4444");
    expect(within(palette).getByRole("button", { name: "Đỏ" })).toHaveAttribute("aria-pressed", "true");
  });

  it("moves the hue and keeps the hex field in step", async () => {
    render(<Harness initial="#ff0000" />);
    fireEvent.click(screen.getByRole("button", { name: "Chọn màu: #ff0000" }));
    const palette = await screen.findByRole("dialog", { name: "Bảng màu" });
    fireEvent.change(within(palette).getByRole("slider", { name: "Sắc màu" }), { target: { value: "120" } });
    expect(value()).toBe("#00ff00");
    expect(within(palette).getByLabelText("Mã màu")).toHaveValue("#00ff00");
  });

  it("steps saturation and brightness from the keyboard", async () => {
    render(<Harness initial="#ff0000" />);
    fireEvent.click(screen.getByRole("button", { name: "Chọn màu: #ff0000" }));
    const area = within(await screen.findByRole("dialog", { name: "Bảng màu" })).getByRole("slider", {
      name: "Độ bão hòa và độ sáng",
    });
    fireEvent.keyDown(area, { key: "ArrowDown", shiftKey: true });
    expect(value()).toBe("#e60000");
  });

  it("takes a typed hex and says when it is not one", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Chọn màu: #3b82f6" }));
    const palette = await screen.findByRole("dialog", { name: "Bảng màu" });
    fireEvent.change(within(palette).getByLabelText("Mã màu"), { target: { value: "#12" } });
    expect(within(palette).getByText("Màu là mã hex 6 chữ số, ví dụ #3b82f6.")).toBeInTheDocument();
    fireEvent.change(within(palette).getByLabelText("Mã màu"), { target: { value: "#14B8A6" } });
    expect(value()).toBe("#14b8a6");
  });

  it("picks a random colour the server accepts", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Chọn màu: #3b82f6" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Bảng màu" })).getByRole("button", { name: "Ngẫu nhiên" }));
    expect(isHexColor(value() ?? "")).toBe(true);
  });
});
