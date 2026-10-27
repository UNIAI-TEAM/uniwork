import type { CreateMeetingBody, UpdateMeetingBody } from "@uniwork/core/api/endpoints/meetings";
import type { Meeting } from "@uniwork/core/types/meeting";
import { scheduleWindowIso } from "../meeting-datetime";
import { draftLinks, type DraftRole, type GuestLinkDraft, type MeetingDraft, type MotionDraft } from "./draft-model";
import { parseQuorum } from "./draft-validation";

/**
 * What a submit does, as data (create brief §3.3): phase 1 is the one create
 * (or PATCH) call; phase 2 is the steps, grouped into result rows. The runner
 * executes it, the footer counts its groups ("2/4") and the result panel
 * draws one row per row key — so all three read one source.
 */

export type RowKey = "people" | "scribe" | "sharing" | "roles" | "quorum" | "motions" | `link:${string}`;

type RoleBody = { standing: "MEMBER" | "OBSERVER"; is_secretary: boolean };

export type PlanStep =
  | { row: "people"; kind: "invite"; userId: string }
  | { row: "people"; kind: "remove"; userId: string; participantId: string }
  | { row: "scribe"; kind: "scribe"; enabled: boolean }
  | { row: "sharing"; kind: "sharing"; shared: boolean }
  | { row: "quorum"; kind: "quorum"; value: number }
  | { row: "roles"; kind: "role"; userId: string; role: DraftRole; participantId?: string; body: RoleBody }
  | { row: "motions"; kind: "motionCreate"; motion: MotionDraft }
  | { row: "motions"; kind: "motionUpdate"; motionId: string; patch: Partial<MotionDraft> & { position?: number } }
  | { row: "motions"; kind: "motionDelete"; motionId: string }
  | { row: `link:${string}`; kind: "link"; link: GuestLinkDraft; name: string };

export type SubmitPlan = {
  mode: "create" | "edit";
  /** Phase 1 of create. */
  create?: CreateMeetingBody;
  /** Phase 1 of edit; empty means nothing to PATCH. */
  patch?: UpdateMeetingBody;
  meetingId?: string;
  steps: PlanStep[];
};

const ROW_ORDER: readonly string[] = ["people", "scribe", "sharing", "roles", "quorum", "motions"];

/** The result rows in the order the panel lists them; one row per guest link, last. */
export function planRows(plan: SubmitPlan): RowKey[] {
  const rows = [...new Set(plan.steps.map((s) => s.row))];
  return rows.sort((a, b) => rank(a) - rank(b));
}

function rank(row: string): number {
  const i = ROW_ORDER.indexOf(row);
  return i < 0 ? ROW_ORDER.length : i;
}

/** The footer counter's unit: a row, with every guest link counted as one group. */
export function groupOf(row: RowKey): string {
  return row.startsWith("link:") ? "links" : row;
}

export function planGroups(plan: SubmitPlan): string[] {
  return [...new Set(planRows(plan).map(groupOf))];
}

/** Which phase-2 stage a step runs in: invitations, then settings in parallel, then motions in order, then links. */
export function stageOf(step: PlanStep): 0 | 1 | 2 | 3 {
  switch (step.kind) {
    case "invite":
    case "remove":
      return 0;
    case "motionCreate":
    case "motionUpdate":
    case "motionDelete":
      return 2;
    case "link":
      return 3;
    default:
      return 1;
  }
}

function roleBody(role: DraftRole): RoleBody {
  if (role === "SECRETARY") return { standing: "MEMBER", is_secretary: true };
  return { standing: role === "OBSERVER" ? "OBSERVER" : "MEMBER", is_secretary: false };
}

function motionInput(m: MotionDraft): MotionDraft {
  return { ...m, title: m.title.trim(), description: m.description.trim() };
}

function linkStep(link: GuestLinkDraft, defaultLinkName: string): PlanStep {
  return { row: `link:${link.key}`, kind: "link", link, name: link.name.trim() || defaultLinkName };
}

export type PlanContext = {
  /** The policy's default for the scribe (on → true). */
  scribeDefault: boolean;
  /** Whether the scribe block is offered at all (capability). */
  scribeOffered: boolean;
  previousMeetingId?: string;
  /** "Liên kết 21:18 23/10/26": the name a blank guest link is sent with. */
  defaultLinkName: string;
};

export function buildCreatePlan(draft: MeetingDraft, ctx: PlanContext): SubmitPlan {
  const slot = scheduleWindowIso(draft.date, draft.start, draft.end, draft.timezone);
  const create: CreateMeetingBody = {
    title: draft.title.trim(),
    venue: draft.venue,
    description: draft.description.trim(),
    starts_at: slot.starts_at,
    ends_at: slot.ends_at,
    timezone: draft.timezone,
    allow_join_request: draft.allowJoin,
    // People join through invitations, so each one is notified (brief §3.3 step 2).
    attendee_user_ids: [],
    ...(draft.projectId ? { project_id: draft.projectId } : {}),
    ...(ctx.previousMeetingId ? { previous_meeting_id: ctx.previousMeetingId } : {}),
  };
  const steps: PlanStep[] = draft.people.map((p) => ({ row: "people", kind: "invite", userId: p.userId }));
  const scribe = draft.scribe ?? ctx.scribeDefault;
  if (ctx.scribeOffered && scribe !== ctx.scribeDefault) steps.push({ row: "scribe", kind: "scribe", enabled: scribe });
  if (ctx.scribeOffered && scribe && draft.aiShared) steps.push({ row: "sharing", kind: "sharing", shared: true });
  for (const p of draft.people) {
    if (p.role !== "MEMBER") steps.push({ row: "roles", kind: "role", userId: p.userId, role: p.role, body: roleBody(p.role) });
  }
  const quorum = parseQuorum(draft.quorum).value;
  if (quorum > 0) steps.push({ row: "quorum", kind: "quorum", value: quorum });
  for (const m of draft.motions) steps.push({ row: "motions", kind: "motionCreate", motion: motionInput(m) });
  for (const l of draftLinks(draft)) steps.push(linkStep(l, ctx.defaultLinkName));
  return { mode: "create", create, steps };
}

