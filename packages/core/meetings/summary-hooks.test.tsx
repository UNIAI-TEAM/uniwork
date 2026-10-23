import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/http";
import {
  SUMMARY_RUN_POLL_MS,
  meetingCatchUpKey,
  summaryQueryRetry,
  useCreateMeetingSummary,
  useMeetingCatchUp,
  useMeetingEvidenceOf,
  useMeetingSummary,
  useMeetingSummaryRun,
} from "./summary-hooks";

const catchUp = vi.hoisted(() => vi.fn());
const getSummary = vi.hoisted(() => vi.fn());
const createSummary = vi.hoisted(() => vi.fn());
vi.mock("../api/endpoints/meeting-summary", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createMeetingCatchUp: catchUp,
  createMeetingSummary: createSummary,
  getMeetingSummary: getSummary,
}));
const evidence = vi.hoisted(() => vi.fn());
vi.mock("../api/endpoints/meeting-evidence", () => ({ getMeetingEvidence: evidence }));

describe("summaryQueryRetry", () => {
  it("gives up at once on a 4xx and retries a 5xx or a dropped connection a few times", () => {
    expect(summaryQueryRetry(0, new ApiError("no", "forbidden", 403))).toBe(false);
    expect(summaryQueryRetry(0, new ApiError("boom", "internal", 500))).toBe(true);
    expect(summaryQueryRetry(0, new TypeError("Failed to fetch"))).toBe(true);
    expect(summaryQueryRetry(3, new ApiError("boom", "internal", 500))).toBe(false);
  });
});

describe("useMeetingSummaryRun", () => {
  it("shares one answer with useMeetingSummary and reads it again while a summary is being made", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const made = { id: "s1", meeting_id: "m1", summary: "Đã chốt", decisions: [] };
    getSummary
      .mockResolvedValueOnce({ summary: null, run: { status: "running", at: "2026-10-23T02:00:00Z", attempts: 1 } })
      .mockResolvedValue({ summary: made, run: { status: "idle", at: null, attempts: 1 } });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
    const { result } = renderHook(() => ({ run: useMeetingSummaryRun("m1"), summary: useMeetingSummary("m1") }), { wrapper });
    await waitFor(() => expect(result.current.run.data?.status).toBe("running"));
    expect(result.current.summary.data).toBeNull();
    expect(getSummary).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SUMMARY_RUN_POLL_MS);
    });
    await waitFor(() => expect(result.current.run.data?.status).toBe("idle"));
    expect(result.current.summary.data).toEqual(made);
    // Idle: no more polling.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SUMMARY_RUN_POLL_MS * 3);
    });
    expect(getSummary).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe("useCreateMeetingSummary", () => {
  it("shows the started run at once and keeps the summary on record until the run lands a new one", async () => {
    const stored = { id: "s1", meeting_id: "m1", summary: "Bản cũ", decisions: [] };
    const running = { status: "running", at: "2026-10-23T02:00:00Z", attempts: 0 };
    getSummary.mockReset();
    getSummary.mockImplementation(() => Promise.resolve({ summary: stored, run: { status: "idle", at: null, attempts: 0 } }));
    createSummary.mockReset();
    createSummary.mockImplementation(() => {
      // A slow read after the click: the started run shows without waiting for it.
      getSummary.mockImplementation(() => new Promise(() => {}));
      return Promise.resolve({ summary: null, run: running });
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
    const { result } = renderHook(
      () => ({ run: useMeetingSummaryRun("m1"), summary: useMeetingSummary("m1"), create: useCreateMeetingSummary("m1") }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.summary.data).toEqual(stored));
    await act(async () => {
      await result.current.create.mutateAsync("vi");
    });
    expect(createSummary).toHaveBeenCalledWith("m1", "vi");
    await waitFor(() => expect(result.current.run.data?.status).toBe("running"));
    // A 202 that carries no summary does not wipe the one on screen.
    expect(result.current.summary.data).toEqual(stored);
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

describe("useMeetingEvidenceOf", () => {
  it("reads each item's lines, settles once all answered, and reads a failure as no lines", async () => {
    const line = { kind: "segment", id: "g1", author: "Minh", text: "Gửi báo giá trước thứ Sáu", at: "2026-10-22T03:00:00Z" };
    evidence.mockImplementation((_m: string, refs: { id: string }[]) =>
      refs[0]?.id === "g1" ? Promise.resolve([line]) : Promise.reject(new ApiError("no", "forbidden", 403)),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
    const items = [
      { evidence: [{ kind: "segment", id: "g1" }] },
      { evidence: [] },
      { evidence: [{ kind: "note", id: "n9" }] },
    ];
    const { result } = renderHook(() => useMeetingEvidenceOf("m1", items, true), { wrapper });
    expect(result.current.settled).toBe(false);
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.lines).toEqual([[line], [], []]);
    // No call for an item that cites nothing.
    expect(evidence).toHaveBeenCalledTimes(2);
  });
});
