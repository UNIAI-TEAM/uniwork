import type {
  PdfNoteAddInput,
  PdfNoteEngineOperation,
  PdfNoteEditInput,
  PdfNoteIdentity,
  PdfNoteOperationProvider,
  PdfNoteOperationSubmitter,
  PdfNoteRect,
  PdfNoteReplyInput,
  PdfNoteResolveInput,
} from "./types";

export class PdfNoteProviderError extends Error {
  readonly code = "invalid_input" as const;

  constructor(message: string) {
    super(message);
    this.name = "PdfNoteProviderError";
  }
}

function pageIndex(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new PdfNoteProviderError("pageIndex must be a non-negative integer");
  return value;
}

function rect(value: readonly number[]): PdfNoteRect {
  if (value.length !== 4 || !value.every((entry) => Number.isFinite(entry))) {
    throw new PdfNoteProviderError("rect must contain four finite coordinates");
  }
  const result = [value[0]!, value[1]!, value[2]!, value[3]!] as PdfNoteRect;
  if (result[2] <= result[0] || result[3] <= result[1]) throw new PdfNoteProviderError("rect must have positive dimensions");
  return result;
}

function contents(value: string, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new PdfNoteProviderError(`${name} must be non-empty text`);
  return value;
}

function identity(value: PdfNoteIdentity): PdfNoteIdentity {
  if (!Number.isSafeInteger(value.objNum) || value.objNum < 0) throw new PdfNoteProviderError("objNum must be a non-negative integer");
  return { pageIndex: pageIndex(value.pageIndex), objNum: value.objNum, rect: rect(value.rect), contents: contents(value.contents, "identity contents") };
}

/** Browser-safe note provider. Note identity is an original file index (the
 * engine matches saved notes by page + rect + contents), so unlike the canvas
 * providers this one never resolves `pageOrder` — a reordered display must map
 * back to the original index before calling. */
export function createPdfNoteOperationProvider(submitter: PdfNoteOperationSubmitter): PdfNoteOperationProvider {
  const submit = (operation: PdfNoteEngineOperation): Promise<void> | void => submitter.submit([operation]);
  return {
    async addNote(input: PdfNoteAddInput) {
      const note = {
        pageIndex: pageIndex(input.pageIndex),
        rect: rect(input.rect),
        contents: contents(input.contents, "contents"),
        ...(input.author === undefined ? {} : { author: input.author }),
      };
      await submit({ op: "addNote", attributes: { note } });
    },
    async replyToNote(input: PdfNoteReplyInput) {
      const parent = identity(input.replyTo);
      await submit({
        op: "addNote",
        attributes: {
          note: {
            pageIndex: parent.pageIndex,
            rect: parent.rect,
            contents: contents(input.contents, "contents"),
            replyTo: parent,
            ...(input.author === undefined ? {} : { author: input.author }),
          },
        },
      });
    },
    async editNote(input: PdfNoteEditInput) {
      const target = identity(input.identity);
      await submit({
        op: "editSavedNote",
        attributes: { pageIndex: target.pageIndex, objNum: target.objNum, rect: target.rect, oldContents: target.contents, contents: contents(input.contents, "contents") },
      });
    },
    async resolveNote(input: PdfNoteResolveInput) {
      const target = identity(input.identity);
      if (typeof input.resolved !== "boolean") throw new PdfNoteProviderError("resolved must be a boolean");
      await submit({
        op: "resolveNote",
        attributes: { pageIndex: target.pageIndex, objNum: target.objNum, rect: target.rect, contents: target.contents, resolved: input.resolved },
      });
    },
  };
}