const MOTION_FIELDS = ["title", "description", "ballot_mode", "threshold", "base"] as const;

export function buildEditPlan(
  meeting: Pick<Meeting, "id">,
  draft: MeetingDraft,
  snapshot: MeetingDraft,
  ctx: PlanContext & { timeLocked: boolean },
): SubmitPlan {
  const patch: UpdateMeetingBody = {};
  if (draft.title.trim() !== snapshot.title.trim()) patch.title = draft.title.trim();
  if (draft.description.trim() !== snapshot.description.trim()) patch.description = draft.description.trim();
  const timeChanged = (["date", "start", "end", "timezone"] as const).some((k) => draft[k] !== snapshot[k]);
  if (timeChanged && !ctx.timeLocked) {
    const slot = scheduleWindowIso(draft.date, draft.start, draft.end, draft.timezone);
    Object.assign(patch, { starts_at: slot.starts_at, ends_at: slot.ends_at, timezone: draft.timezone });
  }
  // Only when changed: the server refuses any venue on a live meeting, even the same one.
  if (draft.venue !== snapshot.venue) patch.venue = draft.venue;
  if (draft.allowJoin !== snapshot.allowJoin) patch.allow_join_request = draft.allowJoin;
  // "" clears the project on update.
  if (draft.projectId !== snapshot.projectId) patch.project_id = draft.projectId;

  const steps: PlanStep[] = [];
  const before = new Map(snapshot.people.map((p) => [p.userId, p]));
  const after = new Set(draft.people.map((p) => p.userId));
  for (const p of draft.people) if (!before.has(p.userId)) steps.push({ row: "people", kind: "invite", userId: p.userId });
  for (const p of snapshot.people) {
    if (!after.has(p.userId) && p.participantId) {
      steps.push({ row: "people", kind: "remove", userId: p.userId, participantId: p.participantId });
    }
  }
  if (draft.scribe !== snapshot.scribe && draft.scribe !== null) steps.push({ row: "scribe", kind: "scribe", enabled: draft.scribe });
  if (draft.aiShared !== snapshot.aiShared) steps.push({ row: "sharing", kind: "sharing", shared: draft.aiShared });
  // A secretary move assigns the new one before clearing the old (AUDIT AB-15): never a meeting without one mid-way.
  const roleSteps: PlanStep[] = [];
  for (const p of draft.people) {
    const prev = before.get(p.userId);
    const role = p.role;
    if (prev ? prev.role === role : role === "MEMBER") continue;
    roleSteps.push({ row: "roles", kind: "role", userId: p.userId, role, participantId: prev?.participantId, body: roleBody(role) });
  }
  roleSteps.sort((a, b) => Number(b.kind === "role" && b.role === "SECRETARY") - Number(a.kind === "role" && a.role === "SECRETARY"));
  steps.push(...roleSteps);
  const quorum = parseQuorum(draft.quorum);
  if (quorum.value !== parseQuorum(snapshot.quorum).value) steps.push({ row: "quorum", kind: "quorum", value: quorum.value });

  const old = new Map(snapshot.motions.filter((m) => m.id).map((m) => [m.key, m]));
  for (const m of draft.motions) {
    const prev = old.get(m.key);
    if (!prev?.id || (m.status && m.status !== "DRAFT")) continue;
    const changed = MOTION_FIELDS.filter((f) => (typeof m[f] === "string" ? m[f].trim() : m[f]) !== prev[f]);
    if (changed.length) {
      const patchFields: Partial<MotionDraft> = {};
      for (const f of changed) Object.assign(patchFields, { [f]: typeof m[f] === "string" ? m[f].trim() : m[f] });
      steps.push({ row: "motions", kind: "motionUpdate", motionId: prev.id, patch: patchFields });
    }
  }
  // Moved rows take the positions the kept rows had, in their new order; the server never moves an open or closed one.
  const kept = draft.motions.filter((m) => old.has(m.key) && (!m.status || m.status === "DRAFT"));
  const slots = kept.map((m) => old.get(m.key)!.position ?? 0).sort((a, b) => a - b);
  kept.forEach((m, i) => {
    const prev = old.get(m.key)!;
    if (prev.id && prev.position !== slots[i]) steps.push({ row: "motions", kind: "motionUpdate", motionId: prev.id, patch: { position: slots[i] } });
  });
  for (const [key, m] of old) if (!draft.motions.some((d) => d.key === key) && m.id) steps.push({ row: "motions", kind: "motionDelete", motionId: m.id });
  // shortcut: a new motion is appended by the server, so one moved above an existing row lands last; fine until reorder-on-create is asked for.
  for (const m of draft.motions) if (!old.has(m.key)) steps.push({ row: "motions", kind: "motionCreate", motion: motionInput(m) });
  for (const l of draftLinks(draft)) steps.push(linkStep(l, ctx.defaultLinkName));
  return { mode: "edit", meetingId: meeting.id, patch, steps };
}

