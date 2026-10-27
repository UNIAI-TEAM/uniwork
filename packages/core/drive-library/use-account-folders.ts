"use client";

import { useEffect, useMemo } from "react";
import type { DriveFile } from "../api/endpoints/drive-library";
import {
  deriveDriveFolders,
  driveFoldersFromGroups,
  type DriveFolderEntry,
} from "./folders";
import { useDriveFiles, useDriveFolders } from "./hooks";

/** Page walk bound: past it the account is treated as incomplete rather than shown as a partial tree. */
const MAX_ACCOUNT_PAGES = 40;

interface UseDriveAccountFoldersOpts {
  enabled?: boolean;
  /** Locale of the folder order (named A-Z). */
  locale?: string;
  /**
   * Also load every file of the account (default true): the account view and a folder view need
   * them, the sidebar tree does not. With the server folder list unavailable the files are loaded
   * anyway, because folders are then derived from them.
   */
  withFiles?: boolean;
}

interface DriveAccountFolders {
  /** Named A-Z (numeric collator), then unnamed by id. */
  folders: DriveFolderEntry[];
  /** Files with no known parent folder, in incoming order; empty until the files are loaded. */
  unfiled: DriveFile[];
  /** Every file of the account, all pages; empty until loaded (and while `withFiles` is off and the server list serves). */
  files: DriveFile[];
  /** Nothing to show yet: the folder list, or the first page of files when those are needed. */
  isPending: boolean;
  /** Pages are still being fetched, so `files` can still grow (and derived folders with them). */
  isLoadingMore: boolean;
  /** Fetching a later page failed: what is loaded stays usable, `retryLoadMore` continues the walk. */
  isLoadMoreError: boolean;
  isError: boolean;
  refetch: () => void;
  retryLoadMore: () => void;
}

/**
 * The folders of one connected Drive account (drive-folder contract v3). The server folder list
 * (`GET .../drive-folders`, one request) names the folders and counts them; the account's files
 * still come from walking its cursor-paginated list, since the server has no folder filter, and
 * `unfiled` and a folder's files are picked from them on the client. When the server has no folder
 * list (an older server, or the request failed) the folders are derived from the files as in
 * contract v2, so the screens keep working.
 */
export function useDriveAccountFolders(
  wsId: string,
  connectionId: string | null,
  opts?: UseDriveAccountFoldersOpts,
): DriveAccountFolders {
  const active = (opts?.enabled ?? true) && Boolean(connectionId);
  const foldersQuery = useDriveFolders(wsId, connectionId, { enabled: active });
  const groups = foldersQuery.data ?? null;
  const serverList = groups !== null;
  // Settled without a list: null answer, or the request failed with nothing cached.
  const derive = active && !serverList && (foldersQuery.isError || foldersQuery.data === null);
  const walk = active && ((opts?.withFiles ?? true) || derive);

  const query = useDriveFiles(wsId, { connectionId, enabled: walk });
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = query;
  const pages = query.data?.pages;
  const pageCount = pages?.length ?? 0;
  const capped = Boolean(hasNextPage) && pageCount >= MAX_ACCOUNT_PAGES;

  useEffect(() => {
    if (walk && hasNextPage && !capped && !isFetchingNextPage && !isFetchNextPageError) {
      void fetchNextPage();
    }
    // pageCount re-runs the walk when a fast page lands between two renders and the flags look unchanged.
  }, [walk, hasNextPage, capped, pageCount, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  const files = useMemo(() => (capped ? [] : pages?.flatMap((p) => p.files) ?? []), [pages, capped]);
  const derived = useMemo(() => deriveDriveFolders(files, opts?.locale), [files, opts?.locale]);
  const fromServer = useMemo(
    () => (groups ? driveFoldersFromGroups(groups, opts?.locale) : []),
    [groups, opts?.locale],
  );
  const unfiled = useMemo(
    () => (serverList ? files.filter((f) => !f.drive_folder?.id) : derived.unfiled),
    [serverList, files, derived.unfiled],
  );
  const { refetch: refetchFiles } = query;
  const { refetch: refetchFolders } = foldersQuery;

  return {
    folders: serverList ? fromServer : derived.folders,
    unfiled,
    files,
    isPending: active && ((!serverList && foldersQuery.isPending) || (walk && query.isPending)),
    isLoadingMore: walk && Boolean(hasNextPage) && !capped && !isFetchNextPageError,
    isLoadMoreError: walk && isFetchNextPageError,
    isError: walk && (query.isError || capped),
    refetch: () => {
      if (active) void refetchFolders();
      if (walk) void refetchFiles();
    },
    retryLoadMore: () => void fetchNextPage(),
  };
}
