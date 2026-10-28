"use client";

import { useMemo } from "react";
import { driveFoldersFromGroups, type DriveFolderEntry } from "./folders";
import { useDriveFolders } from "./hooks";

interface UseDriveAccountFoldersOpts {
  enabled?: boolean;
  /** Locale of the folder order (named A-Z). */
  locale?: string;
}

interface DriveAccountFolders {
  /** Named A-Z (numeric collator), then unnamed by id. Counts are the server's `file_count`. */
  folders: DriveFolderEntry[];
  /** Nothing to show yet: the folder list has not answered. */
  isPending: boolean;
  /** The request failed, or the answer carried no folder list. */
  isError: boolean;
  refetch: () => void;
}

/**
 * The folders of one connected Drive account, from the server folder list (`GET .../drive-folders`,
 * one request). The files of an account node or of one folder are not read here: they come from
 * `useDriveFiles` with `driveFolderId`, which the server filters, counts and pages.
 */
export function useDriveAccountFolders(
  wsId: string,
  connectionId: string | null,
  opts?: UseDriveAccountFoldersOpts,
): DriveAccountFolders {
  const active = (opts?.enabled ?? true) && Boolean(connectionId);
  const query = useDriveFolders(wsId, connectionId, { enabled: active });
  const groups = query.data ?? null;
  const folders = useMemo(
    () => (groups ? driveFoldersFromGroups(groups, opts?.locale) : []),
    [groups, opts?.locale],
  );
  const { refetch } = query;

  return {
    folders,
    isPending: active && query.isPending,
    // A settled answer with no list is as unusable as a failed request: the tree cannot be built.
    isError: active && (query.isError || query.data === null),
    refetch: () => {
      if (active) void refetch();
    },
  };
}
