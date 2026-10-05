import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import type { MeetingMotion } from "../types/meeting";
import { meetingKeys, useEndMeeting } from "./hooks";
import { motionKeys, useCastBallot, useMeetingMotions, useMotionVoters, useUpdateMotion } from "./motion-hooks";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const open: MeetingMotion = {
  id: "mo1",
  title: "Thông qua kế hoạch quý IV",
  description: "",
  position: 1,
  ballot_mode: "SECRET",
  threshold: "MAJORITY",
  base: "PRESENT",
  status: "OPEN",
  roll_size: 3,
  total_members: 4,
  cast_count: 1,
  result: null,
};

const motionsKey = JSON.stringify(["meeting-motions", "m1"]);
const activityKey = JSON.stringify(["meeting-activity", "m1"]);

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function wrapperFor(qc: QueryClient) {
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

const keysCalled = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));

beforeEach(() => {
  setAccessToken("tok");
  vi.stubGlobal("fetch", vi.fn());
  configureRuntime({ apiUrl: "http://api.test" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetRuntimeConfig();
  setAccessToken(null);
});

describe("useCastBallot — not optimistic: the server decides whether a ballot counts", () => {
  it("leaves the cached list alone until the server answers, then refreshes list and timeline", async () => {
    const qc = newClient();
    qc.setQueryData(motionKeys.list("m1"), [open]);
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    let release: (response: Response) => void = () => undefined;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const { result } = renderHook(() => useCastBallot("m1"), { wrapper: wrapperFor(qc) });

    act(() => {
      result.current.mutate({ motionId: "mo1", choice: "NO" });
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(qc.getQueryData(motionKeys.list("m1"))).toEqual([open]);
    expect(invalidate).not.toHaveBeenCalled();
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/meetings/m1/motions/mo1/ballot");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ choice: "NO" });

    release(json({ status: "ok" }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(keysCalled(invalidate)).toEqual(expect.arrayContaining([motionsKey, activityKey]));
  });

  it("still refreshes after already_voted so the card shows the vote that counted", async () => {
    const qc = newClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ error: { code: "already_voted", message: "bạn đã bỏ phiếu cho nội dung này" } }, 409),
    );
    const { result } = renderHook(() => useCastBallot("m1"), { wrapper: wrapperFor(qc) });
    await act(async () => {
      await expect(result.current.mutateAsync({ motionId: "mo1", choice: "YES" })).rejects.toMatchObject({
        code: "already_voted",
        status: 409,
      });
    });
    expect(keysCalled(invalidate)).toEqual(expect.arrayContaining([motionsKey, activityKey]));
  });
});

describe("useUpdateMotion", () => {
  it("sends only the fields given, so a reorder is just a position", async () => {
    const qc = newClient();
    vi.mocked(fetch).mockResolvedValueOnce(json({ motion: { ...open, id: "mo2", status: "DRAFT", position: 1 } }));
    const { result } = renderHook(() => useUpdateMotion("m1"), { wrapper: wrapperFor(qc) });
    await act(async () => {
      await result.current.mutateAsync({ motionId: "mo2", position: 1 });
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/meetings/m1/motions/mo2");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ position: 1 });
    expect(result.current.data?.position).toBe(1);
  });
});

describe("useEndMeeting", () => {
  it("refreshes the motions an end closes and counts", async () => {
    const qc = newClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        meeting: {
          id: "m1", workspace_id: "ws1", title: "Sync", description: "",
          starts_at: "2026-10-01T02:00:00Z", ends_at: "2026-10-01T03:00:00Z",
          room_name: "room-m1", created_by: "u1", status: "ENDED",
        },
      }),
    );
    const { result } = renderHook(() => useEndMeeting("ws1"), { wrapper: wrapperFor(qc) });
    await act(async () => {
      await result.current.mutateAsync("m1");
    });
    expect(keysCalled(invalidate)).toContain(motionsKey);
  });
});

const urlOf = (input: unknown) => String(input);

describe("useMeetingMotions — one list for everyone, the caller's roll joined in", () => {
  it("reads the list and the caller's ballots and joins them as my_ballot", async () => {
    vi.mocked(fetch).mockImplementation(async (input) =>
      urlOf(input).endsWith("/my-ballots")
        ? json({ ballots: [{ motion_id: "mo1", cast: false, choice: null }] })
        : json({ motions: [open, { ...open, id: "mo2", status: "CLOSED" }] }),
    );
    const qc = newClient();
    const { result } = renderHook(() => useMeetingMotions("m1"), { wrapper: wrapperFor(qc) });
    await waitFor(() => expect(result.current.data?.[0]?.my_ballot).toBeDefined());
    expect(result.current.data?.map((m) => m.my_ballot)).toEqual([
      { on_roll: true, cast: false, choice: null },
      { on_roll: false, cast: false, choice: null },
    ]);
    const urls = vi.mocked(fetch).mock.calls.map(([input]) => urlOf(input));
    expect(urls).toEqual(
      expect.arrayContaining([
        "http://api.test/api/v1/meetings/m1/motions",
        "http://api.test/api/v1/meetings/m1/my-ballots",
      ]),
    );
    // The cache holds the shared list as the server sent it.
    expect(qc.getQueryData<MeetingMotion[]>(motionKeys.list("m1"))?.[0]?.my_ballot).toBeUndefined();
  });

  it("keeps the list usable when the roll cannot be read", async () => {
    vi.mocked(fetch).mockImplementation(async (input) =>
      urlOf(input).endsWith("/my-ballots")
        ? json({ error: { code: "not_found", message: "x" } }, 404)
        : json({ motions: [open] }),
    );
    const qc = newClient();
    const { result } = renderHook(() => useMeetingMotions("m1"), { wrapper: wrapperFor(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((m) => m.id)).toEqual(["mo1"]);
  });

  it("keys the list and the roll under the meeting's motions, and voters outside it", () => {
    const prefix = JSON.stringify(meetingKeys.motions("m1")).slice(0, -1);
    expect(JSON.stringify(motionKeys.list("m1")).startsWith(prefix)).toBe(true);
    expect(JSON.stringify(motionKeys.myBallots("m1")).startsWith(prefix)).toBe(true);
    expect(JSON.stringify(motionKeys.voters("m1", "mo1")).startsWith(prefix)).toBe(false);
    expect(motionKeys.list("m1")).not.toEqual(motionKeys.myBallots("m1"));
  });
});

describe("useMotionVoters — loaded only when someone opens the result", () => {
  it("does not fetch while folded, then fetches once", async () => {
    vi.mocked(fetch).mockResolvedValue(json({ motion_id: "mo1", voters: { yes: ["An"], no: [], abstain: [] } }));
    const qc = newClient();
    const { result, rerender } = renderHook(({ on }: { on: boolean }) => useMotionVoters("m1", "mo1", on), {
      wrapper: wrapperFor(qc),
      initialProps: { on: false },
    });
    expect(fetch).not.toHaveBeenCalled();
    rerender({ on: true });
    await waitFor(() => expect(result.current.data?.yes).toEqual(["An"]));
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe("http://api.test/api/v1/meetings/m1/motions/mo1/voters");
    rerender({ on: false });
    rerender({ on: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
