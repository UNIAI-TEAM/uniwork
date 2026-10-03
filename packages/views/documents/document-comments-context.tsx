"use client";

import { createContext, use, useCallback, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFlag } from "@uniwork/core/feature-flags";
import type { Document } from "@uniwork/core/types/document";
import { Button } from "@uniwork/ui/components/ui/button";
import { useHeaderActionsSlotFilled } from "../layout/header-actions-slot";
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
  /** The header trigger; closing the panel hands focus back to it. */
  triggerRef: RefObject<HTMLButtonElement | null>;
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
  const [open, setOpenState] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Closing from inside the panel must land focus back on the control that
  // opened it (the Sheet path restores it on its own; the inline rail does
  // not). Opening keeps the natural focus on the trigger.
  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    if (!next) triggerRef.current?.focus();
  }, []);
  const value = useMemo(
    () => ({ wsId, doc, open, setOpen, triggerRef }),
    [wsId, doc, open, setOpen],
  );
  return (
    <DocumentCommentsChromeContext.Provider value={value}>
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
  // With an embedded editor cluster in the header, a phone keeps title + Save
  // + ⋯ only; the overflow menu then carries the Comments entry.
  const folded = useHeaderActionsSlotFilled();
  if (!chrome || !enabled) return null;
  // The document payload carries the organization; the workspace context is
  // the fallback for a server that omitted it.
  const orgId = chrome.doc.organization_id || workspace?.workspace.organization_id || "";
  return (
    <div className={folded ? "hidden shrink-0 items-center gap-1 sm:flex" : "contents"} data-document-comments-actions>
      <DocumentFavoriteToggle documentId={chrome.doc.id} orgId={orgId} />
      <Button
        ref={chrome.triggerRef}
        type="button"
        variant="ghost"
        size="sm"
        aria-label={t("documents.comments.open")}
        aria-expanded={chrome.open}
        aria-controls="document-comments-panel"
        onClick={() => chrome.setOpen(!chrome.open)}
      >
        <MessageSquare aria-hidden className="size-4" />
        <span className="hidden sm:inline">{t("documents.comments.open")}</span>
      </Button>
    </div>
  );
}
