"use client";
import { useSyncExternalStore } from "react";
import * as meetingsApi from "@uniwork/core/api/endpoints/meetings";
import { updateMeetingParticipant } from "@uniwork/core/api/endpoints/meeting-attendance";
import { createMeetingMotion, deleteMeetingMotion, updateMeetingMotion } from "@uniwork/core/api/endpoints/meeting-motions";
import { ApiError } from "@uniwork/core/api/http";
import type { Meeting } from "@uniwork/core/types/meeting";
import { expiresAtFromDays } from "../invite-link-url";
import { parseLimit } from "./draft-validation";
import { planRows, stageOf, type PlanStep, type RowKey, type SubmitPlan } from "./submit-plan";

/**
 * Runs a submit plan (create brief §3.3) and keeps its progress in a small
 * module store, so the run outlives the sheet: closing it during phase 2 lets
 * the calls finish and report by toast, and the result panel reopens on the
 * same rows. Nothing persists across a reload (brief §2.11: client memory).
 */

export const SetupApi = {
  createMeeting: meetingsApi.createMeeting,
  updateMeeting: meetingsApi.updateMeeting,
  inviteParticipant: meetingsApi.inviteParticipant,
  removeParticipant: meetingsApi.removeParticipant,
  setMeetingScribe: meetingsApi.setMeetingScribe,
  setMeetingAISharing: meetingsApi.setMeetingAISharing,
  createInviteLink: meetingsApi.createInviteLink,
  updateMeetingParticipant,
  createMeetingMotion,
  updateMeetingMotion,
  deleteMeetingMotion,
};
export type SetupApiShape = typeof SetupApi;

export type StepStatus = "queued" | "running" | "ok" | "failed";
export type StepState = {
  status: StepStatus;
  error?: unknown;
  /** The role step of a person whose invitation failed: it waits for that invitation. */
  waiting?: boolean;
  link?: { id: string; secret: string };
};

export type SubmitRun = {
  id: string;
  plan: SubmitPlan;
  phase: "phase1" | "phase2" | "done";
  meetingId: string | null;
  meeting: Meeting | null;
  /** Phase 1 failed: an ApiError (nothing created) or anything else (outcome unknown). */
  phase1Error: unknown;
  /** Phase 1 is past 10 s without an answer. */
  slow: boolean;
  steps: StepState[];
};

const SLOW_MS = 10_000;

const runs = new Map<string, SubmitRun>();
const listeners = new Set<() => void>();
let runSeq = 0;

function emit() {
  for (const l of listeners) l();
}

function patchRun(id: string, fn: (run: SubmitRun) => SubmitRun) {
  const run = runs.get(id);
  if (!run) return;
  runs.set(id, fn(run));
  emit();
}

function patchStep(id: string, index: number, next: StepState) {
  patchRun(id, (run) => ({ ...run, steps: run.steps.map((s, i) => (i === index ? next : s)) }));
}

export function getRun(id: string): SubmitRun | undefined {
  return runs.get(id);
}

/** Forgets a finished run (the sheet calls it once its result is shown or dismissed). */
export function dropRun(id: string) {
  if (runs.delete(id)) emit();
}

export function useSubmitRun(id: string | null): SubmitRun | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (id ? (runs.get(id) ?? null) : null),
    () => null,
  );
}

/** Phase 1 failed with a server answer (nothing was created), not a lost request. */
export function isHttpFailure(err: unknown): boolean {
  return err instanceof ApiError;
}

export type RowState = { key: RowKey; status: StepStatus; steps: { step: PlanStep; state: StepState }[] };

/** One result row per row key: running while any step runs, failed if any failed, ok once all are. */
export function runRows(run: SubmitRun): RowState[] {
  return planRows(run.plan).map((key) => {
    const steps = run.plan.steps.flatMap((step, i) => (step.row === key ? [{ step, state: run.steps[i]! }] : []));
    const statuses = steps.map((s) => s.state.status);
    const status: StepStatus = statuses.includes("running")
      ? "running"
      : statuses.includes("failed")
        ? "failed"
        : statuses.every((s) => s === "ok")
          ? "ok"
          : "queued";
    return { key, status, steps };
  });
}

