"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronRight, Info, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFlag } from "@uniwork/core/feature-flags";
import type { Document, DocumentCommentKind } from "@uniwork/core/types/document";
import { Button } from "@uniwork/ui/components/ui/button";
import { Sheet, SheetContent } from "@uniwork/ui/components/ui/sheet";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@uniwork/ui/components/ui/tabs";
import { useMediaQuery } from "@uniwork/ui/hooks/use-media-query";
import { cn } from "@uniwork/ui/lib/utils";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { DocumentCommentComposer } from "./document-comment-composer";
import { DocumentCommentThread, type ThreadContext } from "./document-comment-thread";
import {
  documentCommentsTitleKey,
  useDocumentCommentsChrome,
  type DocumentCommentsTab,
} from "./document-comments-context";
import { K } from "./document-comments-keys";
import {
  anchorableFormat,
  findDeepLinkTarget,
  listSignature,
  threadsOf,
  type DocumentThread,
} from "./document-comments-model";
import { useDocumentCommentsPanel, type PanelStatus } from "./use-document-comments-panel";

/** Tailwind `xl` — the breakpoint where the detail row can afford a rail. */
const DESKTOP_QUERY = "(min-width: 1280px)";

/** How long a deep-linked thread stays tinted. */
const HIGHLIGHT_MS = 8000;

const STATUS_KEYS: Record<Exclude<PanelStatus, null>, string> = {
  offline: K.collabOffline,
  server: K.collabServerError,
  signedOut: K.collabSignedOut,
  viewOnly: K.collabViewOnly,
};

type FocusRequest = { rootId: string; target: "heading" | "resolve" } | null;

/** One tab's list: open threads, then the folded "Resolved" group (S12 items 3–4, S13 list row). */
function ThreadList({
  kind,
  groups,
  ctx,
  resolvedOpen,
  setResolvedOpen,
  focus,
  clearFocus,
  highlightId,
}: {
  kind: DocumentCommentKind;
  groups: { open: DocumentThread[]; resolved: DocumentThread[] };
  ctx: ThreadContext;
  resolvedOpen: boolean;
  setResolvedOpen: (open: boolean) => void;
  focus: FocusRequest;
  clearFocus: () => void;
  /** The thread a deep link named; the whole card is tinted, not just its heading. */
  highlightId: string | null;
}) {
  const { t } = useTranslation();
  const resolvedListId = useId();
  const render = (thread: DocumentThread) => (
    <DocumentCommentThread
      key={thread.root.id}
      thread={thread}
      ctx={ctx}
      highlighted={highlightId === thread.root.id}
      focusRequest={focus?.rootId === thread.root.id ? focus.target : null}
      onFocusHandled={clearFocus}
    />
  );
  if (groups.open.length === 0 && groups.resolved.length === 0) {
    return (
      <p className="text-caption text-muted-foreground" data-testid="document-comments-empty">
        {t(kind === "comment" ? K.collabEmptyCommentsNoEditor : K.collabEmptyDiscussion)}
      </p>
    );
  }
  return (
    <>
      <ul className="space-y-3" data-testid={`document-${kind}-threads`}>
        {groups.open.map(render)}
      </ul>
      {groups.resolved.length > 0 ? (
        <div>
          <button
            type="button"
            aria-expanded={resolvedOpen}
            aria-controls={resolvedListId}
            onClick={() => setResolvedOpen(!resolvedOpen)}
            className="flex min-h-6 w-full items-center gap-1.5 rounded px-1 py-1 text-left text-caption font-medium text-muted-foreground hover:bg-muted pointer-coarse:min-h-11"
          >
            <ChevronRight aria-hidden className={cn("size-3.5 transition-transform", resolvedOpen && "rotate-90")} />
            {t(K.collabLabelCount, { label: t(K.collabResolved), count: groups.resolved.length })}
          </button>
          <ul id={resolvedListId} hidden={!resolvedOpen} className="mt-2 space-y-3">
            {resolvedOpen ? groups.resolved.map(render) : null}
          </ul>
        </div>
      ) : null}
    </>
  );
}

