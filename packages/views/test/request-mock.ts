import { vi } from "vitest";

/** Mock của api.request, đăng ký trong setup.ts cho mọi test file của views. */
export const requestMock = vi.fn();
