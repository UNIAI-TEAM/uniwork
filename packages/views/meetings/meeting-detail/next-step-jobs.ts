/**
 * The next-step strip as a pure function (brief Principle 1): one viewer, one
 * meeting state → the rows of jobs under the title, at most three plus a
 * "+n việc khác" count. It never offers a job the server will not do: every
 * row that carries a command is gated on the same role the server checks.
 */
import type { DetailStatus, DetailViewer } from "./detail-model";

export type MinutesState = "off" | "none" | "draft" | "final";

export type StripJob =
  /**
   * Before the meeting: when it starts and who has not answered; the runner starts it, anyone else joins.
   * In person there is no room: a clerk records it (`canRecord`), nobody starts or joins.
   */
  | { kind: "start"; canStart: boolean; pendingNames: string[]; inPerson: boolean; canRecord: boolean }
  /** Before the meeting, an invitee who is not running it: package G's RSVP row. */
  | { kind: "rsvp" }
  /** Live: "Cần bạn · n" over the lobby and vote rows (package F), with End for the runner and Join. */
  | { kind: "live"; need: number; canEnd: boolean }
  /** Past `ends_at` while live: the room takes nobody new; the runner extends or ends. */
  | { kind: "overtime"; canAct: boolean }
  /** The window passed unstarted: the runner records it as held or reschedules. */
  | { kind: "missed"; canAct: boolean }
  /** Called off: who did it and when; the runner restores while its time is ahead. */
  | { kind: "canceled"; canRestore: boolean }
  /** A member outside the meeting: what is not theirs to read. */
  | { kind: "outsider" }
  /** After the end, the clerk's close-out: assign, finalize the minutes, schedule the next one. */
  | {
      kind: "closeOut";
      pending: number;
      converted: number;
      guessed: number;
      earliestDue: string | null;
      /** The items have loaded and none is pending or assigned ("· chưa có việc cần làm"). */
      noItems: boolean;
      /** The AI is still writing the summary (and its items): "Đang soạn tóm tắt · biên bản chưa có". */
      drafting: boolean;
      minutes: MinutesState;
      canFinalize: boolean;
      canFollowUp: boolean;
    }
  /** After the end, a member's own items. */
  | { kind: "memberItems"; mine: number; assigned: number; waiting: number; nearest: { title: string; due: string } | null };

export type StripInput = {
  status: DetailStatus;
  viewer: DetailViewer;
  /** Host or workspace admin (`useMeetingPermissions().canHost`). */
  canHost: boolean;
  canCancel: boolean;
  isClerk: boolean;
  hasInvitation: boolean;
  /** Invitees who have not answered, by name. */
  pendingNames: string[];
  /** Live: waiting guests the viewer may admit plus open votes the viewer acts on. */
  liveNeed: number;
  /** Canceled: its window is still ahead (restore is refused once it passed). */
  windowAhead: boolean;
  items: StripItem[] | null;
  userId: string;
  minutes: MinutesState;
  minutesEditable: boolean;
  /** The summary run is under way (AfterAIStates c1). */
  summaryRunning?: boolean;
  /** Held in person, without a room (UNI-2247). */
  inPerson?: boolean;
  /** A clerk of an in-person meeting where the organization transcribes. */
  canRecord?: boolean;
};

/** The fields of an action item the strip reads. */
export type StripItem = {
  title: string;
  status: string;
  suggested_assignee_id?: string | null;
  suggested_due_date?: string | null;
  suggested_due_guessed?: boolean;
  task?: { assignee_id?: string | null; due_date?: string | null } | null;
};

const STRIP_MAX_ROWS = 3;

function closeOut(input: StripInput): StripJob | null {
  const items = input.items ?? [];
  const pendingItems = items.filter((i) => i.status === "PENDING");
  const converted = items.filter((i) => i.status === "CONVERTED").length;
  const dues = pendingItems.map((i) => i.suggested_due_date).filter((d): d is string => Boolean(d)).sort();
  const job: StripJob = {
    kind: "closeOut",
    pending: pendingItems.length,
    converted,
    guessed: pendingItems.filter((i) => i.suggested_due_guessed === true && i.suggested_due_date).length,
    earliestDue: dues[0] ?? null,
    noItems: input.items !== null && pendingItems.length + converted === 0,
    drafting: input.summaryRunning === true && pendingItems.length + converted === 0,
    minutes: input.minutes,
    canFinalize: input.minutes === "draft" && input.minutesEditable,
    canFollowUp: input.canHost,
  };
  // Nothing to say and nothing to press: no row.
  const says = job.pending > 0 || job.minutes === "draft" || job.minutes === "none" || job.converted > 0 || job.drafting;
  return says || job.canFollowUp ? job : null;
}

function memberItems(input: StripInput): StripJob | null {
  const mine = (input.items ?? []).filter((i) =>
    i.status === "CONVERTED" ? i.task?.assignee_id === input.userId : i.status === "PENDING" && i.suggested_assignee_id === input.userId,
  );
  if (mine.length === 0) return null;
  const dated = mine
    .map((i) => ({ title: i.title, due: (i.status === "CONVERTED" ? i.task?.due_date : i.suggested_due_date) ?? "" }))
    .filter((i) => i.due !== "")
    .sort((a, b) => a.due.localeCompare(b.due));
  const assigned = mine.filter((i) => i.status === "CONVERTED").length;
  return { kind: "memberItems", mine: mine.length, assigned, waiting: mine.length - assigned, nearest: dated[0] ?? null };
}

/** The strip's rows, in reading order, before the cap. */
export function nextStepJobs(input: StripInput): StripJob[] {
  const { status, viewer } = input;
  const live = status === "IN_PROGRESS" || status === "OVERTIME";
  if (viewer === "outsider" && (live || status === "ENDED")) return [{ kind: "outsider" }];
  switch (status) {
    case "CANCELED":
      return [{ kind: "canceled", canRestore: input.canCancel && input.windowAhead }];
    case "MISSED":
      return [{ kind: "missed", canAct: input.canHost }];
    case "SCHEDULED":
      // In person, a clerk who may record (an invited secretary too) records instead of answering.
      return input.hasInvitation && !input.canHost && !(input.inPerson && input.canRecord)
        ? [{ kind: "rsvp" }]
        : [
            {
              kind: "start",
              canStart: input.canHost,
              pendingNames: input.pendingNames,
              inPerson: input.inPerson === true,
              canRecord: input.canRecord === true,
            },
          ];
    case "IN_PROGRESS":
      return [{ kind: "live", need: input.liveNeed, canEnd: input.canHost }];
    case "OVERTIME":
      return [{ kind: "overtime", canAct: input.canHost }];
    case "ENDED": {
      const job = input.isClerk ? closeOut(input) : memberItems(input);
      return job ? [job] : [];
    }
    default:
      return [];
  }
}

/** At most three rows; the rest is a count ("+n việc khác"). */
export function capJobs(jobs: StripJob[]): { shown: StripJob[]; more: number } {
  return { shown: jobs.slice(0, STRIP_MAX_ROWS), more: Math.max(0, jobs.length - STRIP_MAX_ROWS) };
}
