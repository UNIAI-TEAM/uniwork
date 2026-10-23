"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * The (workspace, document) pair an `asset://{id}` in a page resolves
 * against. The editor provides it once around the canvas; the image NodeView
 * reads it so a nested node never has to thread ids through props.
 */
export interface DocumentAssetScope {
  wsId: string;
  documentId: string;
}

const DocumentAssetScopeContext = createContext<DocumentAssetScope | null>(null);

export function DocumentAssetScopeProvider({
  scope,
  children,
}: {
  scope: DocumentAssetScope;
  children: ReactNode;
}) {
  return (
    <DocumentAssetScopeContext.Provider value={scope}>
      {children}
    </DocumentAssetScopeContext.Provider>
  );
}

/** null outside a document editor: a stray image has nothing to resolve. */
export function useDocumentAssetScope(): DocumentAssetScope | null {
  return useContext(DocumentAssetScopeContext);
}
