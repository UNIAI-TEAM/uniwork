import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useEmailHubLiveSync } from "./hooks-sync";

vi.mock("../api/endpoints/email-hub", () => ({
  subscribeEmailHubInboxWatch: vi.fn(() => Promise.resolve({ subscribed: true })),
  unsubscribeEmailHubInboxWatch: vi.fn(() => Promise.resolve({ subscribed: false })),
  syncEmailHub: vi.fn(() => Promise.resolve({ synced: false })),
}));

const api = await import("../api/endpoints/email-hub");

describe("useEmailHubLiveSync", () => {
  it("keeps the server watch when the reader opens a message, and drops it on unmount", () => {
    const qc = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { rerender, unmount } = renderHook(
      ({ reading }: { reading: boolean }) => useEmailHubLiveSync("ws1", "acc1", true, reading),
      { wrapper, initialProps: { reading: false } },
    );
    rerender({ reading: true });
    // The server stops the watch on DELETE, so a toggle must not send one.
    expect(api.unsubscribeEmailHubInboxWatch).not.toHaveBeenCalled();
    expect(api.subscribeEmailHubInboxWatch).toHaveBeenCalledTimes(1);

    unmount();
    expect(api.unsubscribeEmailHubInboxWatch).toHaveBeenCalledTimes(1);
  });
});
