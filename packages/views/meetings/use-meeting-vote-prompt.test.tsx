import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { initI18n } from "@uniwork/core/i18n";
import { meetingKeys } from "@uniwork/core/meetings";
import { requestMock } from "../test/api-mock";
import { useMeetingVotePrompt } from "./use-meeting-vote-prompt";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const TITLE = "Thông qua kế hoạch quý IV";
const open = {
  id: "mo1", title: TITLE, description: "", position: 1,
  ballot_mode: "SECRET", threshold: "MAJORITY", base: "PRESENT", status: "OPEN",
  opened_at: "2026-10-01T02:10:00Z", roll_size: 3, total_members: 4, cast_count: 0,
  result: null, voters: null, my_ballot: { on_roll: true, cast: false, choice: null },
};
const closed = {
  ...open,
  status: "CLOSED",
  closed_at: "2026-10-01T02:20:00Z",
  cast_count: 3,
  result: { yes: 2, no: 1, abstain: 0, required: 2, outcome: "PASSED" },
  my_ballot: { on_roll: true, cast: true, choice: null },
};
let motions: unknown[] = [];

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const hook = renderHook(() => useMeetingVotePrompt("m1"), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  });
  return { qc, ...hook };
}

/** Waits until the list has loaded and React Query has handed it to the hook. */
async function settled(qc: QueryClient) {
  await waitFor(() => expect(qc.getQueryState(meetingKeys.motions("m1"))?.status).toBe("success"));
  // Observers are notified on a zero-delay timer, after the cache is written.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  motions = [open];
  vi.mocked(toast.info).mockClear();
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown) =>
    Promise.resolve(String(path).endsWith("/motions") ? { motions } : {}),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useMeetingVotePrompt", () => {
  it("offers the open item this person still has to vote on", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.motion?.id).toBe("mo1"));
    expect(result.current.recorded).toBe(false);
  });

  it("offers nothing once the ballot is cast", async () => {
    motions = [{ ...open, my_ballot: { on_roll: true, cast: true, choice: null } }];
    const { qc, result } = setup();
    await settled(qc);
    expect(result.current.motion).toBeNull();
  });

  it("stays hidden after the person hides it, even when the list refetches", async () => {
    const { qc, result } = setup();
    await waitFor(() => expect(result.current.motion?.id).toBe("mo1"));
    act(() => result.current.dismiss());
    expect(result.current.motion).toBeNull();
    await act(async () => {
      await qc.invalidateQueries({ queryKey: meetingKeys.motions("m1") });
    });
    expect(result.current.motion).toBeNull();
  });

  it("shows the recorded state for a few seconds, then goes away", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.motion?.id).toBe("mo1"));
    vi.useFakeTimers();
    act(() => result.current.markRecorded());
    expect(result.current.recorded).toBe(true);
    expect(result.current.motion?.id).toBe("mo1");
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(result.current.motion).toBeNull();
    expect(result.current.recorded).toBe(false);
  });

  it("announces the result when an item it saw open closes", async () => {
    const { qc, result } = setup();
    await waitFor(() => expect(result.current.motion?.id).toBe("mo1"));
    expect(toast.info).not.toHaveBeenCalled();
    motions = [closed];
    await act(async () => {
      await qc.invalidateQueries({ queryKey: meetingKeys.motions("m1") });
    });
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith(`“${TITLE}”: Thông qua`));
    expect(toast.info).toHaveBeenCalledTimes(1);
  });

  it("does not announce results that were already closed on arrival", async () => {
    motions = [closed];
    const { qc } = setup();
    await settled(qc);
    expect(toast.info).not.toHaveBeenCalled();
  });
});
