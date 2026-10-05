import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { GUEST_SESSION_HEADER, setGuestSession } from "../guest-session";
import { setAccessToken } from "../session";
import {
  castMeetingBallot,
  closeMeetingMotion,
  createMeetingMotion,
  deleteMeetingMotion,
  getMotionVoters,
  listMeetingMotions,
  listMyMotionBallots,
  openMeetingMotion,
  updateMeetingMotion,
} from "./meeting-motions";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const closed = {
  id: "mo1",
  title: "Thông qua kế hoạch quý IV",
  description: "",
  position: 1,
  ballot_mode: "PUBLIC",
  threshold: "MAJORITY",
  base: "PRESENT",
  status: "CLOSED",
  opened_at: "2026-10-01T02:00:00Z",
  closed_at: "2026-10-01T02:05:00Z",
  roll_size: 3,
  total_members: 4,
  cast_count: 3,
  result: { yes: 2, no: 1, abstain: 0, required: 2, outcome: "PASSED" },
};

const draft = {
  id: "mo2",
  title: "Bầu thư ký",
  description: "Nhiệm kỳ một năm",
  position: 2,
  ballot_mode: "SECRET",
  threshold: "TWO_THIRDS",
  base: "ALL_MEMBERS",
  status: "DRAFT",
  roll_size: null,
  total_members: null,
  cast_count: 0,
  result: null,
};

const base = "http://api.test/api/v1/meetings/m1/motions";

