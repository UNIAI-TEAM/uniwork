import type {
  DesktopIpcChannel,
  DesktopIpcRequest,
  DesktopLibraryDocument,
  DesktopLibraryResponse,
} from "../../shared/ipc";
import { isDesktopDocumentFormat } from "../../shared/document-formats";

export type LibraryMode = "list" | "recent" | "search";
export type LibraryScope = Readonly<{
  deploymentId: string;
  accountId: string;
  organizationId: string;
  workspaceId: string;
  sessionGeneration: string;
}>;

export type LibraryBridge = Readonly<{
  call<C extends DesktopIpcChannel>(channel: C, payload: DesktopIpcRequest<C>): Promise<unknown>;
}>;

/** A Work Product is a task-owned artifact and never belongs in Documents.
 * Keep this filter in the desktop host as a second line of defence even when
 * the server already scopes the query. Unknown rows are dropped closed. */
export function filterLibraryDocuments(documents: readonly DesktopLibraryDocument[]): DesktopLibraryDocument[] {
  return documents.filter((document) => document.kind === "file" && isDesktopDocumentFormat(document.format) && document.ownerKind !== "work_product");
}

export function canDownloadDocument(document: DesktopLibraryDocument, engineAvailable: boolean): boolean {
  return document.downloadAvailable && (engineAvailable || isDesktopDocumentFormat(document.format));
}

/** Scope changes must invalidate the query cache before the next list is
 * rendered. A generation token rejects late responses from the old account,
 * deployment, org or workspace. */
export function createLibraryScopeController(initial: LibraryScope, clearQueryCache: () => void = () => undefined) {
  let scope = initial;
  let generation = 0;
  return {
    getScope: () => scope,
    getGeneration: () => generation,
    switchScope(next: LibraryScope): number {
      clearQueryCache();
      generation += 1;
      scope = next;
      return generation;
    },
    isCurrent(candidate: number): boolean { return candidate === generation; },
  };
}

export type LibraryResult = DesktopLibraryResponse & { readonly generation: number };

/** Typed desktop queries. The method verifies response shape at the IPC
 * boundary and applies the ownership filter before data reaches the view. */
export function createLibraryController(bridge: LibraryBridge, scopeController: ReturnType<typeof createLibraryScopeController>) {
  async function query(mode: LibraryMode, queryText?: string, cursor?: string): Promise<LibraryResult> {
    const scope = scopeController.getScope();
    const generation = scopeController.getGeneration();
    const channel: DesktopIpcChannel = mode === "list" ? "desktop:library-list" : mode === "recent" ? "desktop:library-recent" : "desktop:library-search";
    const payload = mode === "search"
      ? { sessionGeneration: scope.sessionGeneration, workspaceId: scope.workspaceId, query: queryText ?? "", ...(cursor ? { cursor } : {}) }
      : { sessionGeneration: scope.sessionGeneration, workspaceId: scope.workspaceId, ...(cursor ? { cursor } : {}) };
    const raw = await bridge.call(channel as never, payload as never) as DesktopLibraryResponse;
    if (!scopeController.isCurrent(generation)) {
      return { documents: [], nextCursor: null, engineAvailable: false, generation };
    }
    return { ...raw, documents: filterLibraryDocuments(raw.documents), generation };
  }
  return Object.freeze({ list: (cursor?: string) => query("list", undefined, cursor), recent: (cursor?: string) => query("recent", undefined, cursor), search: (queryText: string, cursor?: string) => query("search", queryText, cursor) });
}
