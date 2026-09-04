import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { LocaleAdapterProvider } from "@uniwork/core/i18n/react";
import { LocaleSwitch } from "./locale-switch";

const i18n = initI18n();

const localeAdapter = {
  getUserChoice: () => "vi" as const,
  getSystemPreferences: () => ["vi"],
  persist: vi.fn(),
};

beforeEach(() => {
  localeAdapter.persist.mockClear();
});

afterEach(async () => {
  await i18n.changeLanguage("vi");
  document.documentElement.lang = "vi";
});

describe("LocaleSwitch", () => {
  it("offers the other language, in that language, and switches to it", async () => {
    render(
      <LocaleAdapterProvider adapter={localeAdapter}>
        <LocaleSwitch />
      </LocaleAdapterProvider>,
    );
    const toEnglish = screen.getByRole("button", { name: "Chuyển sang English" });
    expect(toEnglish).toHaveTextContent("English");
    expect(toEnglish).toHaveAttribute("lang", "en");

    fireEvent.click(toEnglish);

    expect(localeAdapter.persist).toHaveBeenCalledWith("en");
    expect(document.documentElement.lang).toBe("en");
    // The button now points back the other way, in Vietnamese.
    const toVietnamese = await screen.findByRole("button", { name: "Switch to Tiếng Việt" });
    expect(toVietnamese).toHaveTextContent("Tiếng Việt");
    expect(toVietnamese).toHaveAttribute("lang", "vi");
  });
});
