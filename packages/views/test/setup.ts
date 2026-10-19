import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { defaultEditLockRoute, editLockRoute } from "./edit-lock-fake";
import { installMediaStubs } from "./media-stub";
import { afterEach, beforeAll, vi } from "vitest";

initI18n();

// The product default is English, but the views suite asserts on Vietnamese
// copy: every file starts in vi, and afterEach puts it back.
beforeAll(async () => {
  await setLocale("vi");
  if (typeof document !== "undefined") {
    document.documentElement.lang = "vi";
  }
});

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
// The edit-lock routes go to a default fake that grants the lock (test/edit-lock-fake.ts),
// so an editable document stays editable in suites about something else.
vi.mock("@uniwork/core/api/http", async (orig) => {
  const { requestMock } = await import("./request-mock");
  const { editLockRoute, isEditLockPath } = await import("./edit-lock-fake");
  return {
    ...(await orig<typeof import("@uniwork/core/api/http")>()),
    request: (...a: unknown[]) =>
      isEditLockPath(a[0]) ? editLockRoute(a[0], a[1] as Parameters<typeof editLockRoute>[1]) : requestMock(...a),
  };
});

afterEach(() => {
  editLockRoute.mockReset();
  editLockRoute.mockImplementation(defaultEditLockRoute);
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

  // jsdom has no layout: ProseMirror's scroll-into-view and the floating
  // toolbar both ask a Range for its client rects, and jsdom only implements
  // them on Element. An empty list means "nothing measured", which is exactly
  // what a layout-less DOM should answer.
  const rangeProto = Range.prototype as Range & {
    getClientRects?: () => DOMRectList;
    getBoundingClientRect?: () => DOMRect;
  };
  rangeProto.getClientRects ??= () => ({ length: 0, item: () => null }) as unknown as DOMRectList;
  rangeProto.getBoundingClientRect ??= () => new DOMRect();

  if (typeof Blob !== "undefined" && typeof Blob.prototype.arrayBuffer !== "function") {
    Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
      for (const sym of Object.getOwnPropertySymbols(this)) {
        const buf = (this as unknown as Record<symbol, { _buffer?: Uint8Array }>)[sym]?._buffer;
        if (buf) {
          return Promise.resolve(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
          );
        }
      }
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error ?? new Error("Failed to read Blob"));
        reader.readAsArrayBuffer(this);
      });
    };
  }
}
