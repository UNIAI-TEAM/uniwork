import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { afterEach, beforeAll } from "vitest";

initI18n();

// Every waitFor/findBy here waits on a real mount, engine open or IPC round
// trip. The 1 s default expires on a loaded CI VM before the work is done, so
// the budget is shared; a passing wait still returns as soon as it holds.
configure({ asyncUtilTimeout: 10_000 });

// The desktop host defaults to Vietnamese; the suite asserts on Vietnamese
// copy and each test starts from that default, same as packages/views.
beforeAll(async () => {
  await setLocale("vi");
  if (typeof document !== "undefined") document.documentElement.lang = "vi";
});

afterEach(async () => {
  cleanup();
  await setLocale("vi");
  if (typeof document !== "undefined") document.documentElement.lang = "vi";
});

if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    media: query,
    matches: false,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
