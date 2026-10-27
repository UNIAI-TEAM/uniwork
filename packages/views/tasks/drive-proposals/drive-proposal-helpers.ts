import { ApiError, errorCode } from "@uniwork/core/api";
import type {
  DriveDuplicateTask,
  DriveProposalDuplicateItem,
  DriveProposalExcerpt,
  DriveProposalTaskItemInput,
  DriveTaskProposalItem,
} from "@uniwork/core/drive";
import type { DriveIconKind } from "@uniwork/core/drive-library";
import type { TaskPriority } from "@uniwork/core/types";

export type DuplicateDecision = "unresolved" | "skip" | "keep";

export interface DriveProposalItemDraft {
  index: number;
  selected: boolean;
  title: string;
  assigneeId: string | undefined;
  assigneeBasis: string | undefined;
  assigneeDriveAccess: string | undefined;
  priority: TaskPriority;
  priorityBasis: string | undefined;
  startDate: string | undefined;
  startBasis: string | undefined;
  dueDate: string | undefined;
  dueBasis: string | undefined;
  labelIds: string[];
  labelBasis: string | undefined;
  goal: string;
  checklist: string[];
  excerpt: DriveProposalExcerpt;
  blockedByIndexes: number[];
  possibleDuplicate: DriveDuplicateTask | undefined;
  duplicateDecision: DuplicateDecision;
}

const VALID_PRIORITIES: Record<string, true> = {
  none: true,
  low: true,
  medium: true,
  high: true,
  urgent: true,
};

export function normalizeProposalPriority(raw: string | undefined): TaskPriority {
  if (raw && VALID_PRIORITIES[raw]) {
    return raw as TaskPriority;
  }
  return "none";
}

export function createItemDraftsFromProposal(
  items: readonly DriveTaskProposalItem[],
): DriveProposalItemDraft[] {
  return items.map((item) => ({
    index: item.index,
    selected: true,
    title: item.title,
    assigneeId: item.assignee_member_id || undefined,
    assigneeBasis: item.assignee_basis || undefined,
    assigneeDriveAccess: item.assignee_drive_access || undefined,
    priority: normalizeProposalPriority(item.priority),
    priorityBasis: item.priority_basis || undefined,
    startDate: item.start_date || undefined,
    startBasis: item.start_basis || undefined,
    dueDate: item.due_date || undefined,
    dueBasis: item.due_basis || undefined,
    labelIds: [...item.label_ids],
    labelBasis: item.label_basis || undefined,
    goal: item.goal,
    checklist: [...item.checklist],
    excerpt: {
      section: item.excerpt.section,
      quote: item.excerpt.quote,
    },
    blockedByIndexes: [...item.blocked_by_indexes],
    possibleDuplicate: item.possible_duplicate,
    duplicateDecision: "unresolved",
  }));
}

export function applyDuplicateResults(
  drafts: readonly DriveProposalItemDraft[],
  results: readonly DriveProposalDuplicateItem[],
): DriveProposalItemDraft[] {
  const byPos = new Map(results.map((r) => [r.index, r.possible_duplicate]));
  return drafts.map((draft) => {
    const nextDup = byPos.get(draft.index);
    const hadSameDup =
      draft.possibleDuplicate?.task_id &&
      draft.possibleDuplicate.task_id === nextDup?.task_id;
    return {
      ...draft,
      possibleDuplicate: nextDup,
      duplicateDecision: nextDup
        ? hadSameDup
          ? draft.duplicateDecision
          : "unresolved"
        : "unresolved",
    };
  });
}

export function formatDriveProposalSourceLine(
  excerpt: DriveProposalExcerpt,
  fileName: string,
  fileHref: string | null,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const section = excerpt.section.trim();
  const quote = excerpt.quote.trim();
  const linkedFile = fileHref ? `[${fileName}](${fileHref})` : fileName;

  if (section && quote) {
    return t("drive.proposals.review.description_source_with_section", {
      section,
      quote,
      fileName: linkedFile,
    });
  }
  if (quote) {
    return t("drive.proposals.review.description_source_quote_only", {
      quote,
      fileName: linkedFile,
    });
  }
  return t("drive.proposals.review.description_source_file_only", {
    fileName: linkedFile,
  });
}

export interface DriveProposalSummaryParts {
  goalPart: string;
  tailPart: string;
  fullText: string;
}

