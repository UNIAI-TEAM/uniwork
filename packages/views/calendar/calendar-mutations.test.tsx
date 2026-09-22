import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { calendarKeys } from "@uniwork/core/calendar";
import { LocaleAdapterProvider } from "@uniwork/core/i18n/react";
import { localeAdapter, requestMock } from "../test/api-mock";
import { useCalendarMutations } from "./calendar-mutations";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

function wrapperFor(qc: QueryClient) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <LocaleAdapterProvider adapter={localeAdapter}>{children}</LocaleAdapterProvider>
      </QueryClientProvider>
    );
  }
  return Wrapper;
}

describe("useCalendarMutations", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("PATCHes task due_date and invalidates calendar", async () => {
    requestMock.mockResolvedValue({ id: "task-1", due_date: "2026-09-11" });
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const { result } = renderHook(() => useCalendarMutations("ws1"), {
      wrapper: wrapperFor(qc),
    });

    await result.current.applyDropPatch({
      kind: "task",
      entityId: "task-1",
      patch: { due_date: "2026-09-11" },
    });

    expect(requestMock).toHaveBeenCalledWith(
      "/api/v1/tasks/task-1",
      expect.objectContaining({
        method: "PATCH",
        body: { due_date: "2026-09-11" },
      }),
    );
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: calendarKeys.all("ws1") }),
    );
  });
});
