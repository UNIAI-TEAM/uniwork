"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DrivePickerAdapter } from "../../integrations/drive-picker";
import { useNameDriveFolderFlow } from "./use-name-drive-folder-flow";

interface NameFolderRequest {
  folderId: string;
  connectionId: string;
  /** Distinguishes two requests for the same folder. */
  seq: number;
}

/**
 * Asks for "Name this folder" without mounting the Picker machinery (connections query, token,
 * dialogs) before anyone asks: `request` stays null until `launch` is called, and only then does the
 * screen render `NameDriveFolderHost`.
 */
export function useNameFolderLauncher(): {
  request: NameFolderRequest | null;
  launch: (folderId: string, connectionId: string) => void;
} {
  const [request, setRequest] = useState<NameFolderRequest | null>(null);
  const launch = useCallback(
    (folderId: string, connectionId: string) =>
      setRequest((prev) => ({ folderId, connectionId, seq: (prev?.seq ?? 0) + 1 })),
    [],
  );
  return { request, launch };
}

/** Runs each new request through the "Name this folder" flow and keeps its dialogs on screen. */
export function NameDriveFolderHost({
  wsId,
  request,
  adapter,
}: {
  wsId: string;
  request: NameFolderRequest;
  adapter?: DrivePickerAdapter;
}) {
  const { nameFolder, dialogs } = useNameDriveFolderFlow(wsId, adapter);
  const handledRef = useRef(0);
  useEffect(() => {
    if (handledRef.current === request.seq) return;
    handledRef.current = request.seq;
    nameFolder(request.folderId, request.connectionId);
  }, [request, nameFolder]);
  return <>{dialogs}</>;
}