describe("meeting motion endpoints", () => {
  beforeEach(() => {
    setAccessToken("tok");
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
    setGuestSession(null);
  });

  it("listMeetingMotions parses closed and draft items, nulls included", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ motions: [closed, draft] }));
    const got = await listMeetingMotions("m1");
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe(base);
    expect(got).toHaveLength(2);
    expect(got[0]?.result).toEqual({ yes: 2, no: 1, abstain: 0, required: 2, outcome: "PASSED" });
    expect(got[1]?.result).toBeNull();
    expect(got[1]?.roll_size).toBeNull();
  });

  it("listMyMotionBallots reads the caller's roll, choice only on a cast public ballot", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        ballots: [
          { motion_id: "mo1", cast: true, choice: "YES" },
          { motion_id: "mo3", cast: true, choice: null },
          { motion_id: "mo4", cast: false },
        ],
      }),
    );
    const got = await listMyMotionBallots("m1");
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe("http://api.test/api/v1/meetings/m1/my-ballots");
    expect(got).toEqual([
      { motion_id: "mo1", cast: true, choice: "YES" },
      { motion_id: "mo3", cast: true, choice: null },
      { motion_id: "mo4", cast: false },
    ]);
  });

  it("listMyMotionBallots degrades to null on drift instead of inventing a roll", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ ballots: [{ motion_id: 1, cast: "yes" }] }))
      .mockResolvedValueOnce(json({ nope: true }))
      .mockResolvedValueOnce(json("garbage"));
    await expect(listMyMotionBallots("m1")).resolves.toBeNull();
    await expect(listMyMotionBallots("m1")).resolves.toBeNull();
    await expect(listMyMotionBallots("m1")).resolves.toBeNull();
  });

  it("getMotionVoters reads one motion's names, null while there are none to show", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ motion_id: "mo1", voters: { yes: ["An", "Bình"], no: ["Chi"], abstain: [] } }))
      .mockResolvedValueOnce(json({ motion_id: "mo1", voters: null }));
    expect(await getMotionVoters("m1", "mo1")).toEqual({ yes: ["An", "Bình"], no: ["Chi"], abstain: [] });
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe(`${base}/mo1/voters`);
    await expect(getMotionVoters("m1", "mo1")).resolves.toBeNull();
  });

  it("getMotionVoters degrades to null on drift", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ voters: { yes: "An" } }))
      .mockResolvedValueOnce(json([1, 2]));
    await expect(getMotionVoters("m1", "mo1")).resolves.toBeNull();
    await expect(getMotionVoters("m1", "mo1")).resolves.toBeNull();
  });

  it("listMeetingMotions throws on drift instead of hiding an open vote", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ motions: [{ id: 1 }] }))
      .mockResolvedValueOnce(json({ nope: true }));
    await expect(listMeetingMotions("m1")).rejects.toThrow("meeting_motions_invalid");
    await expect(listMeetingMotions("m1")).rejects.toThrow("meeting_motions_invalid");
  });

  it("createMeetingMotion posts the draft and returns it, or null on drift", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ motion: draft }))
      .mockResolvedValueOnce(json({ motion: { id: 7 } }));
    const body = {
      title: "Bầu thư ký",
      description: "Nhiệm kỳ một năm",
      ballot_mode: "SECRET",
      threshold: "TWO_THIRDS",
      base: "ALL_MEMBERS",
    } as const;
    expect((await createMeetingMotion("m1", body))?.id).toBe("mo2");
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe(base);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(body);
    await expect(createMeetingMotion("m1", body)).resolves.toBeNull();
  });

  it("updateMeetingMotion patches only the fields given, or returns null on drift", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ motion: { ...draft, position: 1 } }))
      .mockResolvedValueOnce(json("garbage"));
    expect((await updateMeetingMotion("m1", "mo2", { position: 1 }))?.position).toBe(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe(`${base}/mo2`);
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ position: 1 });
    await expect(updateMeetingMotion("m1", "mo2", { title: "x" })).resolves.toBeNull();
  });

  it("commands with nothing to read resolve whatever the server sends back", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ status: "ok" }))
      .mockResolvedValueOnce(json("garbage"))
      .mockResolvedValueOnce(json({ motion: { id: 1 } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(deleteMeetingMotion("m1", "mo2")).resolves.toBeUndefined();
    await expect(openMeetingMotion("m1", "mo2")).resolves.toBeUndefined();
    await expect(closeMeetingMotion("m1", "mo2")).resolves.toBeUndefined();
    await expect(castMeetingBallot("m1", "mo2", "ABSTAIN")).resolves.toBeUndefined();
    const calls = vi.mocked(fetch).mock.calls.map(([url, init]) => [String(url), init?.method, init?.body]);
    expect(calls).toEqual([
      [`${base}/mo2`, "DELETE", undefined],
      [`${base}/mo2/open`, "POST", undefined],
      [`${base}/mo2/close`, "POST", undefined],
      [`${base}/mo2/ballot`, "POST", JSON.stringify({ choice: "ABSTAIN" })],
    ]);
  });

  it("castMeetingBallot surfaces the server's refusal code", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ error: { code: "not_on_roll", message: "bạn không thuộc danh sách bỏ phiếu" } }, 403),
    );
    await expect(castMeetingBallot("m1", "mo1", "YES")).rejects.toMatchObject({ code: "not_on_roll", status: 403 });
  });

  it("a guest reads and votes with the guest session, never a bearer token", async () => {
    setAccessToken(null);
    setGuestSession("g.sig");
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ motions: [] }))
      .mockResolvedValueOnce(json({ ballots: [] }))
      .mockResolvedValueOnce(json({ motion_id: "mo1", voters: null }))
      .mockResolvedValueOnce(json({ status: "ok" }));
    expect(await listMeetingMotions("m1")).toEqual([]);
    expect(await listMyMotionBallots("m1")).toEqual([]);
    expect(await getMotionVoters("m1", "mo1")).toBeNull();
    await castMeetingBallot("m1", "mo1", "YES");
    expect(vi.mocked(fetch).mock.calls).toHaveLength(4);
    for (const [, init] of vi.mocked(fetch).mock.calls) {
      const headers = init?.headers as Record<string, string>;
      expect(headers[GUEST_SESSION_HEADER]).toBe("g.sig");
      expect(headers.Authorization).toBeUndefined();
    }
  });
});
