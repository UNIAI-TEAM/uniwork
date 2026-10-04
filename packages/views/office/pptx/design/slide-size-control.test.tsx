import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { installDesignPanelI18n } from "./install-design-i18n";
import { PptxSlideSizeControl } from "./slide-size-control";

initI18n();
installDesignPanelI18n();
beforeEach(async () => { await setLocale("en"); });

describe("PptxSlideSizeControl", () => {
  it("offers the two presets with their inch readout", () => {
    render(<PptxSlideSizeControl onSetSlideSize={vi.fn()} />);
    expect(screen.getByRole("radiogroup", { name: "Slide size presets" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Widescreen (16:9)" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Standard (4:3)" })).toBeInTheDocument();
    expect(screen.getByText("13.33 x 7.5 in")).toBeInTheDocument();
    expect(screen.getByText("10 x 7.5 in")).toBeInTheDocument();
  });

  it("reports the preset's EMU size", () => {
    const onSetSlideSize = vi.fn();
    render(<PptxSlideSizeControl onSetSlideSize={onSetSlideSize} />);
    fireEvent.click(screen.getByRole("radio", { name: "Standard (4:3)" }));
    expect(onSetSlideSize).toHaveBeenCalledWith(9144000, 6858000);
  });

  it("checks the preset the deck already uses", () => {
    render(<PptxSlideSizeControl size={{ cx: 12192000, cy: 6858000 }} onSetSlideSize={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "Widescreen (16:9)" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("pptx-design-size-readout")).toHaveTextContent("Widescreen (16:9)");
  });

  it("reads out a custom size the presets cannot name", () => {
    render(<PptxSlideSizeControl size={{ cx: 5486400, cy: 3429000 }} onSetSlideSize={vi.fn()} />);
    expect(screen.getByTestId("pptx-design-size-readout")).toHaveTextContent("Custom (6 x 3.75 in)");
    expect(screen.getByRole("radio", { name: "Widescreen (16:9)" })).toHaveAttribute("aria-checked", "false");
  });

  it("shows no readout when the deck size is unknown", () => {
    render(<PptxSlideSizeControl onSetSlideSize={vi.fn()} />);
    expect(screen.queryByTestId("pptx-design-size-readout")).not.toBeInTheDocument();
  });

  it("disables the presets while busy and dispatches nothing", () => {
    const onSetSlideSize = vi.fn();
    render(<PptxSlideSizeControl busy onSetSlideSize={onSetSlideSize} />);
    const preset = screen.getByRole("radio", { name: "Widescreen (16:9)" });
    expect(preset).toBeDisabled();
    fireEvent.click(preset);
    expect(onSetSlideSize).not.toHaveBeenCalled();
    expect(screen.getByRole("radiogroup", { name: "Slide size presets" })).toHaveAttribute("aria-busy", "true");
  });

  it("moves the roving focus between the presets with the arrow keys", () => {
    render(<PptxSlideSizeControl onSetSlideSize={vi.fn()} />);
    const presets = screen.getAllByRole("radio");
    fireEvent.keyDown(presets[0] as HTMLElement, { key: "ArrowRight" });
    expect(presets[1]).toHaveFocus();
    fireEvent.keyDown(presets[1] as HTMLElement, { key: "ArrowLeft" });
    expect(presets[0]).toHaveFocus();
  });
});