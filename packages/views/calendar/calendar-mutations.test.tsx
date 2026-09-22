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

  it("applyExternalTaskDue PATCHes due_date from sidebar drop", async () => {
    requestMock.mockResolvedValue({ id: "task-2", due_date: "2026-09-20" });
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    const { result } = renderHook(() => useCalendarMutations("ws1"), {
      wrapper: wrapperFor(qc),
    });

    await result.current.applyExternalTaskDue({
      taskId: "task-2",
      dueDate: "2026-09-20",
    });

    expect(requestMock).toHaveBeenCalledWith(
      "/api/v1/tasks/task-2",
      expect.objectContaining({
        method: "PATCH",
        body: { due_date: "2026-09-20" },
      }),
    );
  });

  it("PATCHes meeting times and invalidates calendar", async () => {
    requestMock.mockResolvedValue({
      meeting: {
        id: "m1",
        workspace_id: "ws1",
        title: "Sync",
        description: "",
        starts_at: "2026-09-10T14:00:00.000Z",
        ends_at: "2026-09-10T15:00:00.000Z",
        room_name: "room-m1",
        created_by: "u1",
      },
    });
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const { result } = renderHook(() => useCalendarMutations("ws1"), {
      wrapper: wrapperFor(qc),
    });

    await result.current.applyDropPatch({
      kind: "meeting",
      entityId: "m1",
      body: {
        starts_at: "2026-09-10T14:00:00.000Z",
        ends_at: "2026-09-10T15:00:00.000Z",
      },
    });

    expect(requestMock).toHaveBeenCalledWith(
      "/api/v1/meetings/m1",
      expect.objectContaining({
        method: "PATCH",
        body: {
          starts_at: "2026-09-10T14:00:00.000Z",
          ends_at: "2026-09-10T15:00:00.000Z",
        },
      }),
    );
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: calendarKeys.all("ws1") }),
    );
  });
});
