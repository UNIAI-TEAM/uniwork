"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AssetManifestLike, AssetStatus } from "../../asset-manifest";
import type { ImageAssetPort } from "./image-resolve";

/**
 * The manifest + host port an image node resolves against.
 *
 * The Markdown WYSIWYG canvas provides it once; the image NodeView reads it so
 * a node never threads ids through props. The manifest is the ONLY resolution
 * input and the port is the ONLY way to a display URL — the view holds neither
 * a transport nor a bucket/key/path.
 */
export interface MarkdownImageScope {
  manifest: AssetManifestLike | null;
  /** Host port: asset id -> display URL. Absent outside a host. */
  port?: ImageAssetPort;
  /** Recorded upload failures, keyed by the authored name/path. */
  failures?: Readonly<Record<string, AssetStatus | boolean>>;
  /** Called when a paste/drop upload fails, so the doc stays unsavable. */
  onAssetFailure?: (name: string, status: AssetStatus) => void;
}

const MarkdownImageScopeContext = createContext<MarkdownImageScope | null>(null);

export function MarkdownImageScopeProvider({
  scope,
  children,
}: {
  scope: MarkdownImageScope;
  children: ReactNode;
}) {
  return (
    <MarkdownImageScopeContext.Provider value={scope}>
      {children}
    </MarkdownImageScopeContext.Provider>
  );
}

/** Outside a provider an image has nothing to resolve against. */
export function useMarkdownImageScope(): MarkdownImageScope {
  return useContext(MarkdownImageScopeContext) ?? { manifest: null };
}
