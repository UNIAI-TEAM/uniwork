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
  it("shows both languages as a radio group, each named in its own language, and switches", async () => {
    render(
      <LocaleAdapterProvider adapter={localeAdapter}>
        <LocaleSwitch />
      </LocaleAdapterProvider>,
    );
    expect(screen.getByRole("radiogroup", { name: "Ngôn ngữ" })).toBeInTheDocument();
    const vi_ = screen.getByRole("radio", { name: "Tiếng Việt" });
    const en = screen.getByRole("radio", { name: "English" });
    expect(vi_).toBeChecked();
    expect(en.closest("label")).toHaveAttribute("lang", "en");

    fireEvent.click(en);

    expect(localeAdapter.persist).toHaveBeenCalledWith("en");
    expect(document.documentElement.lang).toBe("en");
    expect(await screen.findByRole("radiogroup", { name: "Language" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "English" })).toBeChecked();
  });

  it("does nothing when the current language is chosen again", () => {
    render(
      <LocaleAdapterProvider adapter={localeAdapter}>
        <LocaleSwitch />
      </LocaleAdapterProvider>,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Tiếng Việt" }));
    expect(localeAdapter.persist).not.toHaveBeenCalled();
  });

  it("keeps two mounted switches in separate groups", () => {
    render(
      <LocaleAdapterProvider adapter={localeAdapter}>
        <LocaleSwitch />
        <LocaleSwitch />
      </LocaleAdapterProvider>,
    );
    const [a, b] = screen.getAllByRole("radio", { name: "English" });
    expect(a).not.toHaveAttribute("name", b!.getAttribute("name")!);
  });
});
