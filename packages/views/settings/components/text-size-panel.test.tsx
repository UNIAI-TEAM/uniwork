import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { TEXT_SIZE_STORAGE_KEY } from "@uniwork/ui/lib/text-size";
import { TextSizePanel } from "./text-size-panel";

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-text-size");
});

describe("TextSizePanel", () => {
  it("offers the three levels as one named radio group", () => {
    render(<TextSizePanel />);
    const group = screen.getByRole("group", { name: "Cỡ chữ" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("value"))).toEqual(["default", "large", "xlarge"]);
    // One `name` makes them one group: arrow keys and exclusive checking.
    expect(new Set(radios.map((r) => r.getAttribute("name"))).size).toBe(1);
    expect(within(group).getByRole("radio", { name: "Mặc định" })).toBeChecked();
    expect(within(group).getByRole("radio", { name: "Lớn" })).not.toBeChecked();
    expect(within(group).getByRole("radio", { name: "Rất lớn" })).not.toBeChecked();
    expect(screen.getByText("Cỡ chữ của toàn bộ ứng dụng. Chỉ lưu trên thiết bị này.")).toBeInTheDocument();
  });

  it("applies and persists the level chosen, and clears it on the default", async () => {
    const user = userEvent.setup();
    render(<TextSizePanel />);
    await user.click(screen.getByRole("radio", { name: "Rất lớn" }));
    expect(document.documentElement.getAttribute("data-text-size")).toBe("xlarge");
    expect(window.localStorage.getItem(TEXT_SIZE_STORAGE_KEY)).toBe("xlarge");
    await user.click(screen.getByRole("radio", { name: "Mặc định" }));
    expect(document.documentElement.hasAttribute("data-text-size")).toBe(false);
    expect(window.localStorage.getItem(TEXT_SIZE_STORAGE_KEY)).toBe("default");
  });

  it("checks the level the page is already at", () => {
    // What the boot script leaves behind for a stored "large".
    window.localStorage.setItem(TEXT_SIZE_STORAGE_KEY, "large");
    document.documentElement.setAttribute("data-text-size", "large");
    render(<TextSizePanel />);
    expect(screen.getByRole("radio", { name: "Lớn" })).toBeChecked();
  });

  it("moves between levels with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<TextSizePanel />);
    await user.click(screen.getByRole("radio", { name: "Mặc định" }));
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Lớn" })).toBeChecked();
    expect(document.documentElement.getAttribute("data-text-size")).toBe("large");
  });

  it("previews each level at its own size, whatever the page is set to", () => {
    // The page is already at the largest level; the Default sample must not
    // grow with it, so each sample scopes its own level.
    document.documentElement.setAttribute("data-text-size", "xlarge");
    render(<TextSizePanel />);
    for (const radio of screen.getAllByRole("radio")) {
      const sample = radio.closest("label")?.querySelector("[data-text-size]");
      expect(sample?.getAttribute("data-text-size")).toBe(radio.getAttribute("value"));
      expect(sample).toHaveClass("text-title-sm");
    }
  });
});
