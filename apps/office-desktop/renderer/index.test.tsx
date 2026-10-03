/** @vitest-environment jsdom */
import { expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { initI18n, setLocale } from "@uniwork/core/i18n";
// Entry tests exercise startup locale selection without importing the entire
// editor graph. App behavior has its own integration tests.
vi.mock("./app", () => ({ App: () => <div>{initI18n().t("officeDesktop.login.start")}</div> }));

it("mounts the app onto #root once i18n and the bridge are ready", async () => {
  document.body.innerHTML = '<main id="root"></main>';
  await setLocale("en");
  window.uniworkOffice = {
    call: vi.fn(async (channel: string) => (channel === "desktop:auth-config" ? { clientId: "uniwork-office-dev", deploymentId: "lane" } : { status: "signed-out" })),
    onSessionChanged: () => () => undefined,
  };
  await import("./index");
  await waitFor(() => expect(document.getElementById("root")?.textContent).toContain("Đăng nhập"));
  expect(document.documentElement.lang).toBe("vi");
  expect(document.getElementById("root")?.textContent).not.toBe("");
});

it("does nothing when the host never injected the bridge", async () => {
  vi.resetModules();
  document.body.innerHTML = '<main id="root">placeholder</main>';
  window.uniworkOffice = undefined;
  await import("./index");
  expect(document.getElementById("root")?.textContent).toBe("placeholder");
});
