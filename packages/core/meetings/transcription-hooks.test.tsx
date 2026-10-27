import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMeetingTranscriptions } from "./transcription-hooks";

const list = vi.hoisted(() => vi.fn());
vi.mock("../api/endpoints/meeting-transcriptions", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listMeetingTranscriptions: list,
}));

const row = (status: string) => ({ id: "t1", meeting_id: "m1", status });

describe("useMeetingTranscriptions", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls while a transcription is open", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    list.mockResolvedValueOnce([row("RUNNING")]).mockResolvedValue([row("COMPLETE")]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
    const { result } = renderHook(() => useMeetingTranscriptions("m1"), { wrapper });
    await waitFor(() => expect(result.current.data?.[0]?.status).toBe("RUNNING"));
    expect(list).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await waitFor(() => expect(result.current.data?.[0]?.status).toBe("COMPLETE"));
    // Complete: no more polling.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("keeps polling while an earlier part is still open (UNI-2247)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const parts = (older: string) => [{ ...row("COMPLETE"), id: "t2" }, row(older)];
    list.mockReset().mockResolvedValueOnce(parts("RUNNING")).mockResolvedValue(parts("COMPLETE"));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
    const { result } = renderHook(() => useMeetingTranscriptions("m1"), { wrapper });
    await waitFor(() => expect(result.current.data?.[1]?.status).toBe("RUNNING"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await waitFor(() => expect(result.current.data?.[1]?.status).toBe("COMPLETE"));
    expect(list).toHaveBeenCalledTimes(2);
  });
});
