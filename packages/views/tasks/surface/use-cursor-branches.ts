"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import type { TableRowsBody, TableRowsResult } from "@uniwork/core/api/endpoints/tasks-table";
import { ApiError } from "@uniwork/core/api/http";
import { tableRowsPageQuery } from "@uniwork/core/tasks/surface/table-query";

/** One branch to page: a group (and parent) of the table API, keyed by the caller. */
export interface CursorBranchSpec {
  key: string;
  /** The branch's request; `cursor` is ignored, the hook pages it. */
  body: TableRowsBody;
  enabled: boolean;
}

export interface CursorBranchState {
  key: string;
  /** Loaded pages in order; the first copy of an id wins. */
  rows: TableRowsResult["rows"];
  /** The branch's total, the largest any loaded page reported. */
  total: number;
  /** The first page is pending and has no data yet. */
  isLoading: boolean;
  /** A page after the first is in flight. */
  isFetchingMore: boolean;
  /** The last page failed and has no data. */
  isError: boolean;
  /** The last page has a `next_cursor`. */
  hasMore: boolean;
  /** Asks the next page; a no-op while one is in flight, a retry when the last page failed. */
  loadMore: () => void;
  /** Refetches the failed page. */
  retry: () => void;
}

type PageState = Pick<
  UseQueryResult<TableRowsResult>,
  "data" | "error" | "isLoading" | "isError" | "isFetching" | "dataUpdatedAt" | "refetch"
>;

/**
 * The page fields the hook reads, as plain objects. Module-level on purpose:
 * `useQueries` only keeps its combined result's identity across renders when
 * `combine` is the same function each time; an inline one returns a new array
 * every render, and a caller memoizing on it renders forever.
 */
function pickPageStates(results: readonly PageState[]): PageState[] {
  return results.map(({ data, error, isLoading, isError, isFetching, dataUpdatedAt, refetch }) => ({
    data,
    error,
    isLoading,
    isError,
    isFetching,
    dataUpdatedAt,
    refetch,
  }));
}

const FIRST_PAGE: readonly (string | null)[] = [null];
const NO_ROWS: TableRowsResult["rows"] = [];
const CURSOR_MISMATCH = "cursor_query_mismatch";

type Cursors = Readonly<Record<string, readonly (string | null)[]>>;

interface PreparedBranch {
  key: string;
  /** `key|identity`: where the branch's cursors live, so a changed query reads as page one. */
  stateKey: string;
  enabled: boolean;
  bodies: TableRowsBody[];
}

function branchIdentity(workspaceId: string, body: TableRowsBody): string {
  const { cursor: _cursor, ...rest } = body;
  return JSON.stringify([workspaceId, rest]);
}

function mergeRows(pages: readonly PageState[]): TableRowsResult["rows"] {
  const seen = new Set<string>();
  const rows: TableRowsResult["rows"] = [];
  for (const page of pages) {
    for (const row of page.data?.rows ?? []) {
      if (seen.has(row.task.id)) continue;
      seen.add(row.task.id);
      rows.push(row);
    }
  }
  return rows.length > 0 ? rows : NO_ROWS;
}

/**
 * Cursor paging for many branches of the table API at once — the board's
 * status columns, the table's groups and expanded parents. Every page is its
 * own query (`tableRowsPageQuery`), so pages share the cache with any other
 * reader of the same body, and a branch's cursors are client state tagged with
 * the query they were asked on.
 */
