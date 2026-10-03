// B2 (UNI-924): the comments command area. The controller in
// ../comments/docx-comments-controller.ts owns the list + anchors; this file
// only publishes it on the shared command runtime, so the toolbar group and
// the save snapshot reach it without touching the editor.
import type { DocxCommentInfo } from "@uniwork/office-engine/docx";
import { createDocxCommentsController, type DocxCommentsController } from "../comments/docx-comments-controller";
import type { DocxCommandArea, DocxCommandFactoryContext } from "./context";

export interface DocxCommentsFormatState {
  /** The authoritative comment list (empty until a document is open). */
  docxComments: DocxCommentInfo[];
}

export interface DocxCommentsCommands {
  /** Open/restore hook: seed the parse's own comment list. */
  seedDocxComments(comments: DocxCommentInfo[]): void;
  listDocxComments(): DocxCommentInfo[];
  /** Monotonic comment-mutation counter (F1): the handle compares it across
   * transactions to turn list-only edits into dirty-generation bumps. */
  docxCommentsRevision(): number;
  canAddDocxComment(): boolean;
  addDocxComment(text: string, author: string, initials?: string): DocxCommentInfo | null;
  replyToDocxComment(parentId: string, text: string, author: string, initials?: string): DocxCommentInfo | null;
  resolveDocxComment(id: string, done: boolean): boolean;
  deleteDocxComment(id: string): boolean;
  hasDocxCommentAnchor(id: string): boolean;
  docxCommentAnchorTexts(): Map<string, string>;
  jumpToDocxComment(id: string): boolean;
}

export function createCommentsCommands(
  context: DocxCommandFactoryContext,
): DocxCommandArea<DocxCommentsCommands, DocxCommentsFormatState> {
  const controller: DocxCommentsController = createDocxCommentsController(() => context.getEditor());
  return {
    commands: {
      seedDocxComments: (comments) => controller.seed(comments),
      listDocxComments: () => controller.list(),
      docxCommentsRevision: () => controller.revision(),
      canAddDocxComment: () => controller.canComment(),
      addDocxComment: (text, author, initials) => controller.add(text, author, initials),
      replyToDocxComment: (parentId, text, author, initials) => controller.reply(parentId, text, author, initials),
      resolveDocxComment: (id, done) => controller.resolve(id, done),
      deleteDocxComment: (id) => controller.remove(id),
      hasDocxCommentAnchor: (id) => controller.hasAnchor(id),
      docxCommentAnchorTexts: () => controller.anchorTexts(),
      jumpToDocxComment: (id) => controller.jump(id),
    },
    readState: () => ({ docxComments: controller.list() }),
  };
}
