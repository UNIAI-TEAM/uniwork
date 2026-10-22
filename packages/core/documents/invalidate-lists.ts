import type { QueryClient } from "@tanstack/react-query";
import { documentKeys } from "./keys";

/**
 * Refresh every list a library row is read from: home and folder pages,
 * Recent, Shared with me, Shared by me and Lưu trữ (Starred reads the home
 * root and cached rows). A row carries `share_scope` and `my_level`, which an
 * access change moves, so the Access cell of any open list is stale until
 * its root refetches. The roots are prefixes of every filtered entry.
 */
export function invalidateDocumentLists(qc: QueryClient, wsId: string): Promise<unknown> {
  return Promise.all([
    qc.invalidateQueries({ queryKey: documentKeys.listRoot(wsId) }),
    qc.invalidateQueries({ queryKey: documentKeys.recent(wsId) }),
    qc.invalidateQueries({ queryKey: documentKeys.sharedWithMe(wsId) }),
    qc.invalidateQueries({ queryKey: documentKeys.sharedByMe(wsId) }),
    qc.invalidateQueries({ queryKey: documentKeys.shelved(wsId) }),
  ]);
}
