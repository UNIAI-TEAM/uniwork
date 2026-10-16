import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetAuthStoreForTests } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../../test/api-mock";
import { OnboardingLogoutButton } from "./onboarding-logout-button";

initI18n();

describe("OnboardingLogoutButton", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    requestMock.mockReset();
  });

  /** A double tap signed out twice; the second ask is for an account already gone. */
  it("signs out once however often it is pressed, and says it is working", async () => {
    requestMock.mockImplementation(() => new Promise(() => {}));
    render(wrapWithNav(<OnboardingLogoutButton />));
    const button = screen.getByRole("button", { name: "Đăng xuất" });
    fireEvent.click(button);
    expect(await screen.findByRole("button", { name: "Đăng xuất", busy: true })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    fireEvent.click(button);
    expect(requestMock.mock.calls.filter(([path]) => path === "/api/v1/auth/logout")).toHaveLength(1);
  });
});
