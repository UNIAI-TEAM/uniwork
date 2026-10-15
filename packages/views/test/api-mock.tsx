// Helper dùng chung cho test views: requestMock (đăng ký ở setup.ts) + wrap QueryClient.
import { useEffect, useMemo, useState } from "react";
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

export function wrap(ui: React.ReactElement, client?: QueryClient) {
  return (
    <QueryClientProvider
      client={
        client ??
        new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } } })
      }
    >
      <LocaleAdapterProvider adapter={localeAdapter}>{ui}</LocaleAdapterProvider>
    </QueryClientProvider>
  );
}

interface SubscribableNav extends NavigationAdapter {
  _subscribe?: (listener: () => void) => () => void;
}

/** A NavigationAdapter whose push/replace/back are vi.fn() spies and maintain URL history. */
export function fakeNav(initialUrl = "/"): NavigationAdapter {
  const parse = (href: string) => {
    const [p = "/", s = ""] = href.split("?");
    return { pathname: p || "/", search: s };
  };
  let history = [parse(initialUrl)];
  let index = 0;
  const listeners = new Set<() => void>();
  const notify = () => {
    const cur = history[index]!;
    nav.pathname = cur.pathname;
    nav.searchParams = new URLSearchParams(cur.search);
    for (const l of listeners) l();
  };
  const nav: SubscribableNav = {
    pathname: history[0]!.pathname,
    searchParams: new URLSearchParams(history[0]!.search),
    push: vi.fn((href: string) => {
      history = [...history.slice(0, index + 1), parse(href)];
      index = history.length - 1;
      notify();
    }),
    replace: vi.fn((href: string) => {
      history = [...history.slice(0, index), parse(href), ...history.slice(index + 1)];
      notify();
    }),
    back: vi.fn(() => {
      if (index > 0) {
        index -= 1;
        notify();
      }
    }),
    openExternal: vi.fn(),
    getShareableUrl: (p) => p,
    _subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return nav;
}

function StatefulNavigation({ adapter, children }: { adapter: NavigationAdapter; children: React.ReactNode }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const sub = (adapter as SubscribableNav)._subscribe;
    return sub ? sub(() => setTick((n) => n + 1)) : undefined;
  }, [adapter]);
  const value = useMemo<NavigationAdapter>(
    () => ({
      ...adapter,
      pathname: adapter.pathname,
      searchParams: adapter.searchParams,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [adapter, adapter.pathname, adapter.searchParams.toString()],
  );
  return <NavigationProvider value={value}>{children}</NavigationProvider>;
}

/** wrap() plus a NavigationProvider, for screens that navigate. */
export function wrapWithNav(ui: React.ReactElement, adapter: NavigationAdapter = fakeNav(), client?: QueryClient) {
  return wrap(<StatefulNavigation adapter={adapter}>{ui}</StatefulNavigation>, client);
}
