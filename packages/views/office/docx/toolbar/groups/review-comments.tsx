"use client";

// B2 (UNI-924): review > comments. W-H adds typed ribbon items: the primary
// split opens the comments pane and its menu starts the compose flow, the same
// commands the old toolbar entry exposed. The pane is mounted by the
// toolbar-level `RibbonDialogHosts` (F7) so folding the group cannot destroy it;
// the kept sr-only trigger is an anchor only (F9).
import { MessageSquare, MessageSquarePlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSession } from "@uniwork/core/auth";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import type { RibbonItem } from "../../../ribbon";
import { groupCommentThreads } from "../../comments/docx-comment-model";
import { DocxCommentsPanel } from "../../comments/docx-comments-panel";
import { docxScopeOf, useDocxDocumentScope, type DocxDocumentScope } from "../../editor-store";
import type { DocxToolbarGroupContext } from "../types";
import { scopedRibbonController, scopedRibbonOpenStore, registerRibbonDialogHost, ribbonHostItem, useRibbonBound, useRibbonOpen } from "./ribbon-open-store";

/** Author stored when no session name is available (identity in the file, not
 * UI copy - the panel still renders names through the normal flow). */
const DEFAULT_COMMENT_AUTHOR = "UniWork";

/** Shared empty anchor map for the closed pane (never mutated). */
const EMPTY_ANCHORS: ReadonlyMap<string, string> = new Map<string, string>();

/** Shared open / compose / active state of the comments pane. */
const commentsPaneFor = scopedRibbonOpenStore();
const commentsComposingFor = scopedRibbonController(false);
const commentsActiveIdFor = scopedRibbonController<string | null>(null);

function openComposer(scope: DocxDocumentScope): void {
  const commentsPane = commentsPaneFor(scope);
  const commentsComposing = commentsComposingFor(scope);
  commentsPane.open();
  commentsComposing.set(true);
}

/** The typed ribbon items for the Review > comments group. */
export function reviewCommentsRibbonItems(context: DocxToolbarGroupContext): readonly RibbonItem[] {
  const { format, commands, readOnly } = context;
  const commentsPane = commentsPaneFor(docxScopeOf(context));
  const editable = !readOnly && !!commands;
  const canComment = editable && (commands?.canAddDocxComment() ?? false);
  return [
    {
      kind: "split",
      id: "review-comments",
      labelKey: "office.docx.toolbar.groups.comments",
      icon: MessageSquare,
      size: "large",
      collapseAs: "small",
      disabled: !commands,
      onExecute: () => commentsPane.open(),
      menu: [
        {
          id: "review-comments-new",
          labelKey: "office.docx.comments.add",
          icon: MessageSquarePlus,
          disabled: !canComment,
          onSelect: () => openComposer(docxScopeOf(context)),
        },
        {
          id: "review-comments-open",
          labelKey: "office.docx.toolbar.groups.comments",
          icon: MessageSquare,
          disabled: !commands,
          onSelect: () => commentsPane.open(),
        },
      ],
    },
    ribbonHostItem("review-comments-host", "office.docx.toolbar.groups.comments"),
  ];
}

/** Review > comments: the typed items live on the registry entry; this
 * component owns the pane and is mounted by `RibbonDialogHosts`. */
export function ReviewCommentsGroup({ format, commands, readOnly }: DocxToolbarGroupContext) {
  const scope = useDocxDocumentScope();
  const commentsPane = commentsPaneFor(scope);
  const commentsComposing = commentsComposingFor(scope);
  const commentsActiveId = commentsActiveIdFor(scope);
  const { t } = useTranslation();
  const { user } = useSession();
  const [open] = useRibbonOpen(commentsPane);
  const [composing] = useRibbonBound(commentsComposing, false);
  const [activeId] = useRibbonBound(commentsActiveId, null);
  const comments = format?.docxComments ?? [];
  const author = user?.display_name?.trim() || DEFAULT_COMMENT_AUTHOR;
  const editable = !readOnly && !!commands;
  const canComment = editable && (commands?.canAddDocxComment() ?? false);
  // Word's badge convention is threads, not entries: replies must not inflate
  // the count beside the comment icon.
  const threads = groupCommentThreads(comments);
  const threadCount = threads.open.length + threads.resolved.length;
  // Read fresh on each render (a cheap .doc-comment pass) so an edited anchor
  // never leaves a stale quote in the pane.
  const anchorTexts = open ? commands?.docxCommentAnchorTexts() ?? EMPTY_ANCHORS : EMPTY_ANCHORS;

  const words = author.split(/\s+/).filter(Boolean);
  const initials = (words.length > 1 ? words.map((word) => word[0]!).slice(0, 2).join("") : author.slice(0, 2)).toUpperCase();

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        commentsPane.set(next);
        if (!next) commentsComposing.set(false);
      }}
    >
      <PopoverTrigger
        disabled={!commands}
        render={
          <Button
            type="button"
            variant="toolbar"
            size="icon-sm"
            aria-label={t("office.docx.toolbar.groups.comments")}
            aria-pressed={open}
            tabIndex={-1}
            aria-hidden
            className="sr-only"
            data-testid="docx-comments-toggle"
          />
        }
      >
        <MessageSquare aria-hidden />
        {threadCount > 0 ? <span className="text-caption text-muted-foreground">{threadCount}</span> : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <DocxCommentsPanel
          comments={comments}
          anchorTexts={anchorTexts}
          activeId={activeId}
          readOnly={!editable}
          canComment={canComment}
          composing={composing}
          onComposingChange={commentsComposing.set}
          onSubmit={(text) => {
            const created = commands?.addDocxComment(text, author, initials) ?? null;
            if (created) commentsComposing.set(false);
            return created !== null;
          }}
          onReply={(parentId, text) => {
            return !!commands?.replyToDocxComment(parentId, text, author, initials);
          }}
          onResolve={(id, done) => {
            commands?.resolveDocxComment(id, done);
          }}
          onDelete={(id) => {
            commands?.deleteDocxComment(id);
          }}
          onJump={(id) => {
            if (commands?.jumpToDocxComment(id)) commentsActiveId.set(id);
          }}
          onClose={() => commentsPane.set(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

registerRibbonDialogHost("review-comments-host", ReviewCommentsGroup);
