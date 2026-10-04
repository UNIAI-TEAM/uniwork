"use client";

// B2 (UNI-924): review > comments. W-H adds typed ribbon items: the primary
// split opens the comments pane and its menu starts the compose flow, the same
// commands the old toolbar entry exposed. A zero-width host item keeps this
// component (which mounts the pane) mounted next to the typed split, so the
// typed items stay plain data and every command path is kept.
import { MessageSquare, MessageSquarePlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSession } from "@uniwork/core/auth";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import type { RibbonItem } from "../../../ribbon";
import { groupCommentThreads } from "../../comments/docx-comment-model";
import { DocxCommentsPanel } from "../../comments/docx-comments-panel";
import type { DocxToolbarGroupContext } from "../types";
import { createRibbonController, createRibbonOpenStore, ribbonHostItem, useRibbonBound, useRibbonOpen } from "./ribbon-open-store";

/** Author stored when no session name is available (identity in the file, not
 * UI copy - the panel still renders names through the normal flow). */
const DEFAULT_COMMENT_AUTHOR = "UniWork";

/** Shared empty anchor map for the closed pane (never mutated). */
const EMPTY_ANCHORS: ReadonlyMap<string, string> = new Map<string, string>();

/** Shared open / compose / active state of the comments pane. */
const commentsPane = createRibbonOpenStore();
const commentsComposing = createRibbonController(false);
const commentsActiveId = createRibbonController<string | null>(null);

function openComposer(): void {
  commentsPane.open();
  commentsComposing.set(true);
}

/** The typed ribbon items for the Review > comments group. */
export function reviewCommentsRibbonItems(context: DocxToolbarGroupContext): readonly RibbonItem[] {
  const { format, commands, readOnly } = context;
  const editable = !readOnly && !!commands;
  const canComment = editable && (commands?.canAddDocxComment() ?? false);
  const threads = groupCommentThreads(format?.docxComments ?? []);
  const threadCount = threads.open.length + threads.resolved.length;
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
          onSelect: openComposer,
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
    ribbonHostItem("review-comments-host", "office.docx.toolbar.groups.comments", ReviewCommentsGroup, context),
  ];
}

/** Review > comments: the typed items live on the registry entry; this
 * component keeps the pane mount and stays exported for direct use. */
export function ReviewCommentsGroup({ format, commands, readOnly }: DocxToolbarGroupContext) {
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
            className="sr-only"
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
ReviewCommentsGroup.ribbonItems = reviewCommentsRibbonItems;




