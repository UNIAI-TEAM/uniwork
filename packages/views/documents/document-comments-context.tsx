"use client";

import { createContext, use, useCallback, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFlag } from "@uniwork/core/feature-flags";
import type { Document } from "@uniwork/core/types/document";
import { Button } from "@uniwork/ui/components/ui/button";
import { useHeaderActionsSlotFilled } from "../layout/header-actions-slot";
import { useOptionalNavigation } from "../navigation";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { K } from "./document-comments-keys";
import { anchorableFormat } from "./document-comments-model";
import { DocumentFavoriteToggle } from "./document-favorite-toggle";

/** The panel's two regions (S12 Comments with anchors, S13 Discussion). */
export type DocumentCommentsTab = "comment" | "discussion";

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
  tab: DocumentCommentsTab;
  setTab: (tab: DocumentCommentsTab) => void;
  /** The comment a `?comment=` link names, or "". */
  deepLinkId: string;
}

/**
 * The panel's name: Comments for a format whose comments carry an anchor
 * (that panel holds the Discussion as its second tab), Discussion for every
 * other document (Foundation G8: no Comments tab without an editor anchor).
 */
export function documentCommentsTitleKey(doc: Pick<Document, "kind" | "file">): string {
  return anchorableFormat(doc) ? K.collabComments : K.collabDiscussion;
}

const DocumentCommentsChromeContext = createContext<DocumentCommentsChrome | null>(null);
const FrameCommentsReportContext = createContext<((framePanel: boolean) => void) | undefined>(undefined);

export function DocumentCommentsProvider({
  wsId,
  doc,
  children,
}: {
  wsId: string;
  doc: Document;
  children: ReactNode;
}) {
  const nav = useOptionalNavigation();
  const deepLinkId = nav?.searchParams.get("comment") ?? "";
  // A deep link opens the panel on arrival; the panel then picks the tab that holds the thread.
  const [open, setOpenState] = useState(() => deepLinkId !== "");
  const [tab, setTab] = useState<DocumentCommentsTab>(() => (anchorableFormat(doc) ? "comment" : "discussion"));
  // The editor frame answered `init` with `comments` (G8-08): its panel is this page's only
  // comments panel (invariant 8), so neither the trigger nor DocumentCommentsPanel render.
  const [framePanel, setFramePanel] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Closing from inside the panel must land focus back on the control that
  // opened it (the Sheet path restores it on its own; the inline rail does
  // not). Opening keeps the natural focus on the trigger.
  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    if (!next) triggerRef.current?.focus();
  }, []);
  const value = useMemo(
    () => (framePanel ? null : { wsId, doc, open, setOpen, triggerRef, tab, setTab, deepLinkId }),
    [framePanel, wsId, doc, open, setOpen, tab, deepLinkId],
  );
  return (
    <FrameCommentsReportContext.Provider value={setFramePanel}>
      <DocumentCommentsChromeContext.Provider value={value}>
        {children}
      </DocumentCommentsChromeContext.Provider>
    </FrameCommentsReportContext.Provider>
  );
}

/**
 * Null outside the detail view, and null while an editor frame owns the
 * comments (invariant 8) — the trigger, the menu entry and the panel are then
 * simply not rendered.
 */
export function useDocumentCommentsChrome(): DocumentCommentsChrome | null {
  return use(DocumentCommentsChromeContext);
}

/**
 * For the page's Office host: pass the result as `OfficeModuleFrame`'s
 * `onFrameCommentsChange`, so a frame that serves comments hides the page's
 * own panel. Undefined outside a document detail view.
 */
export function useReportFrameComments(): ((framePanel: boolean) => void) | undefined {
  return use(FrameCommentsReportContext);
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
  const label = t(documentCommentsTitleKey(chrome.doc));
  return (
    <div className={folded ? "hidden shrink-0 items-center gap-1 sm:flex" : "contents"} data-document-comments-actions>
      <DocumentFavoriteToggle documentId={chrome.doc.id} orgId={orgId} />
      <Button
        ref={chrome.triggerRef}
        type="button"
        variant="ghost"
        size="sm"
        aria-label={label}
        aria-expanded={chrome.open}
        aria-controls="document-comments-panel"
        onClick={() => chrome.setOpen(!chrome.open)}
      >
        <MessageSquare aria-hidden className="size-4" />
        <span className="hidden sm:inline">{label}</span>
      </Button>
    </div>
  );
}
