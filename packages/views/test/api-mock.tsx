// Helper dùng chung cho test views: mock api.request + wrap QueryClient.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";

export const requestMock = vi.fn();

vi.mock("@uniwork/core/api", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/api")>()),
  request: (...a: unknown[]) => requestMock(...a),
}));

export function wrap(ui: React.ReactElement) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      {ui}
    </QueryClientProvider>
  );
}
