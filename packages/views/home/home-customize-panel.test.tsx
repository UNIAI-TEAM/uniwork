import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { DEFAULT_HOME_PREFS, HOME_PRESETS } from "@uniwork/core/home/prefs";
import { wrap } from "../test/api-mock";
import { HomeCustomizePanel } from "./home-customize-panel";

initI18n();

function renderPanel() {
  const props = { onChange: vi.fn(), onReset: vi.fn(), onClose: vi.fn() };
  render(wrap(<HomeCustomizePanel prefs={DEFAULT_HOME_PREFS} saving={false} {...props} />));
  return props;
}

describe("HomeCustomizePanel", () => {
  it("hides a section through its switch", () => {
    const { onChange } = renderPanel();
    fireEvent.click(screen.getByRole("switch", { name: "Hộp việc" }));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_HOME_PREFS, enabled: { ...DEFAULT_HOME_PREFS.enabled, inbox: false } });
  });

  it("moves a section and cannot move past either end", () => {
    const { onChange } = renderPanel();
    expect(screen.getByRole("button", { name: "Đưa Tổng quan hôm nay lên" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Đưa Tóm tắt hôm nay xuống" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Đưa Sắp tới lên" }));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_HOME_PREFS, order: ["stats", "upcoming", "mywork", "inbox", "brief"] });
  });

  it("marks the current density and switches it", () => {
    const { onChange } = renderPanel();
    expect(screen.getByRole("button", { name: /Cân bằng/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /^Gọn/ }));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_HOME_PREFS, layout: "compact" });
  });

  it("applies a preset, resets and closes", () => {
    const { onChange, onReset, onClose } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Tối giản/ }));
    expect(onChange).toHaveBeenCalledWith(HOME_PRESETS.find((p) => p.key === "minimal")!.prefs);
    fireEvent.click(screen.getByRole("button", { name: "Đặt lại" }));
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(onReset).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
