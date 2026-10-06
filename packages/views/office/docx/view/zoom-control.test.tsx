// UNI-924 A6: the View ▸ Zoom control renders the controller state and turns
// each control into the matching controller command.
import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { DocxZoomControl, createDocxZoomController, useDocxEffectiveZoomPercent } from "./index";

const ZOOM_LABEL = "Mức thu phóng";

describe("DocxZoomControl", () => {
  it("steps, fits and mirrors the controller state", () => {
    const controller = createDocxZoomController();
    render(<DocxZoomControl controller={controller} />);

    expect(screen.getByRole("combobox", { name: ZOOM_LABEL })).toHaveTextContent("100%");
    fireEvent.click(screen.getByRole("button", { name: "Phóng to" }));
    expect(controller.getState().percent).toBe(110);
    expect(screen.getByRole("combobox", { name: ZOOM_LABEL })).toHaveTextContent("110%");
    fireEvent.click(screen.getByRole("button", { name: "Thu nhỏ" }));
    expect(controller.getState().percent).toBe(100);

    const fit = vi.spyOn(controller, "fit");
    fireEvent.click(screen.getByRole("button", { name: "Vừa chiều rộng" }));
    fireEvent.click(screen.getByRole("button", { name: "Vừa trang" }));
    expect(fit).toHaveBeenNthCalledWith(1, "width");
    expect(fit).toHaveBeenNthCalledWith(2, "page");
    controller.dispose();
  });

  it("keeps every control visible but inert when disabled", () => {
    const controller = createDocxZoomController();
    render(<DocxZoomControl controller={controller} disabled />);

    for (const name of ["Thu nhỏ", "Phóng to", "Vừa chiều rộng", "Vừa trang"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(screen.getByRole("combobox", { name: ZOOM_LABEL })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Phóng to" }));
    expect(controller.getState().percent).toBe(100);
    controller.dispose();
  });

  it("marks the active fit mode and reports a no-op fit before attachment", () => {
    const controller = createDocxZoomController();
    render(<DocxZoomControl controller={controller} />);

    const fitWidth = screen.getByRole("button", { name: "Vừa chiều rộng" });
    expect(fitWidth).toHaveAttribute("aria-pressed", "false");
    // No surface attached: the fit cannot measure and the mode stays manual.
    fireEvent.click(fitWidth);
    expect(fitWidth).toHaveAttribute("aria-pressed", "false");
    expect(controller.getState().mode).toBe("manual");
    controller.dispose();
  });

  it("paints the engaged fit mode through the aria-pressed variant", () => {
    const controller = createDocxZoomController();
    const zoomElement = document.createElement("div");
    const scrollElement = document.createElement("div");
    Object.defineProperty(scrollElement, "clientWidth", { value: 848, configurable: true });
    Object.defineProperty(scrollElement, "clientHeight", { value: 1056, configurable: true });
    controller.attach({ zoomElement, scrollElement, pageSize: { widthPx: 816, heightPx: 1056 } });
    render(<DocxZoomControl controller={controller} />);

    const fitWidth = screen.getByRole("button", { name: "Vừa chiều rộng" });
    fireEvent.click(fitWidth);
    expect(controller.getState().mode).toBe("fit-width");
    expect(fitWidth).toHaveAttribute("aria-pressed", "true");
    // The toolbar variant has no pressed paint of its own; the class carries it.
    expect(fitWidth).toHaveClass("aria-pressed:bg-surface-hover");
    controller.dispose();
  });
});

describe("useDocxEffectiveZoomPercent", () => {
  it("picks up a narrow-canvas cap that lands before it subscribes", () => {
    // The controller attaches (and caps 100% to 44% on a phone) in the editor's
    // effect, which can run between this hook's render and its subscription.
    const real = createDocxZoomController();
    let effective = 100;
    const controller = { ...real, getEffectivePercent: () => effective };
    function Attach() {
      // Runs before Probe subscribes: the cap changes with no notification.
      useEffect(() => {
        effective = 44;
      }, []);
      return null;
    }
    function Probe() {
      return <output>{useDocxEffectiveZoomPercent(controller)}</output>;
    }
    render(
      <>
        <Attach />
        <Probe />
      </>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("44");
  });
});
