// Helper dùng chung cho test views: requestMock (đăng ký ở setup.ts) + wrap QueryClient.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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
