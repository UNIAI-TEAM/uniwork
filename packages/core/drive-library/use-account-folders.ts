"use client";

import { useEffect, useMemo } from "react";
import type { DriveFile } from "../api/endpoints/drive-library";
import { deriveDriveFolders, type DriveFolderDerivation } from "./folders";
import { useDriveFiles } from "./hooks";

/** Page walk bound: past it the account is treated as incomplete rather than shown as a partial tree. */
const MAX_ACCOUNT_PAGES = 40;

interface UseDriveAccountFoldersOpts {
  enabled?: boolean;
  /** Locale of the folder order (named A-Z). */
  locale?: string;
}

interface DriveAccountFolders extends DriveFolderDerivation<DriveFile> {
  /** Every file of the account, all pages. */
  files: DriveFile[];
  /** The first page has not arrived. */
  isPending: boolean;
  /** Pages are still being fetched, so folders and counts can still grow. */
  isLoadingMore: boolean;
  /** Fetching a later page failed: what is loaded stays usable, `retryLoadMore` continues the walk. */
  isLoadMoreError: boolean;
  isError: boolean;
  refetch: () => void;
  retryLoadMore: () => void;
}

/**
 * The folders of one connected Drive account, derived from its files (drive-folder contract v2).
 * The files list is cursor-paginated and has no folder filter yet, so this walks every page of the
 * account's list (the same cache entry the account list screen reads) and derives folders from
 * `drive_folder`. It is the single seam for the folder tree: a server folder list or a
 * `drive_folder_id` filter replaces the body of this hook, not its callers.
 */
export function useDriveAccountFolders(
  wsId: string,
  connectionId: string | null,
  opts?: UseDriveAccountFoldersOpts,
): DriveAccountFolders {
  const enabled = (opts?.enabled ?? true) && Boolean(connectionId);
  const query = useDriveFiles(wsId, { connectionId, enabled });
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = query;
  const pages = query.data?.pages;
  const pageCount = pages?.length ?? 0;
  const capped = Boolean(hasNextPage) && pageCount >= MAX_ACCOUNT_PAGES;

  useEffect(() => {
    if (enabled && hasNextPage && !capped && !isFetchingNextPage && !isFetchNextPageError) {
      void fetchNextPage();
    }
    // pageCount re-runs the walk when a fast page lands between two renders and the flags look unchanged.
  }, [enabled, hasNextPage, capped, pageCount, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  const files = useMemo(() => (capped ? [] : pages?.flatMap((p) => p.files) ?? []), [pages, capped]);
  const derived = useMemo(() => deriveDriveFolders(files, opts?.locale), [files, opts?.locale]);
  const { refetch } = query;

  return {
    ...derived,
    files,
    isPending: enabled && query.isPending,
    isLoadingMore: Boolean(hasNextPage) && !capped && !isFetchNextPageError,
    isLoadMoreError: isFetchNextPageError,
    isError: query.isError || capped,
    refetch: () => void refetch(),
    retryLoadMore: () => void fetchNextPage(),
  };
}
