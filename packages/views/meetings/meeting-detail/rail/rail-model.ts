/**
 * Pure rules of the meeting rail (kit `.rail`): the RSVP and roll tallies its
 * rows print, and which groups a status and a viewer get. The words come
 * from `t` (keys under `meetings.detail.rail`).
 */
import type { DetailStatus, DetailViewer } from "../detail-model";

type Translate = (key: string, options?: Record<string, unknown>) => string;

export type Rsvp = "yes" | "maybe" | "no" | "wait";

/** An invitation's answer in the rail's four words; anything unknown is not answered yet. */
export function rsvpOf(responseStatus: string | undefined): Rsvp {
  switch (responseStatus) {
    case "ACCEPTED":
      return "yes";
    case "TENTATIVE":
      return "maybe";
    case "DECLINED":
      return "no";
    default:
      return "wait";
  }
}

/** "1 nhận lời · 1 chưa phản hồi": accepted, maybe, declined, waiting, zeros left out. */
export function rsvpTallyText(responses: readonly (string | undefined)[], t: Translate): string {
  const count: Record<Rsvp, number> = { yes: 0, maybe: 0, no: 0, wait: 0 };
  for (const r of responses) count[rsvpOf(r)] += 1;
  return (["yes", "maybe", "no", "wait"] as const)
    .filter((k) => count[k] > 0)
    .map((k) => t(`meetings.detail.rail.rsvp_${k}`, { count: count[k] }))
    .join(" · ");
}

type RollSummary = { members: number; present: number; late: number; excused: number; absent: number };

/** Live "3 có mặt · 1 muộn · 1 vắng có phép" (zeros left out), as separate parts so each keeps its line. */
export function rollParts(summary: RollSummary, t: Translate): string[] {
  return (["present", "late", "excused", "absent"] as const)
    .filter((k) => summary[k] > 0)
    .map((k) => t(`meetings.detail.rail.roll_${k}`, { count: summary[k] }));
}

/** Ended "3/3 có mặt": everyone who came (late included) over the members of the roll. */
export function attendedText(summary: RollSummary, t: Translate): string {
  return t("meetings.detail.rail.attended", { came: summary.present + summary.late, total: summary.members });
}

export const isLive = (status: DetailStatus) => status === "IN_PROGRESS" || status === "OVERTIME";

/**
 * "Lịch sử thao tác ›" in the rail: never while live (the live rail carries
 * the carried-over line instead) nor for an outsider; before the meeting only
 * for whoever runs it. Everyone else reaches it from the header's ⋯.
 */
export function showsHistoryLink(status: DetailStatus, viewer: DetailViewer, isClerk: boolean): boolean {
  if (viewer === "outsider" || isLive(status)) return false;
  return status !== "SCHEDULED" || isClerk;
}
