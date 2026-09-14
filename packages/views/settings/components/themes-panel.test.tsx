import { fireEvent, render, screen } from "@testing-library/react";
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
    expect(screen.getAllByRole("radio")).toHaveLength(13);
    expect(screen.getByRole("group", { name: /appearance/i })).toBeInTheDocument();
  });

  it("applies and persists the accent chosen", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("radio", { name: /mint/i }));
    expect(document.documentElement.getAttribute("data-accent")).toBe("mint");
    expect(window.localStorage.getItem(ACCENT_STORAGE_KEY)).toBe("mint");
  });

  it("clears the accent attribute when the default is chosen back", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("radio", { name: /mint/i }));
    fireEvent.click(screen.getByRole("radio", { name: /violet/i }));
    expect(document.documentElement.hasAttribute("data-accent")).toBe(false);
  });
});
