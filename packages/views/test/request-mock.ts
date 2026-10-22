import { vi } from "vitest";

/** Mock của api.request, đăng ký trong setup.ts cho mọi test file của views. */
export const requestMock = vi.fn();

/** Mock của api.requestStream: mặc định từ chối, để một luồng chưa được dựng lộ ra thay vì treo. */
export const requestStreamMock = vi.fn((..._args: unknown[]) =>
  Promise.reject(new Error("unmocked stream: set requestStreamMock first")),
);
