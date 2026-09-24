import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ThemeProvider } from "@uniwork/ui/components/common/theme-provider";
import { ACCENT_STORAGE_KEY } from "@uniwork/ui/lib/accent";
import { ThemesPanel } from "./themes-panel";

function renderPanel() {
  return render(
    <ThemeProvider>
      <ThemesPanel />
    </ThemeProvider>,
  );
}

describe("ThemesPanel", () => {
  it("renders both axes as radio groups", () => {
    renderPanel();
    // Native radios: the appearance tiles and the accent chips must be two
    // separate groups, otherwise picking an accent clears the appearance.
    expect(screen.getAllByRole("radio")).toHaveLength(14);
    expect(screen.getByRole("group", { name: "Chế độ hiển thị" })).toBeInTheDocument();
  });

  it("gives every accent a name of its own", () => {
    renderPanel();
    const accents = screen.getByRole("group", { name: "Màu nhấn" });
    const names = within(accents)
      .getAllByRole("radio")
      .map((r) => r.closest("label")?.textContent ?? "");
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("Mận");
  });

  it("applies and persists the accent chosen", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("radio", { name: "Bạc hà" }));
    expect(document.documentElement.getAttribute("data-accent")).toBe("mint");
    expect(window.localStorage.getItem(ACCENT_STORAGE_KEY)).toBe("mint");
  });

  it("clears the accent attribute when the default is chosen back", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("radio", { name: "Bạc hà" }));
    fireEvent.click(screen.getByRole("radio", { name: "UniWork (theo logo)" }));
    expect(document.documentElement.hasAttribute("data-accent")).toBe(false);
  });
});
