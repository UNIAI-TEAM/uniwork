import { describe, expect, it } from "vitest";
import type { SpeakerLabel } from "@uniwork/core/types";
import { sameSpeakerCandidates } from "./speaker-label-merge";

const label = (id: string, key: string, number: number, assigned = ""): SpeakerLabel => ({
  id,
  label_key: key,
  number,
  ...(assigned ? { name: assigned, assigned_name: assigned } : {}),
});

describe("sameSpeakerCandidates", () => {
  const rows = [
    label("a1", "uw_participant_p1:AJ_1-TR_a-1:A", 1, "Lan"),
    label("b1", "uw_participant_p1:AJ_1-TR_a-1:B", 2, "Minh"),
    label("a2", "uw_participant_p1:AJ_1-TR_a-2:A", 3),
    label("a4", "uw_participant_p1:AJ_1-TR_a-4:A", 4, "Hoa"),
    label("x1", "uw_participant_p2:AJ_1-TR_b-1:A", 5, "Other room"),
    label("u1", "upload:T1:A", 6, "File"),
  ];

  it("offers the named speakers of the same mic, the adjacent session's same letter first", () => {
    const target = rows[2];
    expect(sameSpeakerCandidates(target!, rows).map((l) => l.id)).toEqual(["a1", "b1", "a4"]);
  });

  it("never offers itself, another mic, an unnamed label or an uploaded file's speaker", () => {
    expect(sameSpeakerCandidates(rows[4]!, rows)).toEqual([]);
    expect(sameSpeakerCandidates(rows[5]!, rows)).toEqual([]);
  });
});
