import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { installMediaStubs } from "./media-stub";
import { afterEach, vi } from "vitest";

afterEach(cleanup);

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

// jsdom không có canvas: DotSphere đã tự thoát khi getContext trả null.
HTMLCanvasElement.prototype.getContext = (() => null) as never;

// jsdom has no PointerEvent; Base UI builds one when a Switch or Toggle is
// clicked. A MouseEvent subclass is enough for the handlers to run.
if (typeof (globalThis as { PointerEvent?: unknown }).PointerEvent === "undefined") {
  class PE extends MouseEvent {
    pointerId = 1;
    pointerType = "mouse";
    isPrimary = true;
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
