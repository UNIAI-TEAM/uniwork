import type { ReactNode } from "react";
import { createElement } from "react";
import type { TaskComment } from "@uniwork/core/types";
import { preprocessMentionShortcodes } from "@uniwork/ui/markdown";
import { buildCommentThreads, deriveThreadResolution } from "./comment-thread";

export type ThreadNavFilter = "all" | "unresolved" | "resolved" | "mine";

export type ThreadDayGroup = "today" | "yesterday" | "earlier";

export type ThreadNavThread = {
  /** Root comment id — also the `comment-${id}` DOM anchor. */
  id: string;
  entry: TaskComment;
  resolved: boolean;
  replyCount: number;
  involvesMe: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const PREVIEW_TITLE_MAX = 200;
const PREVIEW_BODY_MAX = 300;

/**
 * Bucket a thread by the calendar day of its root comment, in the reader's
 * local time zone. Only three buckets: past "yesterday" a per-day header
 * would produce more headers than rows on a long-running task.
 */
export function threadDayGroup(createdAt: string | undefined, nowMs: number): ThreadDayGroup {
  const ts = Date.parse(createdAt ?? "");
  if (Number.isNaN(ts)) return "earlier";
  const startOfToday = new Date(nowMs).setHours(0, 0, 0, 0);
  if (ts >= startOfToday) return "today";
  if (ts >= startOfToday - DAY_MS) return "yesterday";
  return "earlier";
}

/** Wall-clock under today/yesterday; calendar date under earlier. */
export function formatStamp(createdAt: string | undefined, group: ThreadDayGroup): string {
  const ts = Date.parse(createdAt ?? "");
  if (Number.isNaN(ts)) return "";
  const d = new Date(ts);
  return group === "earlier"
    ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function matchesFilter(thread: ThreadNavThread, filter: ThreadNavFilter): boolean {
  switch (filter) {
    case "unresolved":
      return !thread.resolved;
    case "resolved":
      return thread.resolved;
    case "mine":
      return thread.involvesMe;
    case "all":
      return true;
    default:
      return true;
  }
}

/**
 * Whether `content` @mentions `userId`. Matches both the markdown link form
 * and the legacy `[@ id="..." label="..."]` shortcode still in older rows.
 */
export function mentionsUser(content: string | undefined, userId: string): boolean {
  if (!content || !userId) return false;
  return preprocessMentionShortcodes(content).includes(`mention://member/${userId}`);
}

/**
 * Flatten comment markdown into a plain-text preview: `title` is the first
 * non-empty line, `body` is the remaining lines joined into one excerpt.
 */
export function commentThreadPreview(markdown: string): { title: string; body: string } {
  const lines = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/^\s*(?:[-+*]|\d+[.)])\s+/, "")
        .replace(/[#*`>~]/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
  return {
    title: (lines[0] ?? "").slice(0, PREVIEW_TITLE_MAX),
    body: lines.slice(1).join(" ").slice(0, PREVIEW_BODY_MAX),
  };
}

/**
 * Split `text` on every case-insensitive occurrence of `query`, tinting the
 * matches with the same brand-subtle cue the find bar uses elsewhere.
 */
export function highlightMatches(text: string, query: string): ReactNode {
  const needle = query.trim();
  if (needle === "") return text;
  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const out: ReactNode[] = [];
  let from = 0;
  let at = lowerText.indexOf(lowerNeedle);
  while (at !== -1) {
    if (at > from) out.push(text.slice(from, at));
    out.push(
      createElement(
        "mark",
        {
          key: at,
          className: "rounded-[3px] bg-brand-subtle px-px text-foreground",
        },
        text.slice(at, at + needle.length),
      ),
    );
    from = at + needle.length;
    at = lowerText.indexOf(lowerNeedle, from);
  }
  if (from < text.length) out.push(text.slice(from));
  return out;
}

function isHumanAuthor(kind: string | undefined): boolean {
  return kind !== "agent" && kind !== "system";
}

/** Build the header thread-nav rows from the flat comments list. */
export function buildThreadNavThreads(
  comments: TaskComment[],
  currentUserId: string | undefined,
): ThreadNavThread[] {
  const threads = buildCommentThreads(comments);
  const userId = currentUserId ?? "";
  return threads.map((thread) => {
    const entries = [thread.root, ...thread.replies];
    const involvesMe =
      userId !== "" &&
      entries.some(
        (entry) =>
          (isHumanAuthor(entry.author_kind) && entry.author_id === userId) ||
          mentionsUser(entry.body, userId),
      );
    return {
      id: thread.root.id,
      entry: thread.root,
      resolved: deriveThreadResolution(thread.root, thread.replies).kind !== "none",
      replyCount: thread.replies.length,
      involvesMe,
    };
  });
}

/**
 * Scroll `el` so its top sits just below the scroll container's top edge.
 * Drives `scrollTop` directly — never native `scrollIntoView`, which also
 * scrolls every scrollable ancestor (desktop shell included).
 */
export function scrollCommentIntoContainer(
  el: HTMLElement,
  container: HTMLElement,
  topGap = 16,
): void {
  const c = container.getBoundingClientRect();
  const e = el.getBoundingClientRect();
  container.scrollTop = Math.max(0, container.scrollTop + (e.top - c.top) - topGap);
}