export function formatDriveProposalSummaryLine(
  goal: string,
  checklist: readonly string[],
  t: (key: string, opts?: Record<string, unknown>) => string,
): DriveProposalSummaryParts | null {
  const normalizedGoal = goal.replace(/\s+/g, " ").trim();
  const todoCount = checklist.filter((item) => item.trim().length > 0).length;

  const goalPart = normalizedGoal
    ? t("drive.proposals.review.summary_goal", { goal: normalizedGoal })
    : "";
  const todosText =
    todoCount > 0
      ? t("drive.proposals.review.summary_todos", { count: todoCount })
      : "";
  const tailPart = todosText
    ? goalPart
      ? t("drive.proposals.review.summary_todos_tail", { todos: todosText })
      : todosText
    : "";

  const fullText = `${goalPart}${tailPart}`;
  if (!fullText) {
    return null;
  }
  return { goalPart, tailPart, fullText };
}

export interface DriveProposalQuoteSourceParts {
  quotePart: string;
  fileTailPart: string;
  fullText: string;
}

export function formatDriveProposalQuoteSourceLine(
  excerpt: DriveProposalExcerpt,
  fileName: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): DriveProposalQuoteSourceParts | null {
  const normalizedQuote = excerpt.quote.replace(/\s+/g, " ").trim();
  if (!normalizedQuote) {
    return null;
  }
  const quotePart = t("drive.proposals.review.summary_quote_only", {
    quote: normalizedQuote,
  });
  const trimmedFileName = fileName.replace(/\s+/g, " ").trim();
  const fileTailPart = trimmedFileName
    ? t("drive.proposals.review.summary_quote_file_tail", {
        fileName: trimmedFileName,
      })
    : "";
  return {
    quotePart,
    fileTailPart,
    fullText: `${quotePart}${fileTailPart}`,
  };
}

/**
 * Builds the task description from the item's goal, checklist, excerpt, and
 * source document link (spec §8.4, §8.5, Q3: excerpt always stays in the
 * description, no strip toggle).
 */
export function buildDriveProposalTaskDescription(
  draft: Pick<DriveProposalItemDraft, "goal" | "checklist" | "excerpt">,
  fileName: string,
  fileHref: string | null,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const parts: string[] = [];
  const trimmedGoal = draft.goal.trim();
  if (trimmedGoal) {
    parts.push(`**${t("drive.proposals.review.description_goal_label")}** ${trimmedGoal}`);
  }

  const checklistLines = draft.checklist
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (checklistLines.length > 0) {
    parts.push(
      [
        `**${t("drive.proposals.review.description_checklist_heading")}**`,
        ...checklistLines.map((line) => `- [ ] ${line}`),
      ].join("\n"),
    );
  }

  parts.push(formatDriveProposalSourceLine(draft.excerpt, fileName, fileHref, t));
  return parts.join("\n\n");
}

/**
 * Converts selected item drafts into the B6 request items array (spec §8.5).
 * Filters `blocked_by_indexes` so it only references items included in the same
 * batch request.
 */
export function buildBatchCreateItems(
  drafts: readonly DriveProposalItemDraft[],
  fileName: string,
  fileHref: string | null,
  t: (key: string, opts?: Record<string, unknown>) => string,
): DriveProposalTaskItemInput[] {
  const selectedDrafts = drafts.filter(
    (d) => d.selected && d.duplicateDecision !== "skip" && d.title.trim().length > 0,
  );
  const selectedIndexes = new Set(selectedDrafts.map((d) => d.index));

  return selectedDrafts.map((draft) => {
    const blockedBy = draft.blockedByIndexes.filter(
      (idx) => idx !== draft.index && selectedIndexes.has(idx),
    );
    const allowDuplicate = draft.duplicateDecision === "keep";

    return {
      index: draft.index,
      title: draft.title.trim(),
      description: buildDriveProposalTaskDescription(draft, fileName, fileHref, t),
      assignee_id: draft.assigneeId ?? null,
      priority: draft.priority !== "none" ? draft.priority : undefined,
      start_date: draft.startDate ?? null,
      due_date: draft.dueDate ?? null,
      label_ids: draft.labelIds,
      blocked_by_indexes: blockedBy,
      allow_duplicate: allowDuplicate,
    };
  });
}

