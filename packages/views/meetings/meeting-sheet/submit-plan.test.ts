import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import type { Meeting } from "@uniwork/core/types/meeting";
import { emptyDraft, newGuestLink, newMotion, type MeetingDraft } from "./draft-model";
import {
  getRun,
  isHttpFailure,
  linksPending,
  retryRows,
  runProgress,
  runRows,
  startSubmitRun,
  type SetupApiShape,
} from "./run-submit-plan";
import { buildCreatePlan, buildEditPlan, planGroups, planRows } from "./submit-plan";

const NOW = Date.parse("2026-10-23T14:18:00Z");
const HCM = "Asia/Ho_Chi_Minh";
const ctx = { scribeDefault: true, scribeOffered: true, defaultLinkName: "Liên kết 21:18 23/10/26" };

function fullDraft(): MeetingDraft {
  return {
    ...emptyDraft(NOW, HCM),
    title: "Duyệt kịch bản",
    date: "2026-10-24",
    start: "14:00",
    end: "15:00",
    people: [
      { userId: "ha", role: "SECRETARY" },
      { userId: "minh", role: "MEMBER" },
    ],
    links: [{ ...newGuestLink(), name: "Agency Ánh Dương", maxUses: "5" }],
    motions: [{ ...newMotion(), title: "Duyệt kịch bản chương trình ngày 15/11" }],
  };
}

describe("buildCreatePlan", () => {
  it("creates with no attendees, then invites, roles, motions and links: 4 groups", () => {
    const plan = buildCreatePlan(fullDraft(), ctx);
    expect(plan.create).toMatchObject({ attendee_user_ids: [], starts_at: "2026-10-24T07:00:00.000Z", timezone: HCM });
    expect(planRows(plan)).toEqual(["people", "roles", "motions", expect.stringMatching(/^link:/)]);
    expect(planGroups(plan)).toEqual(["people", "roles", "motions", "links"]);
  });

  it("skips the scribe call when the switch matches the policy, and sends a blank link's default name", () => {
    const d = { ...fullDraft(), scribe: false, aiShared: true, links: [newGuestLink()] };
    const plan = buildCreatePlan(d, ctx);
    expect(plan.steps.filter((s) => s.kind === "scribe")).toEqual([{ row: "scribe", kind: "scribe", enabled: false }]);
    expect(plan.steps.some((s) => s.kind === "sharing")).toBe(false);
    expect(plan.steps.find((s) => s.kind === "link")).toMatchObject({ name: "Liên kết 21:18 23/10/26" });
    expect(buildCreatePlan({ ...d, scribe: true }, ctx).steps.some((s) => s.kind === "scribe")).toBe(false);
  });

  it("creates no guest link for an in-person draft", () => {
    const plan = buildCreatePlan({ ...fullDraft(), venue: "in_person" }, ctx);
    expect(plan.steps.some((s) => s.kind === "link")).toBe(false);
    const snap: MeetingDraft = { ...fullDraft(), links: [], motions: [], venue: "in_person" };
    const edit = buildEditPlan({ id: "m3" }, { ...snap, links: [newGuestLink()] }, snap, { ...ctx, timeLocked: false });
    expect(edit.steps.some((s) => s.kind === "link")).toBe(false);
  });

  it("sends the venue", () => {
    expect(buildCreatePlan(fullDraft(), ctx).create?.venue).toBe("online");
    expect(buildCreatePlan({ ...fullDraft(), venue: "in_person" }, ctx).create?.venue).toBe("in_person");
  });
});

describe("buildEditPlan · venue", () => {
  // The server refuses any venue on a live meeting, even an unchanged one: send it only when it changed.
  it("patches the venue only when it changed", () => {
    const snap: MeetingDraft = { ...fullDraft(), links: [], motions: [], venue: "in_person" };
    expect(buildEditPlan({ id: "m3" }, { ...snap, title: "Mới" }, snap, { ...ctx, timeLocked: true }).patch).toEqual({ title: "Mới" });
    expect(buildEditPlan({ id: "m3" }, { ...snap, venue: "online" }, snap, { ...ctx, timeLocked: false }).patch).toEqual({ venue: "online" });
  });
});

