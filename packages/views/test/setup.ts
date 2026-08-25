import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(cleanup);

// Mock api.request cho toàn bộ test views (setup chạy trước import của test file,
// nên module thật không kịp được nạp).
vi.mock("@uniwork/core/api", async (orig) => {
  const { requestMock } = await import("./request-mock");
  return {
    ...(await orig<typeof import("@uniwork/core/api")>()),
    request: (...a: unknown[]) => requestMock(...a),
  };
});

// jsdom không có canvas: DotSphere đã tự thoát khi getContext trả null.
HTMLCanvasElement.prototype.getContext = (() => null) as never;

// jsdom không có ResizeObserver (useScrollFade dùng).
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;
