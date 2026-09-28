"use client";

import { createContext, use, useState, type ReactNode } from "react";
import { MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFlag } from "@uniwork/core/feature-flags";
import type { Document } from "@uniwork/core/types/document";
import { Button } from "@uniwork/ui/components/ui/button";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { DocumentFavoriteToggle } from "./document-favorite-toggle";

/**
 * The open/closed state of the document comments panel, shared between the
 * detail view (which owns the panel column/sheet) and the detail header
 * (which owns the trigger button). Kept in a context local to the documents
 * package so mounting one without the other is a no-op instead of a crash —
 * `DocumentDetailView` always supplies the provider, other hosts (tests,
 * story mounts) simply get no trigger.
 */
interface DocumentCommentsChrome {
  wsId: string;
  doc: Document;
  open: boolean;
  setOpen: (open: boolean) => void;
}

const DocumentCommentsChromeContext = createContext<DocumentCommentsChrome | null>(null);

export function DocumentCommentsProvider({
  wsId,
  doc,
  children,
}: {
  wsId: string;
  doc: Document;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <DocumentCommentsChromeContext.Provider value={{ wsId, doc, open, setOpen }}>
      {children}
    </DocumentCommentsChromeContext.Provider>
  );
}

/** Null outside the detail view — the header trigger is simply not rendered then. */
export function useDocumentCommentsChrome(): DocumentCommentsChrome | null {
  return use(DocumentCommentsChromeContext);
}

/**
 * The detail header's two G1-07c controls: the favorite star and the comments
 * panel trigger. Rendered from `document-workspace.tsx` (the header owns the
 * actions slot there); renders nothing when the provider is absent so the
 * workspace keeps working standalone.
 */
export function DocumentCommentsHeaderActions() {
  const chrome = useDocumentCommentsChrome();
  const workspace = useOptionalWorkspace();
  const enabled = useFlag("documents", false);
  const { t } = useTranslation();
  if (!chrome || !enabled) return null;
  // The document payload carries the organization; the workspace context is
  // the fallback for a server that omitted it.
  const orgId = chrome.doc.organization_id || workspace?.workspace.organization_id || "";
  return (
    <>
      <DocumentFavoriteToggle documentId={chrome.doc.id} orgId={orgId} />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={chrome.open}
        aria-controls="document-comments-panel"
        onClick={() => chrome.setOpen(!chrome.open)}
      >
        <MessageSquare aria-hidden className="size-4" />
        <span className="hidden sm:inline">{t("documents.comments.open")}</span>
      </Button>
    </>
  );
}