describe("buildEditPlan", () => {
  it("patches only what changed and assigns the new secretary before clearing the old", () => {
    const snap: MeetingDraft = {
      ...fullDraft(),
      links: [],
      motions: [{ ...newMotion(), id: "mo1", status: "OPEN", title: "Open", position: 1 }],
      people: [
        { userId: "ha", role: "SECRETARY", participantId: "p-ha" },
        { userId: "minh", role: "MEMBER", participantId: "p-minh" },
        { userId: "bao", role: "MEMBER", participantId: "p-bao" },
      ],
    };
    const next: MeetingDraft = {
      ...snap,
      title: "Mới",
      people: [
        { userId: "ha", role: "MEMBER", participantId: "p-ha" },
        { userId: "minh", role: "SECRETARY", participantId: "p-minh" },
        { userId: "tuan", role: "MEMBER" },
      ],
    };
    const plan = buildEditPlan({ id: "m3" }, next, snap, { ...ctx, timeLocked: false });
    expect(plan.patch).toEqual({ title: "Mới" });
    const roles = plan.steps.filter((s) => s.kind === "role");
    expect(roles.map((s) => s.kind === "role" && s.userId)).toEqual(["minh", "ha"]);
    expect(plan.steps.filter((s) => s.kind === "invite" || s.kind === "remove").map((s) => s.kind)).toEqual(["invite", "remove"]);
  });

  it("never moves a motion already open or closed: the server refuses it", () => {
    const closed = { ...newMotion(), id: "mo-a", status: "CLOSED" as const, title: "A", position: 1 };
    const b = { ...newMotion(), id: "mo-b", status: "DRAFT" as const, title: "B", position: 2 };
    const c = { ...newMotion(), id: "mo-c", status: "DRAFT" as const, title: "C", position: 3 };
    const snap: MeetingDraft = { ...fullDraft(), links: [], motions: [closed, b, c] };
    const plan = buildEditPlan({ id: "m3" }, { ...snap, motions: [b, closed, c] }, snap, { ...ctx, timeLocked: false });
    expect(plan.steps.filter((s) => s.kind === "motionUpdate")).toEqual([]);
    const swapped = buildEditPlan({ id: "m3" }, { ...snap, motions: [closed, c, b] }, snap, { ...ctx, timeLocked: false });
    expect(swapped.steps.filter((s) => s.kind === "motionUpdate").map((s) => s.kind === "motionUpdate" && [s.motionId, s.patch])).toEqual([
      ["mo-c", { position: 2 }],
      ["mo-b", { position: 3 }],
    ]);
  });
});

function fakeApi(over: Record<string, unknown> = {}): SetupApiShape {
  const meeting = { id: "new1", scribe_enabled: true } as Meeting;
  return {
    createMeeting: vi.fn(async () => meeting),
    updateMeeting: vi.fn(async () => meeting),
    inviteParticipant: vi.fn(async (_m: string, userId: string) => ({ participant: { id: `p-${userId}` } })),
    removeParticipant: vi.fn(async () => {}),
    setMeetingScribe: vi.fn(async () => meeting),
    setMeetingAISharing: vi.fn(async () => meeting),
    createInviteLink: vi.fn(async () => ({ invite_link: { id: "l1", secret: "s3cret" } })),
    updateMeetingParticipant: vi.fn(async () => null),
    createMeetingMotion: vi.fn(async () => null),
    updateMeetingMotion: vi.fn(async () => null),
    deleteMeetingMotion: vi.fn(async () => {}),
    ...over,
  } as unknown as SetupApiShape;
}

function run(api: SetupApiShape, draft = fullDraft()) {
  return new Promise<string>((resolve) => {
    const id = startSubmitRun(buildCreatePlan(draft, ctx), {
      api,
      workspaceId: "w1",
      idempotencyKey: "k1",
      now: () => NOW,
      invalidate: () => {},
      onDone: () => resolve(id),
    });
  });
}

