// Helper dùng chung cho test views: requestMock (đăng ký ở setup.ts) + wrap QueryClient.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";
import { LocaleAdapterProvider } from "@uniwork/core/i18n/react";
import { NavigationProvider, type NavigationAdapter } from "../navigation";

export { requestMock } from "./request-mock";

/** The adapter the web host provides; `persist` is a spy so a test can assert the switch. */
export const localeAdapter = {
  getUserChoice: () => "vi" as const,
  getSystemPreferences: () => ["vi"],
  persist: vi.fn(),
};

export function wrap(ui: React.ReactElement) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}
    >
      <LocaleAdapterProvider adapter={localeAdapter}>{ui}</LocaleAdapterProvider>
    </QueryClientProvider>
  );
}

/** A NavigationAdapter whose push/replace/back are vi.fn() spies. */
function fakeNav(pathname = "/"): NavigationAdapter {
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