/** "2/4": settled groups over all groups (every guest link is one group). */
export function runProgress(run: SubmitRun): { done: number; total: number } {
  const groups = new Map<string, boolean>();
  for (const row of runRows(run)) {
    const g = row.key.startsWith("link:") ? "links" : row.key;
    const settled = row.status === "ok" || row.status === "failed";
    groups.set(g, (groups.get(g) ?? true) && settled);
  }
  return { done: [...groups.values()].filter(Boolean).length, total: groups.size };
}

/** True while a guest link is still to be created: its secret shows once, so the sheet must stay. */
export function linksPending(run: SubmitRun): boolean {
  return run.plan.steps.some((s, i) => s.kind === "link" && (run.steps[i]!.status === "queued" || run.steps[i]!.status === "running"));
}

type Context = {
  api: SetupApiShape;
  workspaceId: string;
  idempotencyKey: string;
  now: () => number;
  /** Refresh what the run changed (lists, detail, people, links). */
  invalidate: (meetingId: string) => void;
  onDone?: (run: SubmitRun) => void;
};

const contexts = new Map<string, Context>();
const participantIds = new Map<string, Map<string, string>>();

async function runStep(runId: string, index: number) {
  const run = runs.get(runId)!;
  const ctx = contexts.get(runId)!;
  const step = run.plan.steps[index]!;
  const mid = run.meetingId!;
  const ids = participantIds.get(runId)!;
  patchStep(runId, index, { status: "running" });
  try {
    let link: StepState["link"];
    switch (step.kind) {
      case "invite": {
        const res = (await ctx.api.inviteParticipant(mid, step.userId)) as { participant: { id: string } } | null;
        if (!res) throw new Error("invite_invalid");
        ids.set(step.userId, res.participant.id);
        break;
      }
      case "remove":
        await ctx.api.removeParticipant(mid, step.participantId);
        break;
      case "scribe":
        // The policy may already have started the meeting this way.
        if (run.meeting && (run.meeting.scribe_enabled !== false) === step.enabled) break;
        await ctx.api.setMeetingScribe(mid, step.enabled);
        break;
      case "sharing":
        if (!(await ctx.api.setMeetingAISharing(mid, step.shared))) throw new Error("ai_sharing_invalid");
        break;
      case "quorum":
        await ctx.api.updateMeeting(mid, { quorum_percent: step.value });
        break;
      case "role": {
        const pid = step.participantId ?? ids.get(step.userId);
        if (!pid) {
          patchStep(runId, index, { status: "failed", waiting: true });
          return;
        }
        await ctx.api.updateMeetingParticipant(mid, pid, step.body);
        break;
      }
      case "motionCreate": {
        const { title, description, ballot_mode, threshold, base } = step.motion;
        await ctx.api.createMeetingMotion(mid, { title, description, ballot_mode, threshold, base });
        break;
      }
      case "motionUpdate":
        await ctx.api.updateMeetingMotion(mid, step.motionId, step.patch);
        break;
      case "motionDelete":
        await ctx.api.deleteMeetingMotion(mid, step.motionId);
        break;
      case "link": {
        const res = await ctx.api.createInviteLink(mid, {
          name: step.name,
          access_mode: step.link.access,
          // Counted from the moment it is sent, not from when the row was drafted.
          expires_at: expiresAtFromDays(Number(step.link.days), ctx.now()),
          ...(parseLimit(step.link.maxUses).value ? { max_uses: parseLimit(step.link.maxUses).value } : {}),
        });
        if (!res?.invite_link.secret) throw new Error("invite_link_invalid");
        link = { id: res.invite_link.id, secret: res.invite_link.secret };
        break;
      }
      default: {
        const never: never = step;
        throw new Error(`unknown step ${String(never)}`);
      }
    }
    patchStep(runId, index, { status: "ok", link });
  } catch (error) {
    patchStep(runId, index, { status: "failed", error });
  }
}