export function useCursorBranches(
  workspaceId: string,
  branches: CursorBranchSpec[],
): { byKey: ReadonlyMap<string, CursorBranchState>; isRefreshing: boolean } {
  const [cursorsByBranch, setCursorsByBranch] = useState<Cursors>({});

  // Callers rebuild `branches` each render; the signature keeps the work below
  // (and its identity) tied to what the branches ask, not to the array.
  const signature = JSON.stringify(
    branches.map((b) => [b.key, branchIdentity(workspaceId, b.body), b.enabled]),
  );
  const branchesRef = useRef(branches);
  branchesRef.current = branches;

  const prepared = useMemo<PreparedBranch[]>(
    () =>
      branchesRef.current.map((b) => {
        const stateKey = `${b.key}|${branchIdentity(workspaceId, b.body)}`;
        const cursors = cursorsByBranch[stateKey] ?? FIRST_PAGE;
        return {
          key: b.key,
          stateKey,
          enabled: b.enabled,
          bodies: cursors.map((cursor) => ({ ...b.body, cursor })),
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `signature` stands for `branches`
    [signature, workspaceId, cursorsByBranch],
  );

  const pageStates = useQueries({
    queries: prepared.flatMap((b) =>
      b.bodies.map((body) => ({
        ...tableRowsPageQuery(workspaceId, body),
        enabled: b.enabled && !!workspaceId,
      })),
    ),
    combine: pickPageStates,
  });

  const resetBranch = useCallback((stateKey: string) => {
    setCursorsByBranch((prev) => {
      if (!(stateKey in prev)) return prev;
      const { [stateKey]: _dropped, ...rest } = prev;
      return rest;
    });
  }, []);

  const pagesOf = useMemo(() => {
    const out = new Map<string, PageState[]>();
    let offset = 0;
    for (const b of prepared) {
      out.set(b.stateKey, pageStates.slice(offset, offset + b.bodies.length));
      offset += b.bodies.length;
    }
    return out;
  }, [prepared, pageStates]);

  // Stale tail: when the first page refetches (an edit, an invalidation), the
  // later pages' cursors point into the old ordering. Drop them.
  const firstPageUpdatedAt = useRef(new Map<string, number>());
  // A 409 error object is acted on once, even while its query retries.
  const handledMismatches = useRef(new WeakSet<object>());
  useEffect(() => {
    for (const b of prepared) {
      const pages = pagesOf.get(b.stateKey) ?? [];
      const first = pages[0];
      if (first && first.dataUpdatedAt > 0) {
        const seen = firstPageUpdatedAt.current.get(b.stateKey);
        firstPageUpdatedAt.current.set(b.stateKey, first.dataUpdatedAt);
        if (seen !== undefined && seen !== first.dataUpdatedAt && pages.length > 1) {
          resetBranch(b.stateKey);
          continue;
        }
      }
      const mismatch = pages
        .slice(1)
        .find(
          (page) =>
            page.error instanceof ApiError &&
            page.error.code === CURSOR_MISMATCH &&
            !handledMismatches.current.has(page.error),
        );
      if (mismatch?.error) {
        handledMismatches.current.add(mismatch.error);
        resetBranch(b.stateKey);
      }
    }
  }, [prepared, pagesOf, resetBranch]);

  const byKey = useMemo(() => {
    const map = new Map<string, CursorBranchState>();
    for (const b of prepared) {
      const pages = pagesOf.get(b.stateKey) ?? [];
      const first = pages[0];
      const last = pages[pages.length - 1];
      const cursors = b.bodies.map((body) => body.cursor);
      const nextCursor = last?.data?.next_cursor ?? null;
      const retry = () => {
        for (const page of pages) {
          if (page.isError) void page.refetch();
        }
      };
      map.set(b.key, {
        key: b.key,
        rows: mergeRows(pages),
        total: pages.reduce((max, page) => Math.max(max, page.data?.total ?? 0), 0),
        isLoading: !!first?.isLoading && first.data === undefined,
        isFetchingMore: pages.length > 1 && !!last?.isFetching,
        isError: !!last?.isError && last.data === undefined,
        hasMore: nextCursor !== null,
        loadMore: () => {
          if (!b.enabled || !last || last.isFetching) return;
          if (last.isError) {
            void last.refetch();
            return;
          }
          if (nextCursor === null || cursors.includes(nextCursor)) return;
          setCursorsByBranch((prev) => {
            const current = prev[b.stateKey] ?? FIRST_PAGE;
            if (current.includes(nextCursor)) return prev;
            return { ...prev, [b.stateKey]: [...current, nextCursor] };
          });
        },
        retry,
      });
    }
    return map;
  }, [prepared, pagesOf]);

  const isRefreshing = pageStates.some((page) => page.isFetching && page.data !== undefined);

  return { byKey, isRefreshing };
}
