import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/http";
import { meetingCatchUpKey, summaryQueryRetry, useMeetingCatchUp } from "./summary-hooks";

const catchUp = vi.hoisted(() => vi.fn());
vi.mock("../api/endpoints/meeting-summary", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createMeetingCatchUp: catchUp,
}));

describe("summaryQueryRetry", () => {
  it("gives up at once on a 4xx and retries a 5xx or a dropped connection a few times", () => {
    expect(summaryQueryRetry(0, new ApiError("no", "forbidden", 403))).toBe(false);
    expect(summaryQueryRetry(0, new ApiError("boom", "internal", 500))).toBe(true);
    expect(summaryQueryRetry(0, new TypeError("Failed to fetch"))).toBe(true);
    expect(summaryQueryRetry(3, new ApiError("boom", "internal", 500))).toBe(false);
  });
});

describe("useMeetingCatchUp", () => {
  it("keeps the last brief per meeting, so a remount shows it without another model call", async () => {
    const brief = { summary: "Đã chốt lịch", highlights: [], action_items: [], partial: false, generated_at: "2026-10-22T03:00:00Z" };
    catchUp.mockResolvedValue(brief);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
    const first = renderHook(() => useMeetingCatchUp("m1"), { wrapper });
    expect(first.result.current.data).toBeUndefined();
    act(() => first.result.current.mutate("vi"));
    await waitFor(() => expect(first.result.current.data).toEqual(brief));
    expect(qc.getQueryData(meetingCatchUpKey("m1"))).toEqual(brief);
    first.unmount();

    const again = renderHook(() => useMeetingCatchUp("m1"), { wrapper });
    expect(again.result.current.data).toEqual(brief);
    expect(catchUp).toHaveBeenCalledTimes(1);
    // Another meeting has its own brief.
    expect(renderHook(() => useMeetingCatchUp("m2"), { wrapper }).result.current.data).toBeUndefined();
  });

  it("keeps nothing when the server had no brief", async () => {
    catchUp.mockReset();
    catchUp.mockResolvedValue(null);
    const qc = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
    const { result } = renderHook(() => useMeetingCatchUp("m1"), { wrapper });
    act(() => result.current.mutate("vi"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(qc.getQueryData(meetingCatchUpKey("m1"))).toBeUndefined();
  });
});
