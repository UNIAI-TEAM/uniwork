import { Bot, CircleDot, User, Users, type LucideIcon } from "lucide-react";
import { paths } from "@uniwork/core/paths";
import type { GraphHistoryItem, GraphNeighbor, GraphNode } from "@uniwork/core/types/graph";
import { shortDateFormat } from "../common/date-pill";
import { dateOnlyToLocalDate, toDateOnly } from "../common/date-field";
import { MODULE_ICONS } from "../layout/module-icons";

/** Group order on the panel: where the work came from first, then who and where. */
const GROUP_ORDER = [
  "originated_from_out", "owned_by_out", "belongs_to_out", "depends_on_out", "depends_on_in",
  "discussed_in_out", "participated_in_in", "participated_in_out", "evidenced_by_out",
  "belongs_to_in", "owned_by_in", "originated_from_in", "discussed_in_in", "evidenced_by_in",
];

export function groupKey(edgeType: string, direction: string): string {
  return `${edgeType.toLowerCase()}_${direction === "in" ? "in" : "out"}`;
}

export function groupNeighbors(items: GraphNeighbor[]): { key: string; items: GraphNeighbor[] }[] {
  const by = new Map<string, GraphNeighbor[]>();
  for (const item of items) {
    const k = groupKey(item.edge_type, item.direction);
    by.set(k, [...(by.get(k) ?? []), item]);
  }
  const keys = [...GROUP_ORDER.filter((k) => by.has(k)), ...[...by.keys()].filter((k) => !GROUP_ORDER.includes(k))];
  return keys.map((key) => ({ key, items: by.get(key) ?? [] }));
}

/**
 * Where a node opens; null when it has no page (a team, an agent, an email
 * thread for now) or no longer has one (deleted: the graph keeps the node so
 * the timeline still reads, but its page is gone).
 */
export function graphNodeHref(node: GraphNode, orgSlug: string, fallbackWsSlug: string): string | null {
  if (node.deleted) return null;
  const ws = paths.workspace(orgSlug, node.workspace_slug || fallbackWsSlug);
  switch (node.type) {
    case "TASK":
      return ws.task(node.id);
    case "MEETING":
      return ws.meeting(node.id);
    case "PROJECT":
      return ws.project(node.id);
    case "ACTOR":
      return node.subtype === "member" ? ws.person(node.id) : null;
    case "THREAD":
      return node.subtype === "chat_room" ? `${ws.chat()}?${new URLSearchParams({ room: node.id }).toString()}` : null;
    default:
      return null;
  }
}

export function graphNodeIcon(node: GraphNode): LucideIcon {
  switch (node.type) {
    case "TASK":
      return MODULE_ICONS.tasks;
    case "MEETING":
      return MODULE_ICONS.meetings;
    case "PROJECT":
      return MODULE_ICONS.projects;
    case "ACTOR":
      return node.subtype === "agent" ? Bot : User;
    case "TEAM":
      return Users;
    case "THREAD":
      return node.subtype === "email_thread" ? MODULE_ICONS.email : MODULE_ICONS.chat;
    default:
      return CircleDot;
  }
}

/**
 * A graph date: a calendar date ("date") stays that date in every zone; an
 * instant reads in the viewer's zone, with its HH:mm when the precision is
 * "datetime" (a due from due_at) and as its day otherwise.
 */
export function formatGraphDate(value: string, precision: string, locale: string): string {
  if (!value) return "";
  const d = precision === "date" ? dateOnlyToLocalDate(value) : new Date(value);
  if (!d || Number.isNaN(d.getTime())) return value;
  // The year check reads the local date: an ISO string is UTC, and local
  // midnight on 1 January east of UTC is still last year there.
  const day = shortDateFormat(toDateOnly(d));
  return precision === "datetime"
    ? d.toLocaleString(locale, { ...day, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    : d.toLocaleDateString(locale, day);
}

type Label = (key: string, vars?: Record<string, string>) => string;

/** The sentence one history row reads as. */
export function historySentence(item: GraphHistoryItem, label: Label, statusName: (key: string) => string, locale: string): string {
  if (item.kind === "fact") {
    if (item.fact_type === "due") {
      const to = formatGraphDate(item.value, item.precision, locale);
      return item.previous
        ? label("graph.history.due_changed", { from: formatGraphDate(item.previous, item.previous_precision, locale), to })
        : label("graph.history.due_set", { to });
    }
    if (item.fact_type === "status") {
      return item.previous
        ? label("graph.history.status_changed", { from: statusName(item.previous), to: statusName(item.value) })
        : label("graph.history.status_set", { to: statusName(item.value) });
    }
    return item.value;
  }
  const title = item.node?.title || label("graph.related.untitled");
  switch (item.edge_type) {
    case "OWNED_BY":
      return label("graph.history.owned_by", { name: title });
    case "ORIGINATED_FROM":
      return label("graph.history.originated_from", { title });
    case "BELONGS_TO":
      // In-edges are the node's children (a subtask pointing at its parent).
      if (item.direction === "in") return label("graph.history.belongs_to_in", { title });
      return item.node?.type === "TASK" ? label("graph.history.belongs_to_task", { title }) : label("graph.history.belongs_to_project", { title });
    case "DEPENDS_ON":
      return item.direction === "in" ? label("graph.history.depends_on_in", { title }) : label("graph.history.depends_on_out", { title });
    case "PARTICIPATED_IN":
      return label("graph.history.participated_in", { name: title });
    default:
      return title;
  }
}

/** When it held: "since …", "… – …", or no date for a backfilled row. */
export function historyWhen(item: GraphHistoryItem, label: Label, locale: string): string {
  if (item.backfilled) return label("graph.history.before_graph");
  // When a row held reads as a day (spec §7 "từ 03/10"); only a timed due
  // prints its hour.
  const from = formatGraphDate(item.valid_from, "day", locale);
  if (!item.valid_to) return label("graph.history.since", { from });
  return label("graph.history.range", { from, to: formatGraphDate(item.valid_to, "day", locale) });
}