async function runIndexes(runId: string, indexes: number[]) {
  const plan = runs.get(runId)!.plan;
  const byStage = (stage: number) => indexes.filter((i) => stageOf(plan.steps[i]!) === stage);
  await Promise.allSettled(byStage(0).map((i) => runStep(runId, i)));
  // Settings in parallel across rows; inside one row in order (a secretary move assigns before it clears).
  const stage1 = byStage(1);
  const rows = [...new Set(stage1.map((i) => plan.steps[i]!.row))];
  await Promise.allSettled(
    rows.map(async (row) => {
      for (const i of stage1.filter((j) => plan.steps[j]!.row === row)) await runStep(runId, i);
    }),
  );
  for (const i of byStage(2)) await runStep(runId, i);
  for (const i of byStage(3)) await runStep(runId, i);
}

async function phase2(runId: string, indexes: number[]) {
  const ctx = contexts.get(runId)!;
  patchRun(runId, (r) => ({ ...r, phase: "phase2" }));
  await runIndexes(runId, indexes);
  const run = runs.get(runId)!;
  ctx.invalidate(run.meetingId!);
  patchRun(runId, (r) => ({ ...r, phase: "done" }));
  ctx.onDone?.(runs.get(runId)!);
}

async function phase1(runId: string) {
  const ctx = contexts.get(runId)!;
  const { plan } = runs.get(runId)!;
  patchRun(runId, (r) => ({ ...r, phase: "phase1", phase1Error: null, slow: false }));
  const timer = setTimeout(() => patchRun(runId, (r) => (r.phase === "phase1" ? { ...r, slow: true } : r)), SLOW_MS);
  try {
    let meeting: Meeting | null = null;
    if (plan.mode === "create") {
      meeting = await ctx.api.createMeeting(ctx.workspaceId, plan.create!, { idempotencyKey: ctx.idempotencyKey });
      if (!meeting) throw new Error("meeting_create_invalid");
    } else if (plan.patch && Object.keys(plan.patch).length > 0) {
      meeting = await ctx.api.updateMeeting(plan.meetingId!, plan.patch);
    }
    const meetingId = meeting?.id ?? plan.meetingId!;
    patchRun(runId, (r) => ({ ...r, meeting, meetingId, slow: false }));
    ctx.invalidate(meetingId);
  } catch (error) {
    patchRun(runId, (r) => ({ ...r, phase1Error: error, slow: false }));
    ctx.onDone?.(runs.get(runId)!);
    return;
  } finally {
    clearTimeout(timer);
  }
  await phase2(runId, plan.steps.map((_, i) => i));
}

export function startSubmitRun(plan: SubmitPlan, ctx: Omit<Context, "api" | "now"> & Partial<Pick<Context, "api" | "now">>): string {
  runSeq += 1;
  const id = `run${runSeq}`;
  runs.set(id, {
    id,
    plan,
    phase: "phase1",
    meetingId: plan.meetingId ?? null,
    meeting: null,
    phase1Error: null,
    slow: false,
    steps: plan.steps.map(() => ({ status: "queued" })),
  });
  contexts.set(id, { api: SetupApi, now: Date.now, ...ctx });
  participantIds.set(id, new Map());
  emit();
  void phase1(id);
  return id;
}

/** Phase 1 again, same idempotency key: a replay returns the first meeting, never a second one. */
export function retryPhase1(runId: string) {
  if (runs.get(runId)?.phase1Error) void phase1(runId);
}

/** Retries the failed steps of some rows; retrying the invitations also retries the roles waiting on them. */
export function retryRows(runId: string, keys: readonly RowKey[]): Promise<void> {
  const run = runs.get(runId);
  if (!run?.meetingId) return Promise.resolve();
  const wanted = new Set<string>(keys);
  const indexes = run.plan.steps.flatMap((step, i) => {
    const state = run.steps[i]!;
    if (state.status !== "failed") return [];
    const waitsOnPeople = state.waiting && wanted.has("people");
    return wanted.has(step.row) || waitsOnPeople ? [i] : [];
  });
  return phase2(runId, indexes);
}
