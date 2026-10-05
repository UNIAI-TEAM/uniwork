import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { afterEach, beforeAll } from "vitest";

initI18n();

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