export function driveFileTypeLabel(
  kind: DriveIconKind | string | undefined,
  t: (key: string) => string,
): string {
  switch (kind) {
    case "google_doc":
    case "google_sheet":
    case "google_slide":
    case "docx":
    case "xlsx":
    case "pptx":
    case "pdf":
    case "markdown":
    case "text":
      return t(`driveLibrary.file_types.${kind}`);
    default:
      return t("driveLibrary.file_types.generic");
  }
}

export function isProposalExpired(expiresAt: string | undefined, nowMs = Date.now()): boolean {
  if (!expiresAt) return false;
  const parsed = Date.parse(expiresAt);
  if (Number.isNaN(parsed)) return false;
  return parsed <= nowMs;
}

export interface DriveProposalCreateErrorResolution {
  code: string;
  message: string;
  isTerminalProposalState: boolean;
}

/**
 * Maps an error from `POST .../drive-task-proposals/{proposalID}/tasks` (Card B6)
 * or `GET/DELETE .../drive-task-proposals/{proposalID}` (Card B5) to localized
 * copy under `drive.proposals.errors` (spec §7.10, §8.5, `sdo/drive_codes.go`).
 */
export function resolveDriveProposalCreateError(
  error: unknown,
  t: (key: string) => string,
): DriveProposalCreateErrorResolution {
  const code = errorCode(error);
  const status = error instanceof ApiError ? error.status : undefined;

  if (status === 410 || code === "proposal_expired") {
    return {
      code: "proposal_expired",
      message: t("drive.proposals.errors.proposal_expired"),
      isTerminalProposalState: true,
    };
  }

  switch (code) {
    case "proposal_not_ready":
      return {
        code,
        message: t("drive.proposals.errors.proposal_not_ready"),
        isTerminalProposalState: true,
      };
    case "proposal_item_already_converted":
      return {
        code,
        message: t("drive.proposals.errors.proposal_item_already_converted"),
        isTerminalProposalState: true,
      };
    case "active_duplicate_task":
    case "drive_source_changed":
    case "drive_access_required":
    case "drive_grant_required":
    case "drive_file_not_accessible":
    case "drive_unavailable":
    case "auth_failed":
    case "blocked_by_workspace_admin":
    case "quota_exceeded":
    case "not_found":
      return {
        code,
        message: t(`drive.proposals.errors.${code}`),
        isTerminalProposalState: false,
      };
    case "feature_disabled":
      return {
        code,
        message: t("drive.proposals.errors.ai_disabled"),
        isTerminalProposalState: false,
      };
    default:
      if (status === 429 || code === "rate_limited") {
        return {
          code: "rate_limited",
          message: t("drive.proposals.errors.rate_limited"),
          isTerminalProposalState: false,
        };
      }
      return {
        code: code ?? "create_default",
        message: t("drive.proposals.errors.create_default"),
        isTerminalProposalState: false,
      };
  }
}

export interface DriveProposalCreatedToastCopy {
  message: string;
  actionLabel: string;
  actionHref: string | null;
}

export function formatProposalCreatedToast({
  count,
  fileName,
  parentTaskId,
  parentLabel,
  firstCreatedTaskId,
  taskHref,
  tasksListHref,
  t,
}: {
  count: number;
  fileName: string;
  parentTaskId: string | undefined;
  parentLabel: string | undefined;
  firstCreatedTaskId: string | undefined;
  taskHref: (taskId: string) => string | null;
  tasksListHref: string | null;
  t: (key: string, opts?: Record<string, unknown>) => string;
}): DriveProposalCreatedToastCopy {
  const message = parentLabel
    ? t("drive.proposals.review.toast_created_with_parent", {
        count,
        fileName,
        parent: parentLabel,
      })
    : t("drive.proposals.review.toast_created_no_parent", {
        count,
        fileName,
      });

  const parentHref = parentTaskId ? taskHref(parentTaskId) : null;
  const fallbackHref = firstCreatedTaskId
    ? taskHref(firstCreatedTaskId)
    : tasksListHref;
  const actionHref = parentHref ?? fallbackHref;
  const actionLabel = parentLabel
    ? t("drive.proposals.review.toast_view_parent", { parent: parentLabel })
    : t("drive.proposals.review.toast_view_tasks");

  return { message, actionLabel, actionHref };
}
