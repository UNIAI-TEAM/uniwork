"use client";

// B2 (UNI-924): review ▸ comments. The toolbar entry (count badge) opens the
// comments pane; the command runtime owns the list and every anchor mutation,
// so this group only drives open/compose/active state and the author name.
import { MessageSquare } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "@uniwork/core/auth";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { DocxCommentsPanel } from "../../comments/docx-comments-panel";
import type { DocxToolbarGroupContext } from "../types";

/** Author stored when no session name is available (identity in the file, not
 * UI copy — the panel still renders names through the normal flow). */
const DEFAULT_COMMENT_AUTHOR = "UniWork";

/** Shared empty anchor map for the closed pane (never mutated). */
const EMPTY_ANCHORS: ReadonlyMap<string, string> = new Map<string, string>();

export function ReviewCommentsGroup({ format, commands, readOnly }: DocxToolbarGroupContext) {
  const { t } = useTranslation();
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const comments = format?.docxComments ?? [];
  const author = user?.display_name?.trim() || DEFAULT_COMMENT_AUTHOR;
  const editable = !readOnly && !!commands;
  const canComment = editable && (commands?.canAddDocxComment() ?? false);
  // Read fresh on each render (a cheap .doc-comment pass) so an edited anchor
  // never leaves a stale quote in the pane.
  const anchorTexts = open ? commands?.docxCommentAnchorTexts() ?? EMPTY_ANCHORS : EMPTY_ANCHORS;

  const words = author.split(/\s+/).filter(Boolean);
  const initials = (words.length > 1 ? words.map((word) => word[0]!).slice(0, 2).join("") : author.slice(0, 2)).toUpperCase();

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setComposing(false);
      }}
    >
      <PopoverTrigger
        disabled={!commands}
        render={
          <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.docx.toolbar.groups.comments")} aria-pressed={open}>
            <MessageSquare aria-hidden />
            {comments.length > 0 ? <span className="text-caption text-muted-foreground">{comments.length}</span> : null}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-80">
        <DocxCommentsPanel
          comments={comments}
          anchorTexts={anchorTexts}
          activeId={activeId}
          readOnly={!editable}
          canComment={canComment}
          composing={composing}
          onComposingChange={setComposing}
          onSubmit={(text) => {
            const created = commands?.addDocxComment(text, author, initials);
            if (created) setComposing(false);
          }}
          onReply={(parentId, text) => {
            commands?.replyToDocxComment(parentId, text, author, initials);
          }}
          onResolve={(id, done) => {
            commands?.resolveDocxComment(id, done);
          }}
          onDelete={(id) => {
            commands?.deleteDocxComment(id);
          }}
          onJump={(id) => {
            if (commands?.jumpToDocxComment(id)) setActiveId(id);
          }}
          onClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
