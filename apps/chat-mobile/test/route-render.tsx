// The route layer (app/): the real expo-router over a map of route files, with the providers
// app/_layout.tsx gives every screen. test/jest-setup.ts mocks expo-router for the component layer,
// so a route test calls jest.unmock("expo-router") itself. jest.config.js runs test/routes/ — never a
// test under app/, which expo-router would take for a route.
import { QueryClient, QueryClientProvider, type DefaultOptions } from "@tanstack/react-query";
import { act } from "@testing-library/react-native";
import { renderRouter, type MockContextConfig } from "expo-router/testing-library";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { i18n } from "@/lib/i18n/singleton";

export interface RenderedRoutes {
  queryClient: QueryClient;
  /** Where the router is now, as a URL path ("/acme/main/chat"). */
  pathname: () => string;
}

/**
 * Mounts the routes at `initialUrl`. Awaited: RNTL 14 renders asynchronously. `queries` overrides the query
 * defaults (no retry): a test of a retry the app makes passes the app's own.
 */
export async function renderRoutes(routes: MockContextConfig, initialUrl: string, queries: DefaultOptions["queries"] = {}): Promise<RenderedRoutes> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, ...queries }, mutations: { gcTime: Infinity } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </QueryClientProvider>
  );
  // renderRouter hangs its route getters on the render promise it returns, and turns Jest's fake
  // timers on for its first render. The screens then wait on queries, which RNTL 14's waitFor cannot
  // do under fake timers, so real ones come back once the router is mounted — after the timers the
  // first render queued have run: TanStack Query batches its updates on one, and a batch left on a
  // fake timer would hold every later update of the screen.
  const rendered = renderRouter(routes, { initialUrl, wrapper });
  await rendered;
  await act(async () => {
    jest.runOnlyPendingTimers();
  });
  jest.useRealTimers();
  return { queryClient, pathname: () => rendered.getPathname() };
}
