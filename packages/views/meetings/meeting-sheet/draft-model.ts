import type {
  BallotMode,
  Meeting,
  MeetingMotion,
  MeetingParticipant,
  MotionBase,
  MotionThreshold,
} from "@uniwork/core/types/meeting";
import { meetingVenue, type MeetingVenue } from "@uniwork/core/meetings/venue";
import { splitIsoLocal } from "../meeting-datetime";

/**
 * The meeting sheet's one draft (create, follow-up, edit): plain values the
 * form edits, compared to the snapshot taken at open to tell dirty from clean
 * and to count "N thay đổi". Pure, so the rules are tested without React.
 */

export type DraftRole = "MEMBER" | "SECRETARY" | "OBSERVER";
export type DraftPerson = { userId: string; role: DraftRole; participantId?: string };
export type LinkAccess = "REQUEST_APPROVAL" | "AUTO_ADMIT";
export type LinkDays = "1" | "7" | "30";
export type GuestLinkDraft = { key: string; name: string; access: LinkAccess; days: LinkDays; maxUses: string };
export type MotionDraft = {
  key: string;
  /** Set for a motion that exists (edit); its server status locks OPEN / CLOSED rows. */
  id?: string;
  status?: string;
  position?: number;
  title: string;
  description: string;
  ballot_mode: BallotMode;
  threshold: MotionThreshold;
  base: MotionBase;
};

export type MeetingDraft = {
  title: string;
  venue: MeetingVenue;
  description: string;
  /** Wall date "YYYY-MM-DD" and "HH:MM" times in `timezone`. */
  date: string;
  start: string;
  end: string;
  timezone: string;
  /** Everyone invited but the host, who is the creator (create) or the meeting's host (edit). */
  people: DraftPerson[];
  /** "" = no project. */
  projectId: string;
  allowJoin: boolean;
  /** null follows the organization's policy (create only). */
  scribe: boolean | null;
  aiShared: boolean;
  /** New guest links (edit lists the existing ones read-only beside them). */
  links: GuestLinkDraft[];
  motions: MotionDraft[];
  /** Typed text: "" = no minimum. */
  quorum: string;
};

let keySeq = 0;
/** A local key for a draft row (React key and field id); never sent. */
export function draftKey(prefix: string): string {
  keySeq += 1;
  return `${prefix}${keySeq}`;
}

/** The new guest links the draft would create: none in person, which has no room (spec D4); kept for a switch back to Online. */
export function draftLinks(draft: Pick<MeetingDraft, "venue" | "links">): GuestLinkDraft[] {
  return draft.venue === "in_person" ? [] : draft.links;
}

export function newGuestLink(): GuestLinkDraft {
  return { key: draftKey("l"), name: "", access: "REQUEST_APPROVAL", days: "7", maxUses: "" };
}

export function newMotion(): MotionDraft {
  return {
    key: draftKey("m"),
    title: "",
    description: "",
    ballot_mode: "PUBLIC",
    threshold: "MAJORITY",
    base: "PRESENT",
  };
}

const HOUR = 60 * 60 * 1000;

/** The untouched create default: the next full hour, 30 minutes (22:00–22:30 at 21:18). */
export function defaultWindow(nowMs: number, timezone: string): { date: string; start: string; end: string } {
  // shortcut: whole-hour steps in UTC equal the zone's whole hours only for whole-hour offsets; fine for the 7 zones offered.
  const startMs = Math.floor(nowMs / HOUR) * HOUR + HOUR;
  const from = splitIsoLocal(new Date(startMs).toISOString(), timezone);
  const to = splitIsoLocal(new Date(startMs + 30 * 60 * 1000).toISOString(), timezone);
  return { date: from.date, start: from.time, end: to.time };
}

const ZONE_ALIASES: Record<string, string> = { "Asia/Saigon": "Asia/Ho_Chi_Minh", "Etc/UTC": "UTC" };

/** The listed name of a zone the browser reports under an old alias (Chromium says Asia/Saigon). */
export function canonicalZone(timezone: string): string {
  return ZONE_ALIASES[timezone] ?? timezone;
}

export function emptyDraft(nowMs: number, zone: string): MeetingDraft {
  const timezone = canonicalZone(zone);
  return {
    title: "",
    venue: "online",
    description: "",
    ...defaultWindow(nowMs, timezone),
    timezone,
    people: [],
    projectId: "",
    allowJoin: true,
    scribe: null,
    aiShared: false,
    links: [],
    motions: [],
    quorum: "",
  };
}

export function roleOf(p: Pick<MeetingParticipant, "is_secretary" | "standing">): DraftRole {
  if (p.is_secretary) return "SECRETARY";
  return p.standing === "OBSERVER" ? "OBSERVER" : "MEMBER";
}

