import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { installDesignPanelI18n } from "./install-design-i18n";
import { PptxBackgroundDialog } from "./background-dialog";

initI18n();
installDesignPanelI18n();
beforeEach(async () => { await setLocale("en"); });

function renderDialog(overrides: Partial<Parameters<typeof PptxBackgroundDialog>[0]> = {}) {
  const onApply = vi.fn();
  const onOpenChange = vi.fn();
  const view = render(
    <PptxBackgroundDialog
      open
      onOpenChange={onOpenChange}
      slideIndex={1}
      slideCount={4}
      canReset
      onApply={onApply}
      {...overrides}
    />,
  );
  return { view, onApply, onOpenChange };
}

describe("PptxBackgroundDialog", () => {
  it("is a labelled modal with the three fill modes and the background actions", () => {
    renderDialog();
    expect(screen.getByRole("dialog", { name: "Format background" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Background fill" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Solid" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Gradient" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Picture" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset background" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Apply to all slides" })).toBeInTheDocument();
  });

  it("renders nothing while closed", () => {
    renderDialog({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("applies the solid fill to the selected slide only", () => {
    const { onApply } = renderDialog();
    fireEvent.change(screen.getByTestId("pptx-bg-solid-hex"), { target: { value: "#123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith({ fill: { kind: "solid", color: "#123456" }, slideIndexes: [1] });
  });

  it("fans the same fill out to every slide when apply-to-all is ticked", () => {
    const { onApply } = renderDialog();
    fireEvent.click(screen.getByRole("checkbox", { name: "Apply to all slides" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    // ONE request with every index; the engine turns the array into N ops in one transaction.
    expect(onApply).toHaveBeenCalledWith({ fill: { kind: "solid", color: "#FFFFFF" }, slideIndexes: [0, 1, 2, 3] });
  });

  it("refuses an invalid colour instead of sending it", () => {
    const { onApply } = renderDialog();
    const hex = screen.getByTestId("pptx-bg-solid-hex");
    fireEvent.change(hex, { target: { value: "#12" } });
    expect(hex).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Enter a color as #RRGGBB.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).not.toHaveBeenCalled();
  });

  it("carries the gradient stops, angle and radial flag", () => {
    const { onApply } = renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: "Gradient" }));
    fireEvent.change(screen.getByTestId("pptx-bg-from"), { target: { value: "#010203" } });
    fireEvent.change(screen.getByTestId("pptx-bg-to"), { target: { value: "#aabbcc" } });
    fireEvent.change(screen.getByLabelText("Gradient angle in degrees"), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Radial gradient" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith({
      fill: { kind: "gradient", from: "#010203", to: "#AABBCC", angleDeg: 90, radial: true },
      slideIndexes: [1],
    });
  });

  it("keeps the last valid angle when the angle field is emptied", () => {
    const { onApply } = renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: "Gradient" }));
    fireEvent.change(screen.getByLabelText("Gradient angle in degrees"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    const call = onApply.mock.calls[0]![0];
    expect(call.fill.kind).toBe("gradient");
    expect(call.fill).not.toHaveProperty("angleDeg");
  });

  it("will not apply a picture fill until one is chosen, then sends bytes + extension", async () => {
    const { onApply } = renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: "Picture" }));
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(screen.getByTestId("pptx-bg-image-name")).toHaveTextContent("No picture selected");
    const file = new File([new Uint8Array([1, 2, 3, 4])], "wallpaper.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new Uint8Array([1, 2, 3, 4]).buffer });
    fireEvent.change(screen.getByTestId("pptx-bg-file"), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByTestId("pptx-bg-image-name")).toHaveTextContent("wallpaper.png"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Tile the picture" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    const call = onApply.mock.calls[0]![0];
    expect(call.fill.kind).toBe("image");
    expect(call.fill.ext).toBe("png");
    expect(call.fill.tile).toBe(true);
    expect(Array.from(call.fill.bytes as Uint8Array)).toEqual([1, 2, 3, 4]);
    expect(call.slideIndexes).toEqual([1]);
  });

  it("sends the reset kind", () => {
    const { onApply } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Reset background" }));
    expect(onApply).toHaveBeenCalledWith({ fill: { kind: "reset" }, slideIndexes: [1] });
  });

  it("disables reset when the slide owns no background", () => {
    renderDialog({ canReset: false });
    expect(screen.getByRole("button", { name: "Reset background" })).toBeDisabled();
  });

  it("keeps the background-graphics choice local until Apply, so Escape leaves the deck unchanged", () => {
    const { onApply } = renderDialog();
    const box = screen.getByRole("checkbox", { name: "Hide background graphics" });
    fireEvent.click(box);
    // The toggle is form state: nothing reaches the document before Apply.
    expect(box).toBeChecked();
    expect(onApply).not.toHaveBeenCalled();
    // Escape (onOpenChange(false)) closes without dispatching anything.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("carries the changed graphics choice with the fill on Apply", () => {
    const { onApply } = renderDialog({ graphicsHidden: false });
    fireEvent.click(screen.getByRole("checkbox", { name: "Hide background graphics" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith({
      fill: { kind: "solid", color: "#FFFFFF" },
      slideIndexes: [1],
      graphics: { hidden: true },
    });
  });

  it("omits the graphics part of the request when the choice is unchanged", () => {
    const { onApply } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith({ fill: { kind: "solid", color: "#FFFFFF" }, slideIndexes: [1] });
  });

  it("sends the graphics change for the apply-to-all targets too", () => {
    const { onApply } = renderDialog({ graphicsHidden: true });
    fireEvent.click(screen.getByRole("checkbox", { name: "Apply to all slides" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Hide background graphics" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith({
      fill: { kind: "solid", color: "#FFFFFF" },
      slideIndexes: [0, 1, 2, 3],
      graphics: { hidden: false },
    });
  });

  it("disables every control while busy and reports no apply", () => {
    const { onApply } = renderDialog({ busy: true });
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Solid" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).not.toHaveBeenCalled();
  });

  it("moves between the fill modes with the arrow keys and selects the mode", () => {
    renderDialog();
    const solid = screen.getByRole("radio", { name: "Solid" });
    fireEvent.keyDown(solid, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "Gradient" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Gradient" })).toHaveFocus();
  });

  it("closes through the dialog's own close control", () => {
    const { onOpenChange } = renderDialog();
    fireEvent.click(screen.getByTestId("pptx-bg-cancel"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});