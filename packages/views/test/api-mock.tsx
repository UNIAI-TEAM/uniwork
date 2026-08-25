// Helper dùng chung cho test views: requestMock (đăng ký ở setup.ts) + wrap QueryClient.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";
import { NavigationProvider, type NavigationAdapter } from "../navigation";

export { requestMock } from "./request-mock";

export function wrap(ui: React.ReactElement) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>
  );
}

/** A NavigationAdapter whose push/replace/back are vi.fn() spies. */
export function fakeNav(pathname = "/"): NavigationAdapter {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname,
    searchParams: new URLSearchParams(),
    getShareableUrl: (p) => p,
  };
}

/** wrap() plus a NavigationProvider, for screens that navigate. */
export function wrapWithNav(ui: React.ReactElement, adapter: NavigationAdapter = fakeNav()) {
  return wrap(<NavigationProvider value={adapter}>{ui}</NavigationProvider>);
}