/** The people row of an existing meeting: active accounts, the host aside. */
export function peopleOf(participants: readonly MeetingParticipant[], hostUserId: string | undefined): DraftPerson[] {
  const seen = new Set<string>();
  const out: DraftPerson[] = [];
  for (const p of participants) {
    if (p.status !== "ACTIVE" || !p.user_id || p.user_id === hostUserId || seen.has(p.user_id)) continue;
    seen.add(p.user_id);
    out.push({ userId: p.user_id, role: roleOf(p), participantId: p.id });
  }
  return out;
}

export function motionDraftOf(m: MeetingMotion): MotionDraft {
  return {
    key: `id:${m.id}`,
    id: m.id,
    status: m.status,
    position: m.position,
    title: m.title,
    description: m.description ?? "",
    ballot_mode: m.ballot_mode === "SECRET" ? "SECRET" : "PUBLIC",
    threshold: m.threshold === "TWO_THIRDS" ? "TWO_THIRDS" : "MAJORITY",
    base: m.base === "ALL_MEMBERS" ? "ALL_MEMBERS" : "PRESENT",
  };
}

/** The edit draft, typed in the meeting's own zone so 09:00 Tokyo stays 09:00 whoever opens it. */
export function draftFromMeeting(
  meeting: Meeting,
  participants: readonly MeetingParticipant[],
  motions: readonly MeetingMotion[],
  fallbackZone: string,
): MeetingDraft {
  const timezone = canonicalZone(meeting.timezone || fallbackZone);
  const from = splitIsoLocal(meeting.starts_at, timezone);
  const to = splitIsoLocal(meeting.ends_at, timezone);
  return {
    title: meeting.title,
    venue: meetingVenue(meeting),
    description: meeting.description ?? "",
    date: from.date,
    start: from.time,
    end: to.time,
    timezone,
    people: peopleOf(participants, meeting.host_user_id),
    projectId: meeting.project_id ?? "",
    allowJoin: meeting.allow_join_request !== false,
    scribe: meeting.scribe_enabled !== false,
    aiShared: meeting.ai_content_shared === true,
    links: [],
    motions: [...motions].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map(motionDraftOf),
    quorum: meeting.quorum_percent ? String(meeting.quorum_percent) : "",
  };
}

const MOTION_FIELDS = ["title", "description", "ballot_mode", "threshold", "base"] as const;

function motionChanged(a: MotionDraft, b: MotionDraft): boolean {
  return MOTION_FIELDS.some((f) => (typeof a[f] === "string" ? a[f].trim() : a[f]) !== (typeof b[f] === "string" ? b[f].trim() : b[f]));
}

const SCALARS = ["title", "venue", "description", "date", "start", "end", "timezone", "projectId", "allowJoin", "scribe", "aiShared", "quorum"] as const;

function same(a: unknown, b: unknown): boolean {
  return (typeof a === "string" && typeof b === "string" ? a.trim() === b.trim() : a === b);
}

/**
 * What changed since the snapshot, one entry per thing the person did: a
 * field, a person added / removed / given another role, a new link, a motion
 * added / edited / removed / moved. Change-then-revert counts nothing.
 */
export function draftChanges(draft: MeetingDraft, snapshot: MeetingDraft): string[] {
  const out: string[] = SCALARS.filter((k) => !same(draft[k], snapshot[k]));
  const before = new Map(snapshot.people.map((p) => [p.userId, p.role]));
  const after = new Map(draft.people.map((p) => [p.userId, p.role]));
  for (const [id, role] of after) {
    if (!before.has(id)) out.push(`person+:${id}`);
    else if (before.get(id) !== role) out.push(`role:${id}`);
  }
  for (const id of before.keys()) if (!after.has(id)) out.push(`person-:${id}`);
  const linkKeys = new Set(snapshot.links.map((l) => l.key));
  for (const l of draftLinks(draft)) if (!linkKeys.has(l.key)) out.push(`link:${l.key}`);
  const oldMotions = new Map(snapshot.motions.map((m, i) => [m.key, { m, i }]));
  const kept = draft.motions.filter((m) => oldMotions.has(m.key));
  for (const m of draft.motions) {
    const prev = oldMotions.get(m.key);
    if (!prev) out.push(`motion+:${m.key}`);
    else if (motionChanged(m, prev.m)) out.push(`motion:${m.key}`);
  }
  for (const key of oldMotions.keys()) if (!draft.motions.some((m) => m.key === key)) out.push(`motion-:${key}`);
  const oldOrder = snapshot.motions.filter((m) => kept.some((k) => k.key === m.key)).map((m) => m.key);
  if (kept.map((m) => m.key).join() !== oldOrder.join()) out.push("motion-order");
  return out;
}

export function isDirty(draft: MeetingDraft, snapshot: MeetingDraft): boolean {
  return draftChanges(draft, snapshot).length > 0;
}

/** The secretary rule (client only): choosing Thư ký for one person takes it from anyone else. */
export function setRole(people: readonly DraftPerson[], userId: string, role: DraftRole): DraftPerson[] {
  return people.map((p) => {
    if (p.userId === userId) return { ...p, role };
    if (role === "SECRETARY" && p.role === "SECRETARY") return { ...p, role: "MEMBER" };
    return p;
  });
}
