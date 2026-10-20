import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import { assignSpeakerLabel, getSpeakerLabels, setParticipantSharedMic } from "./meeting-speaker-labels";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const label = {
  id: "l1",
  label_key: "uw_participant_p1:AJ_1-TR_a-1:A",
  speaker: "A",
  assigned_name: "Chị Lan",
  name: "Chị Lan",
  sample: "Chốt ship thứ Sáu",
  first_spoken_at: "2026-10-20T02:00:01Z",
};

describe("meeting speaker label endpoints", () => {
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

  it("setParticipantSharedMic puts enabled and returns the participant, or null on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ participant: { id: "p1", meeting_id: "m1", principal_type: "USER", role: "ATTENDEE", status: "ACTIVE", shared_mic: true } }),
    );
    const p = await setParticipantSharedMic("m1", "p1", true);
    expect(p?.shared_mic).toBe(true);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/meetings/m1/participants/p1/shared-mic");
    expect(init!.method).toBe("PUT");
    expect(JSON.parse(init!.body as string)).toEqual({ enabled: true });
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await setParticipantSharedMic("m1", "p1", false)).toBeNull();
  });

  it("getSpeakerLabels reads the labels and degrades to an empty list on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ labels: [label, { id: "l2", label_key: "k:1:B", speaker: "B" }] }));
    const got = await getSpeakerLabels("m1");
    expect(got.map((l) => [l.id, l.assigned_name ?? ""])).toEqual([
      ["l1", "Chị Lan"],
      ["l2", ""],
    ]);
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe("http://api.test/api/v1/meetings/m1/speaker-labels");
    vi.mocked(fetch).mockResolvedValueOnce(json({ labels: "nope" }));
    expect(await getSpeakerLabels("m1")).toEqual([]);
  });

  it("assignSpeakerLabel sends user_id or name and returns the label, or null on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ label }));
    expect((await assignSpeakerLabel("m1", "l1", { name: "Chị Lan" }))?.assigned_name).toBe("Chị Lan");
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/meetings/m1/speaker-labels/l1");
    expect(init!.method).toBe("PUT");
    expect(JSON.parse(init!.body as string)).toEqual({ name: "Chị Lan" });
    vi.mocked(fetch).mockResolvedValueOnce(json({ label: { id: 3 } }));
    expect(await assignSpeakerLabel("m1", "l1", { user_id: "u1" })).toBeNull();
  });
});
