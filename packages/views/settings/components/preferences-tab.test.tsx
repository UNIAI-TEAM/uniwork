import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import { ThemeProvider } from "@uniwork/ui/components/common/theme-provider";
import { wrap } from "../../test/api-mock";
import { PreferencesTab } from "./preferences-tab";

vi.mock("@uniwork/core/i18n", async (importOriginal) => {
  const { withBetaLocale } = await import("../../test/beta-locale");
  return withBetaLocale(await importOriginal<typeof import("@uniwork/core/i18n")>());
});

initI18n();

const user: User = {
  id: "u1",
  email: "a@b.c",
  display_name: "An",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {}, locale: "vi",
};

beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser(user);
});

describe("PreferencesTab language", () => {
  it("names every supported locale in its own language and labels the beta one", async () => {
    render(
      wrap(
        <ThemeProvider>
          <PreferencesTab />
        </ThemeProvider>,
      ),
    );
    // Closed, the control shows the current language by its own name.
    expect(screen.getByRole("combobox", { name: "Ngôn ngữ" })).toHaveTextContent("Tiếng Việt");
    fireEvent.click(screen.getByRole("combobox", { name: "Ngôn ngữ" }));
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Tiếng Việt", "English", "ភាសាខ្មែរBeta"]);
  });
});
