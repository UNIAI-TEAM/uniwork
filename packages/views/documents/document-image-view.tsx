"use client";

import { useEffect, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { documents as documentApi } from "@uniwork/core/api";
import { documentKeys } from "@uniwork/core/documents/keys";
import { cn } from "@uniwork/ui/lib/utils";
import { assetIdFromSrc } from "./document-asset";
import { useDocumentAssetScope } from "./document-asset-context";

/**
 * Tiptap NodeView for a page image.
 *
 * The document holds `asset://{id}`. The bytes come through the authenticated
 * Go proxy and are handed to the <img> as an object URL that lives only as long
 * as this view — nothing here is ever written back into the JSON. While an
 * upload or the fetch is in flight the node draws its own placeholder instead
 * of a broken image.
 */
export function DocumentImageView({ node, selected }: NodeViewProps) {
  const { t } = useTranslation();
  const scope = useDocumentAssetScope();
  const src = (node.attrs.src as string | null) ?? "";
  const alt = (node.attrs.alt as string | null) ?? "";
  const width = (node.attrs.width as number | null) ?? undefined;
  const height = (node.attrs.height as number | null) ?? undefined;
  const uploading = node.attrs.uploading === true;
  const assetId = assetIdFromSrc(src);

  const asset = useQuery({
    queryKey: scope && assetId
      ? [...documentKeys.detail(scope.wsId, scope.documentId), "asset", assetId]
      : ["documents", "asset", "idle"],
    queryFn: ({ signal }) => documentApi.getDocumentAsset(scope!.documentId, assetId!, signal),
    enabled: !!scope && !!assetId,
    // Bytes behind one asset id never change; only the object URL is local.
    staleTime: Infinity,
    retry: false,
  });

  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  useEffect(() => {
    const blob = asset.data;
    if (!blob || typeof URL.createObjectURL !== "function") {
      setObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(blob);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [asset.data]);

  const resolved = assetId ? objectUrl : src;
  const pending = !resolved && (uploading || !!assetId);

  return (
    <NodeViewWrapper
      as="span"
      className={cn(
        "relative inline-block max-w-full align-bottom",
        selected && "rounded-md ring-2 ring-ring",
      )}
    >
      {resolved ? (
        <img
          src={resolved}
          alt={alt}
          width={width}
          height={height}
          draggable={false}
          data-document-asset={assetId ?? undefined}
          className="max-w-full rounded-md"
        />
      ) : pending ? (
        <span
          role="status"
          className="inline-flex min-h-16 min-w-32 items-center justify-center rounded-md border border-dashed border-border bg-muted px-3 py-4 text-caption text-muted-foreground"
        >
          {asset.isError
            ? t("documents.editor.asset_load_failed")
            : t("documents.editor.asset_uploading")}
        </span>
      ) : (
        <span className="text-caption text-muted-foreground">{alt}</span>
      )}
    </NodeViewWrapper>
  );
}
