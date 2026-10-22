import type { AccessReportFilters } from "@uniwork/core/types/document-access-report";
import { REPORT_LEVELS } from "./access-report-labels";
import type { ReportSortKey, ReportSortOrder } from "./access-report-sort-header";

// The access report's URL state (UNI-2039 F2). The scope, the tab, every
// filter and the sort live in the query string, so a report can be shared and
// reloaded; a value this build does not know is dropped on the way in, never
// sent on to the server.

export type ReportView = "documents" | "people";

/** General access a document can have (`scope=`). */
export const REPORT_SCOPES = ["restricted", "workspace", "organization"] as const;
/** Where a grant comes from (`source=`), in the order the filter lists them. */
export const REPORT_SOURCES = ["owner", "workspace", "direct", "chat", "link", "break_glass"] as const;
/** The tiles that filter the list (`flag=`); the documents tile clears it. */
export const REPORT_FLAGS = ["public_link", "outside_workspace", "direct_manage"] as const;
/** The kinds of principal the By person tab can narrow to (`kind=`). */
export const PRINCIPAL_KINDS = ["member", "home_workspace", "other_workspace", "organization", "link"] as const;

const MAX_SEARCH = 100;
const DEFAULT_ORDER: Record<ReportSortKey, ReportSortOrder> = { changed: "desc", title: "asc" };
const PRINCIPAL = /^(?:(?:user|workspace|organization):[^:\s]+|link(?::[^:\s]+)?)$/;

export interface ReportQueryState {
  /** Empty = the whole workspace. */
  folderId: string | undefined;
  view: ReportView;
  filters: AccessReportFilters;
  sort: ReportSortKey;
  order: ReportSortOrder;
  /** By person only: the kind of principal. */
  kind: string | undefined;
}

export const DEFAULT_REPORT_QUERY: ReportQueryState = {
  folderId: undefined,
  view: "documents",
  filters: {},
  sort: "changed",
  order: "desc",
  kind: undefined,
};

const OWNED = ["folder", "view", "q", "principal", "level", "scope", "source", "flag", "non_default", "sort", "order", "kind"];

function oneOf<T extends string>(allowed: readonly T[], value: string | null): T | undefined {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/** A comma list kept to known values, in the order `allowed` gives them. */
function listOf(allowed: readonly string[], value: string | null): string[] {
  const picked = (value ?? "").split(",");
  return allowed.filter((v) => picked.includes(v));
}

export function readReportQuery(params: URLSearchParams): ReportQueryState {
  const filters: AccessReportFilters = {};
  const q = (params.get("q") ?? "").trim().slice(0, MAX_SEARCH);
  if (q) filters.q = q;
  const principal = params.get("principal") ?? "";
  if (PRINCIPAL.test(principal)) filters.principal = principal;
  const levels = listOf(REPORT_LEVELS, params.get("level"));
  if (levels.length > 0) filters.levels = levels;
  const scope = oneOf(REPORT_SCOPES, params.get("scope"));
  if (scope) filters.scope = scope;
  const sources = listOf(REPORT_SOURCES, params.get("source"));
  if (sources.length > 0) filters.sources = sources;
  const flag = oneOf(REPORT_FLAGS, params.get("flag"));
  if (flag) filters.flag = flag;
  if (params.get("non_default") === "1") filters.nonDefault = true;

  const sort = oneOf<ReportSortKey>(["changed", "title"], params.get("sort")) ?? DEFAULT_REPORT_QUERY.sort;
  return {
    folderId: params.get("folder") || undefined,
    view: params.get("view") === "person" ? "people" : "documents",
    filters,
    sort,
    order: oneOf<ReportSortOrder>(["asc", "desc"], params.get("order")) ?? DEFAULT_ORDER[sort],
    kind: oneOf(PRINCIPAL_KINDS, params.get("kind")),
  };
}

/** The query string for `next`; params the report does not own are kept. */
export function writeReportQuery(current: URLSearchParams, next: ReportQueryState): string {
  const params = new URLSearchParams(current.toString());
  for (const key of OWNED) params.delete(key);
  const set = (key: string, value: string | undefined) => {
    if (value) params.set(key, value);
  };
  const { filters } = next;
  set("folder", next.folderId);
  set("view", next.view === "people" ? "person" : undefined);
  set("q", filters.q?.trim().slice(0, MAX_SEARCH));
  set("principal", filters.principal);
  set("level", (filters.levels ?? []).join(","));
  set("scope", filters.scope);
  set("source", (filters.sources ?? []).join(","));
  set("flag", filters.flag);
  set("non_default", filters.nonDefault ? "1" : undefined);
  if (next.sort !== DEFAULT_REPORT_QUERY.sort || next.order !== DEFAULT_ORDER[next.sort]) {
    params.set("sort", next.sort);
    params.set("order", next.order);
  }
  set("kind", next.kind);
  return params.toString();
}
