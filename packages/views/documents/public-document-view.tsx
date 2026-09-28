"use client";

import { useMemo } from "react";
import Image from "@tiptap/extension-image";
import { Extension, type JSONContent } from "@tiptap/core";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps } from "@tiptap/react";
import { Download, Link2, RotateCw, ShieldOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { documentPublic } from "@uniwork/core/api";
import { usePublicDocument } from "@uniwork/core/documents/hooks-public";
import type { PublicDocument } from "@uniwork/core/types/document";
import { Button, ButtonLink } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { createPageDocumentExtensions } from "../editor/extensions";
import { assetIdFromSrc } from "./document-asset";

export interface PublicDocumentViewProps {
  /** The link token from the URL; it is the only credential this view has. */
  token: string;
}

/** The read-only upload slot the page extension factory requires; it never
 *  runs here because the editor is not editable and paste/drop are inert. */
const InertAssetUpload = Extension.create({ name: "publicInertAssetUpload" });

/** Width/height are part of the page schema; everything else is the stock image. */
function publicImageExtension(token: string) {
  function PublicAssetImage({ node }: NodeViewProps) {
    const src = String(node.attrs.src ?? "");
    const assetId = assetIdFromSrc(src);
    const alt = String(node.attrs.alt ?? "");
    const width = node.attrs.width as number | null;
    const height = node.attrs.height as number | null;
    if (!assetId) {
      // A src the contract does not define is not fetched from anywhere: the
      // alt text is all a reader gets, never an arbitrary URL.
      return alt ? <span className="text-caption text-muted-foreground">{alt}</span> : null;
    }
    return (
      <NodeViewWrapper as="span" className="relative inline-block max-w-full align-bottom">
        <img
          src={documentPublic.publicDocumentAssetPath(token, assetId)}
          alt={alt}
          width={width ?? undefined}
          height={height ?? undefined}
          loading="lazy"
          className="max-w-full rounded-md"
        />
      </NodeViewWrapper>
    );
  }

  return Image.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        width: {
          default: null,
          renderHTML: (attrs: Record<string, unknown>) =>
            attrs.width ? { width: attrs.width as number } : {},
          parseHTML: (el: HTMLElement) => {
            const w = parseInt(el.getAttribute("width") || "", 10);
            return Number.isFinite(w) ? w : null;
          },
        },
        height: { default: null, rendered: false },
      };
    },
    addNodeView() {
      return ReactNodeViewRenderer(PublicAssetImage);
    },
  }).configure({ inline: true, allowBase64: false });
}

/**
 * `/share/{token}` — the anonymous read-only document (C-01 §5.3; G1-08,
 * UNI-682). No app session, no workspace shell: the token is the credential
 * and every refusal (unknown, revoked, expired, switch off, organization flag
 * off) is the same not-found screen, so the page never confirms a document
 * exists to someone without the link.
 *
 * A page renders its sanitized JSON read-only, and its images resolve through
 * the token-scoped asset route — never the authenticated one. A file is
 * download-only: HTML and other formats are never rendered inline from the
 * app origin.
 */
export function PublicDocumentView({ token }: PublicDocumentViewProps) {
  const { t } = useTranslation();
  const query = usePublicDocument(token);

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3 sm:px-8">
        <Link2 aria-hidden className="size-4 text-muted-foreground" />
        <span className="text-caption text-muted-foreground">{t("documents.public.shared_via")}</span>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-6 sm:px-8 sm:py-10">
        {query.isPending ? (
          <div className="space-y-4" aria-busy="true">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : !query.data ? (
          <div className="mx-auto mt-10 flex max-w-md flex-col items-center gap-3 text-center">
            <ShieldOff aria-hidden className="size-8 text-muted-foreground" />
            <h1 className="text-title-sm font-medium text-foreground">
              {t("documents.public.not_found_title")}
            </h1>
            <p className="text-body text-muted-foreground">{t("documents.public.not_found_description")}</p>
            {query.isError ? (
              <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
                <RotateCw aria-hidden className="size-3.5" />
                {t("documents.public.retry")}
              </Button>
            ) : null}
          </div>
        ) : (
          <PublicDocumentBody token={token} document={query.data} />
        )}
      </main>
    </div>
  );
}

function PublicDocumentBody({ token, document: doc }: { token: string; document: PublicDocument }) {
  const { t } = useTranslation();
  const title = doc.title || t("documents.public.untitled");

  if (doc.kind === "page") {
    return (
      <article className="flex flex-col gap-4">
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {doc.content ? (
          <PublicPageContent token={token} content={doc.content} />
        ) : (
          <p className="text-body text-muted-foreground">{t("documents.public.content_empty")}</p>
        )}
      </article>
    );
  }

  const href = doc.download_url ?? documentPublic.publicDocumentDownloadPath(token);
  return (
    <article className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
      <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
        <div>
          <p className="text-body font-medium text-foreground">{t("documents.public.file_title")}</p>
          <p className="text-caption text-muted-foreground">{t("documents.public.file_hint")}</p>
        </div>
        <div>
          {/* A plain anchor: the token route needs no bearer header, and the
              browser's download handling keeps the bytes off this origin. */}
          <ButtonLink href={href} download rel="noopener">
            <Download aria-hidden className="size-3.5" />
            {t("documents.public.file_download")}
          </ButtonLink>
        </div>
      </div>
    </article>
  );
}

function PublicPageContent({ token, content }: { token: string; content: unknown }) {
  const extensions = useMemo(
    () =>
      createPageDocumentExtensions({
        image: publicImageExtension(token),
        assetUpload: InertAssetUpload,
        placeholder: "",
      }),
    [token],
  );
  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    content: content as JSONContent,
    extensions,
  });

  return (
    <div className="rounded-xl border border-border bg-surface p-4 sm:p-6">
      {editor ? (
        <EditorContent editor={editor} className="rich-text-editor text-body" />
      ) : (
        <Skeleton className="h-40 w-full" />
      )}
    </div>
  );
}
