import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { DEFAULT_HOME_PREFS, HOME_PRESETS } from "@uniwork/core/home/prefs";
import { wrap } from "../test/api-mock";
import { HomeCustomizePanel } from "./home-customize-panel";

initI18n();

function renderPanel() {
  const props = { onChange: vi.fn(), onReset: vi.fn(), onClose: vi.fn() };
  render(wrap(<HomeCustomizePanel open prefs={DEFAULT_HOME_PREFS} saving={false} {...props} />));
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
    expect(screen.getByRole("button", { name: "Đưa Hộp việc xuống" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Đưa Lịch họp lên" }));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_HOME_PREFS, order: ["stats", "upcoming", "mywork", "inbox"] });
  });

  it("marks the current density and switches it", () => {
    const { onChange } = renderPanel();
    expect(screen.getByRole("radio", { name: /Cân bằng/ })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: /^Gọn/ }));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_HOME_PREFS, layout: "compact" });
  });

  it("applies a preset, resets and closes", () => {
    const { onChange, onReset, onClose } = renderPanel();
    expect(screen.getByRole("radio", { name: /Tối giản/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: /Tối giản/ }));
    expect(onChange).toHaveBeenCalledWith(HOME_PRESETS.find((p) => p.key === "minimal")!.prefs);
    fireEvent.click(screen.getByRole("button", { name: "Đặt lại" }));
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(onReset).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

it("marks the preset the current layout matches", () => {
  const doer = HOME_PRESETS.find((p) => p.key === "doer")!.prefs;
  render(wrap(<HomeCustomizePanel open prefs={doer} saving={false} onChange={vi.fn()} onReset={vi.fn()} onClose={vi.fn()} />));
  expect(screen.getByRole("radio", { name: /Người thực thi/ })).toBeChecked();
});

it("keeps focus on the row when a section reaches the top", () => {
  const onChange = vi.fn();
  const { rerender } = render(
    wrap(<HomeCustomizePanel open prefs={DEFAULT_HOME_PREFS} saving={false} onChange={onChange} onReset={vi.fn()} onClose={vi.fn()} />),
  );
  const up = screen.getByRole("button", { name: "Đưa Công việc của tôi lên" });
  up.focus();
  fireEvent.click(up);
  const moved = onChange.mock.calls[0]![0];
  rerender(wrap(<HomeCustomizePanel open prefs={moved} saving={false} onChange={onChange} onReset={vi.fn()} onClose={vi.fn()} />));
  expect(screen.getByRole("button", { name: "Đưa Công việc của tôi lên" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Đưa Công việc của tôi xuống" })).toHaveFocus();
});
