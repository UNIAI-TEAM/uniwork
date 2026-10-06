/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { initI18n, setLocale } from "@uniwork/core/i18n";
// Entry tests exercise startup locale selection without importing the entire
// editor graph. App behavior has its own integration tests.
vi.mock("./app", () => ({ App: () => <div>{initI18n().t("officeDesktop.login.start")}</div> }));

function hostWith(appearance: unknown) {
  return {
    call: vi.fn(async (channel: string) => {
      if (channel === "desktop:appearance") {
        if (appearance instanceof Error) throw appearance;
        return appearance;
      }
      return channel === "desktop:auth-config" ? { clientId: "uniwork-office-dev", deploymentId: "lane" } : { status: "signed-out" };
    }),
    onSessionChanged: () => () => undefined,
  };
}

async function boot(appearance: unknown) {
  vi.resetModules();
  document.body.innerHTML = '<main id="root"></main>';
  window.uniworkOffice = hostWith(appearance);
  await import("./index");
}

afterEach(() => { document.documentElement.classList.remove("dark"); });

it("mounts the app in the OS language when the shared dictionaries carry it", async () => {
  await setLocale("vi");
  await boot({ dark: false, languages: ["en-GB", "vi-VN"] });
  await waitFor(() => expect(document.getElementById("root")?.textContent).toContain("Sign in"));
  expect(document.documentElement.lang).toBe("en");
  expect(document.documentElement.classList.contains("dark")).toBe(false);
});

it("falls back to Vietnamese for an unsupported OS language and starts dark when the OS is dark", async () => {
  await setLocale("en");
  await boot({ dark: true, languages: ["fr-FR", "de"] });
  await waitFor(() => expect(document.getElementById("root")?.textContent).toContain("Đăng nhập"));
  expect(document.documentElement.lang).toBe("vi");
  expect(document.documentElement.classList.contains("dark")).toBe(true);
});

it("keeps the document language in step with a later switch", async () => {
  await boot({ dark: false, languages: ["vi"] });
  await waitFor(() => expect(document.documentElement.lang).toBe("vi"));
  await setLocale("en");
  expect(document.documentElement.lang).toBe("en");
});

it("degrades to the renderer's own languages when main cannot answer", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }));
  await boot(new Error("no appearance"));
  // jsdom reports en-US.
  await waitFor(() => expect(document.documentElement.lang).toBe("en"));
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  vi.unstubAllGlobals();
});

it("does nothing when the host never injected the bridge", async () => {
  vi.resetModules();
  document.body.innerHTML = '<main id="root">placeholder</main>';
  window.uniworkOffice = undefined;
  await import("./index");
  expect(document.getElementById("root")?.textContent).toBe("placeholder");
});
