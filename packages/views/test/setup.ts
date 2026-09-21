import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { installMediaStubs } from "./media-stub";
import { afterEach, vi } from "vitest";

initI18n();

afterEach(async () => {
  cleanup();
  // i18next is a module singleton; a locale-switch test in one file must not
  // leave English labels for a login test in another worker file.
  await setLocale("vi");
  if (typeof document !== "undefined") {
    document.documentElement.lang = "vi";
  }
});

installMediaStubs();

// Mock the HTTP transport for every views test. Endpoints call `request` from
// api/http; mocking that one module (by resolved path) covers all of them and
// keeps the real schemas in the loop, so a fixture that drifts from the
// contract fails the test the way it would fail the page.
vi.mock("@uniwork/core/api/http", async (orig) => {
  const { requestMock } = await import("./request-mock");
  return {
    ...(await orig<typeof import("@uniwork/core/api/http")>()),
    request: (...a: unknown[]) => requestMock(...a),
  };
});

// DOM shims for jsdom. Pure-logic suites that set `@vitest-environment node`
// still load this setup file — skip every DOM patch there.
if (typeof document !== "undefined") {
  // jsdom không có canvas: DotSphere đã tự thoát khi getContext trả null.
  if (typeof HTMLCanvasElement !== "undefined") {
    HTMLCanvasElement.prototype.getContext = (() => null) as never;
  }

  // jsdom has no PointerEvent; Base UI builds one when a Switch or Toggle is
  // clicked. A MouseEvent subclass is enough for the handlers to run.
  if (typeof (globalThis as { PointerEvent?: unknown }).PointerEvent === "undefined") {
    class PE extends MouseEvent {
      pointerId = 1;
      pointerType: string;
      isPrimary = true;
      constructor(type: string, init?: PointerEventInit) {
        super(type, init);
        // Keep the init's pointer type so touch-only handlers can be tested.
        this.pointerType = init?.pointerType ?? "mouse";
      }
    }
    (globalThis as unknown as { PointerEvent: typeof PE }).PointerEvent = PE;
  }

  // jsdom không có ResizeObserver (useScrollFade dùng).
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;

  // jsdom has no layout, so input-otp's caret/click handling cannot ask which
  // element sits under a point. Answering "none" keeps the input usable.
  if (typeof document.elementFromPoint !== "function") {
    document.elementFromPoint = () => null;
  }

  // jsdom: cmdk calls scrollIntoView when focusing CommandItems.
  Element.prototype.scrollIntoView ??= () => {};
}