function CommentsPane({ wsId, doc, titleId, onClose }: { wsId: string; doc: Document; titleId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const chrome = useDocumentCommentsChrome();
  const workspace = useOptionalWorkspace();
  const orgId = doc.organization_id || workspace?.workspace.organization_id || "";
  const panel = useDocumentCommentsPanel(wsId, doc);
  const { query, comments } = panel;
  const format = anchorableFormat(doc);
  const tab: DocumentCommentsTab = format ? (chrome?.tab ?? "comment") : "discussion";
  const setTab = chrome?.setTab;
  // The panel is named for what it shows: on a format with two tabs the title follows the tab.
  const titleKey = format && tab === "discussion" ? K.collabDiscussion : documentCommentsTitleKey(doc);
  const statusId = useId();
  const [resolvedOpen, setResolvedOpen] = useState<Record<DocumentCommentKind, boolean>>({ comment: false, discussion: false });
  const [focus, setFocus] = useState<FocusRequest>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [revealMessage, setRevealMessage] = useState<DocumentCommentKind | null>(null);
  const revealRef = useRef<HTMLParagraphElement>(null);
  const [announcement, setAnnouncement] = useState("");
  const clearFocus = useCallback(() => setFocus(null), []);

  const groups = useMemo(() => threadsOf(comments, tab), [comments, tab]);

  // A reload that changed what the list shows is said once, politely; focus never moves for it.
  const signature = query.isSuccess ? listSignature(comments) : null;
  const lastSignature = useRef<string | null>(null);
  useEffect(() => {
    if (signature === null) return;
    if (lastSignature.current !== null && lastSignature.current !== signature) {
      setAnnouncement(t(K.collabUpdatedAnnounce));
    }
    lastSignature.current = signature;
  }, [signature, t]);
  useEffect(() => {
    if (!announcement) return undefined;
    const timer = window.setTimeout(() => setAnnouncement(""), 4000);
    return () => window.clearTimeout(timer);
  }, [announcement]);

  // `?comment=`: once the list is in, open the tab that holds the thread and focus it; a post
  // that is gone says so at the top of the panel (S15 rows 3-4, panel level).
  const deepLinkId = chrome?.deepLinkId ?? "";
  const deepLinkKind = chrome?.deepLinkKind ?? "comment";
  const handledLink = useRef<string | null>(null);
  useEffect(() => {
    if (!deepLinkId || !query.isSuccess || handledLink.current === deepLinkId) return;
    handledLink.current = deepLinkId;
    const target = findDeepLinkTarget(comments, deepLinkId);
    if (!target) {
      // The link's kind says which tab the post lived in (a format with one tab only has the Discussion).
      const kind = format ? deepLinkKind : "discussion";
      if (format) setTab?.(kind);
      setRevealMessage(kind);
      return;
    }
    if (format) setTab?.(target.kind);
    if (target.resolved) setResolvedOpen((open) => ({ ...open, [target.kind]: true }));
    if (target.deleted) setRevealMessage(target.kind);
    setFocus({ rootId: target.rootId, target: "heading" });
    setHighlightId(target.rootId);
  }, [comments, deepLinkId, deepLinkKind, format, query.isSuccess, setTab]);
  useEffect(() => {
    if (!highlightId) return undefined;
    const timer = window.setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [highlightId]);
  useEffect(() => {
    if (revealMessage && !focus) revealRef.current?.focus();
  }, [revealMessage, focus]);

  const deletedKey = tab === "comment" ? K.collabCommentDeleted : K.collabDiscussionDeleted;
  const ctx: ThreadContext = {
    wsId,
    documentId: doc.id,
    orgId,
    names: panel.names,
    // An author the server no longer names is a former member (S12 "Tác giả không còn tên").
    nameOf: (comment) => panel.authorName(comment) || t(K.collabFormerMember),
    nameOfId: (userId) => panel.nameOfId(userId) || t(K.collabFormerMember),
    currentUserId: panel.currentUserId,
    canWrite: panel.canWrite,
    canModerate: panel.canModerate,
    blockedReasonId: panel.blocked ? statusId : undefined,
    deletedKey,
    actions: {
      ...panel.actions,
      // Resolve and Reopen move the thread between groups: focus follows it to its new place.
      setResolved: async (commentId, resolved) => {
        const ok = await panel.actions.setResolved(commentId, resolved);
        if (ok) setFocus({ rootId: commentId, target: "resolve" });
        return ok;
      },
    },
  };

  const body = (() => {
    if (query.isPending) {
      return (
        <div className="space-y-3 p-3" aria-busy="true" data-testid="document-comments-loading">
          <span className="sr-only">{t(K.collabLoading)}</span>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      );
    }
    if (panel.noAccess || panel.firstLoadFailed) {
      return (
        <div className="p-4" role="alert" data-testid="document-comments-error">
          <p className="text-body font-medium text-foreground">
            {t(panel.noAccess ? K.collabNoAccess : K.collabLoadError)}
          </p>
          <p className="mt-1 text-caption text-muted-foreground">
            {t(panel.noAccess ? K.collabNoAccessBody : K.collabLoadErrorBody)}
          </p>
          {!panel.noAccess ? (
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void query.refetch()}>
              <RefreshCw aria-hidden className="size-3.5" />
              {t(K.collabRetry)}
            </Button>
          ) : null}
        </div>
      );
    }
    return (
      <div
        role={format ? "tabpanel" : undefined}
        aria-labelledby={format ? `${titleId}-tab-${tab}` : undefined}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3"
        data-testid={`document-comments-region-${tab}`}
      >
        {revealMessage ? (
          <p
            ref={revealRef}
            tabIndex={-1}
            role="status"
            className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-caption text-foreground"
            data-testid="document-comments-reveal"
          >
            <Info aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            {t(revealMessage === "comment" ? K.collabCommentDeleted : K.collabDiscussionDeleted)}
          </p>
        ) : null}
        <ThreadList
          kind={tab}
          groups={groups}
          ctx={ctx}
          resolvedOpen={resolvedOpen[tab]}
          setResolvedOpen={(open) => setResolvedOpen((current) => ({ ...current, [tab]: open }))}
          focus={focus}
          clearFocus={clearFocus}
          highlightId={highlightId}
        />
      </div>
    );
  })();

  const loaded = !query.isPending && !panel.noAccess && !panel.firstLoadFailed;

  return (
    <div id="document-comments-panel" className="flex h-full min-h-0 flex-col bg-card" data-testid="document-comments-pane">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <h2 id={titleId} tabIndex={-1} className="min-w-0 truncate text-body font-semibold text-foreground">
          {t(titleKey)}
        </h2>
        {!panel.canWrite ? (
          <span className="shrink-0 rounded bg-muted px-1.5 text-micro font-medium text-muted-foreground" data-testid="document-comments-view-only">
            {t(K.collabViewOnlyBadge)}
          </span>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="ml-auto shrink-0"
          aria-label={t(K.collabClosePanel, { panel: t(titleKey) })}
          onClick={onClose}
        >
          <X aria-hidden />
        </Button>
      </header>
      {format && loaded ? (
        <Tabs value={tab} onValueChange={(next) => setTab?.(next as DocumentCommentsTab)} className="gap-0 border-b border-border px-3 py-2">
          <TabsList>
            <TabsTrigger id={`${titleId}-tab-comment`} value="comment">{t(K.collabComments)}</TabsTrigger>
            <TabsTrigger id={`${titleId}-tab-discussion`} value="discussion">{t(K.collabDiscussion)}</TabsTrigger>
          </TabsList>
        </Tabs>
      ) : null}
      {panel.status && loaded ? (
        <p id={statusId} className="border-b border-border bg-muted/40 px-4 py-2 text-caption text-muted-foreground" data-testid="document-comments-status">
          {t(STATUS_KEYS[panel.status])}
        </p>
      ) : null}
      <p className="sr-only" aria-live="polite" data-testid="document-comments-live">{announcement}</p>
      {body}
      {tab === "discussion" && loaded && panel.canWrite ? (
        <div className="border-t border-border p-3">
          <DocumentCommentComposer
            wsId={wsId}
            documentId={doc.id}
            orgId={orgId}
            placeholderKey={K.collabComposerDiscussion}
            deletedKey={K.collabDiscussionDeleted}
            blockedReasonId={panel.blocked ? statusId : undefined}
            onSend={(text) => panel.send(text)}
            testId="document-discussion-composer"
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The page's comments panel (G8-10; EXPERIENCE-G8 S12/S13): a right-hand rail
 * on `xl` and a sheet below it, mounted from `DocumentDetailView` next to the
 * workspace. It exists only while no editor frame serves comments
 * (invariant 8; the context answers null then). A document whose format takes
 * anchored comments gets two tabs, Comments and Discussion; every other
 * document gets the Discussion alone. The web never starts a comment thread:
 * anchored comments come from the editor, here they are read, answered,
 * resolved, reopened, edited and deleted.
 */
export function DocumentCommentsPanel() {
  const chrome = useDocumentCommentsChrome();
  const enabled = useFlag("documents", false);
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const titleId = useId();

  if (!chrome || !enabled || !chrome.open) return null;
  const { wsId, doc, setOpen } = chrome;
  const close = () => setOpen(false);

  if (desktop) {
    return (
      <aside aria-labelledby={titleId} className="flex w-96 min-w-0 shrink-0 flex-col border-l border-border">
        <CommentsPane wsId={wsId} doc={doc} titleId={titleId} onClose={close} />
      </aside>
    );
  }

  return (
    <Sheet open onOpenChange={(next) => setOpen(next)}>
      {/* The primitive pins the right sheet to 3/4 width behind a data-attribute selector, which a bare
          `w-full` loses to; the same specificity wins, so a phone gets the full width. */}
      <SheetContent
        side="right"
        showCloseButton={false}
        className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md"
      >
        <CommentsPane wsId={wsId} doc={doc} titleId={titleId} onClose={close} />
      </SheetContent>
    </Sheet>
  );
}