describe("run-submit-plan", () => {
  it("runs links last, keeps the secret and counts groups", async () => {
    const order: string[] = [];
    const api = fakeApi({
      inviteParticipant: vi.fn(async (_m: string, u: string) => (order.push(`invite:${u}`), { participant: { id: `p-${u}` } })),
      updateMeetingParticipant: vi.fn(async (_m: string, pid: string) => (order.push(`role:${pid}`), null)),
      createMeetingMotion: vi.fn(async () => (order.push("motion"), null)),
      createInviteLink: vi.fn(async () => (order.push("link"), { invite_link: { id: "l1", secret: "s" } })),
    });
    const id = await run(api);
    expect(order).toEqual(["invite:ha", "invite:minh", "role:p-ha", "motion", "link"]);
    const r = getRun(id)!;
    expect(api.createMeeting).toHaveBeenCalledWith("w1", expect.objectContaining({ attendee_user_ids: [] }), { idempotencyKey: "k1" });
    expect(runProgress(r)).toEqual({ done: 4, total: 4 });
    expect(runRows(r).at(-1)?.steps[0]?.state.link).toEqual({ id: "l1", secret: "s" });
    expect(linksPending(r)).toBe(false);
  });

  it("reports a failed link as a row, and a retry flips it", async () => {
    let fail = true;
    const api = fakeApi({
      createInviteLink: vi.fn(async () => {
        if (fail) throw new TypeError("Failed to fetch");
        return { invite_link: { id: "l1", secret: "s" } };
      }),
    });
    const id = await run(api);
    const linkRow = runRows(getRun(id)!).at(-1)!;
    expect(linkRow.status).toBe("failed");
    fail = false;
    await retryRows(id, [linkRow.key]);
    expect(runRows(getRun(id)!).every((row) => row.status === "ok")).toBe(true);
  });

  it("marks a role waiting on a failed invitation and retries it with the invitation", async () => {
    let fail = true;
    const api = fakeApi({
      inviteParticipant: vi.fn(async (_m: string, u: string) => {
        if (fail && u === "ha") throw new ApiError("removed", "participant_removed", 409);
        return { participant: { id: `p-${u}` } };
      }),
    });
    const id = await run(api);
    const roles = runRows(getRun(id)!).find((r) => r.key === "roles")!;
    expect(roles.steps[0]?.state).toMatchObject({ status: "failed", waiting: true });
    fail = false;
    await retryRows(id, ["people"]);
    expect(runRows(getRun(id)!).find((r) => r.key === "roles")?.status).toBe("ok");
  });

  it("tells a server refusal from an unknown outcome, and a resubmit sends the same key", async () => {
    const refused = await run(fakeApi({ createMeeting: vi.fn(async () => Promise.reject(new ApiError("bad", "invalid", 400))) }));
    expect(isHttpFailure(getRun(refused)!.phase1Error)).toBe(true);
    let attempts = 0;
    const flaky = fakeApi({
      createMeeting: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) throw new TypeError("Failed to fetch");
        return { id: "new1" } as Meeting;
      }),
    });
    const id = await run(flaky, { ...fullDraft(), people: [], links: [], motions: [] });
    expect(isHttpFailure(getRun(id)!.phase1Error)).toBe(false);
    // The sheet resubmits as a fresh run under the sheet's one key: a replay returns the first meeting, never a second.
    const again = await run(flaky, { ...fullDraft(), people: [], links: [], motions: [] });
    expect(getRun(again)!.phase).toBe("done");
    expect(flaky.createMeeting).toHaveBeenLastCalledWith("w1", expect.anything(), { idempotencyKey: "k1" });
  });

  it("marks a slow create after 10 seconds", async () => {
    vi.useFakeTimers();
    try {
      let resolve: (m: Meeting) => void = () => {};
      const api = fakeApi({ createMeeting: vi.fn(() => new Promise<Meeting>((r) => (resolve = r))) });
      const id = startSubmitRun(buildCreatePlan({ ...fullDraft(), people: [], links: [], motions: [] }, ctx), {
        api,
        workspaceId: "w1",
        idempotencyKey: "k2",
        invalidate: () => {},
      });
      await vi.advanceTimersByTimeAsync(10_001);
      expect(getRun(id)!.slow).toBe(true);
      resolve({ id: "x" } as Meeting);
      await vi.advanceTimersByTimeAsync(0);
      expect(getRun(id)!.slow).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
