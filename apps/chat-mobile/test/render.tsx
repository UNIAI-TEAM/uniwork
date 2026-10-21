// render() for the component layer: the app's i18n instance (Vietnamese, the
// default locale) and a fresh query client per test, the providers every
// screen gets from app/_layout.tsx.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render as rtlRender, type RenderOptions } from "@testing-library/react-native";
import type { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { i18n } from "@/lib/i18n/singleton";

/** RNTL 14 renders asynchronously: always `await render(...)`. */
export async function render(ui: ReactElement, options?: RenderOptions & { queryClient?: QueryClient }) {
  const queryClient = options?.queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </QueryClientProvider>
  );
  return { queryClient, ...(await rtlRender(ui, { ...options, wrapper })) };
}

/** The Vietnamese string a key renders, so a test names the copy a person hears. */
export const viText = i18n.getFixedT("vi");
