import { useCallback, useState } from "react";
import { useAuthStore } from "@uniwork/core/auth";
import {
  readCollapsedFolderGroups,
  readGroupByFolder,
  writeCollapsedFolderGroups,
  writeGroupByFolder,
} from "@uniwork/core/drive-library/folder-group-prefs";

export interface DriveFolderGrouping {
  groupByFolder: boolean;
  setGroupByFolder: (on: boolean) => void;
  isCollapsed: (key: string) => boolean;
  toggleCollapsed: (key: string) => void;
}

/**
 * The signed-in viewer's "Group by folder" choice (remembered, default on) and which folder groups
 * they collapsed (remembered for the browser session). Both read through the core StorageAdapter helpers.
 */
export function useDriveFolderGrouping(): DriveFolderGrouping {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const read = (id: string | null) => ({
    userId: id,
    on: readGroupByFolder(id),
    collapsed: readCollapsedFolderGroups(id),
  });
  const [state, setState] = useState(() => read(userId));
  if (state.userId !== userId) setState(read(userId));

  const setGroupByFolder = useCallback((on: boolean) => {
    setState((prev) => {
      writeGroupByFolder(prev.userId, on);
      return { ...prev, on };
    });
  }, []);
  const toggleCollapsed = useCallback((key: string) => {
    setState((prev) => {
      const collapsed = prev.collapsed.includes(key)
        ? prev.collapsed.filter((k) => k !== key)
        : [...prev.collapsed, key];
      writeCollapsedFolderGroups(prev.userId, collapsed);
      return { ...prev, collapsed };
    });
  }, []);
  return {
    groupByFolder: state.on,
    setGroupByFolder,
    isCollapsed: (key) => state.collapsed.includes(key),
    toggleCollapsed,
  };
}
