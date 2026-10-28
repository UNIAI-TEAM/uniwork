"use client";

import { useFolderAccessBatchShown, useFolderAccessBatchStore, useTrackedFolderAccessBatches, type TrackedFolderAccessBatch } from "@uniwork/core/documents/folder-access-batches";
import { FolderContentsAccessWatcher } from "../documents/folder-contents-access-progress";

function BatchWatcher({ batch }: { batch: TrackedFolderAccessBatch }) {
  const settle = useFolderAccessBatchStore((state) => state.settle);
  const inDialog = useFolderAccessBatchShown(batch.wsId, batch.batchId);
  return <FolderContentsAccessWatcher wsId={batch.wsId} folderId={batch.folderId} batchId={batch.batchId} inDialog={inDialog} onSettled={(batchId) => settle(batch.wsId, batchId)} />;
}

/**
 * One watcher per background folder access batch of this workspace, mounted by
 * the workspace shell so it survives navigation between modules: the poll keeps
 * running and the "applied" / "failed" toast still lands after the page that
 * started the batch is gone. Only the open workspace is watched; a batch of
 * another workspace stays in the store and is picked up again (one toast) when
 * that workspace is opened, instead of toasting into the wrong one.
 */
export function FolderAccessBatchWatchers({ wsId }: { wsId: string }) {
  const batches = useTrackedFolderAccessBatches(wsId);
  return (
    <>
      {batches.map((batch) => (
        <BatchWatcher key={batch.batchId} batch={batch} />
      ))}
    </>
  );
}
