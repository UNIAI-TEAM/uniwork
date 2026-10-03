import type { Editor } from "@tiptap/core";
import type { DocxFormatState } from "../types";
import { createBaseCommands, type DocxBaseCommands } from "./base";
import { createCharacterCommands, type DocxCharacterCommands, type DocxCharacterFormatState } from "./character";
import { createCommentsCommands, type DocxCommentsCommands, type DocxCommentsFormatState } from "./comments";
import type { DocxCommandArea, DocxCommandFactoryContext } from "./context";
import { createHeaderFooterCommands, type DocxHeaderFooterCommands, type DocxHeaderFooterFormatState } from "./header-footer";
import { createInsertCommands, type DocxInsertCommands, type DocxInsertFormatState } from "./insert";
import { createLinksCommands, type DocxLinksCommands, type DocxLinksFormatState } from "./links";
import { createParagraphCommands, type DocxParagraphCommands, type DocxParagraphFormatState } from "./paragraph";
import { createReviewCommands, type DocxReviewCommands, type DocxReviewFormatState } from "./review";
import { createTableCommands, type DocxTableCommands, type DocxTableFormatState } from "./table";

/**
 * The composed format state every area contributes to, in one intersection.
 * A task adds a field to its own factory file's state type and the runtime (and
 * therefore the toolbar context) picks it up without touching shared files.
 */
export type DocxAreaFormatState = DocxCharacterFormatState &
  DocxParagraphFormatState &
  DocxTableFormatState &
  DocxLinksFormatState &
  DocxInsertFormatState &
  DocxReviewFormatState &
  DocxHeaderFooterFormatState &
  DocxCommentsFormatState;

export type DocxRuntimeFormatState = DocxFormatState & DocxAreaFormatState;

/**
 * The command seam: the base commands plus every area's commands, one format
 * state read/subscribe pair, and emitState() for the editing handle to call on
 * each transaction. A task replaces its own factory file; nothing else changes.
 */
export type DocxCommandRuntime = DocxBaseCommands &
  DocxCharacterCommands &
  DocxParagraphCommands &
  DocxTableCommands &
  DocxLinksCommands &
  DocxInsertCommands &
  DocxReviewCommands &
  DocxHeaderFooterCommands &
  DocxCommentsCommands & {
    getState(): DocxRuntimeFormatState;
    subscribe(listener: (state: DocxRuntimeFormatState) => void): () => void;
    /** Re-reads the composed state and notifies every subscriber. */
    emitState(): void;
    /** Drops every subscriber; the editing handle calls this on dispose. */
    clearListeners(): void;
  };

export type DocxCommandAreaFactory<TCommands extends object = object, TState extends object = object> = (
  context: DocxCommandFactoryContext,
) => DocxCommandArea<TCommands, TState>;

/** Every wave-A area factory, in a fixed order so the merged state is
 * deterministic (later readers win on a name collision). */
const DOCX_COMMAND_AREAS: readonly DocxCommandAreaFactory[] = [
  createCharacterCommands,
  createParagraphCommands,
  createTableCommands,
  createLinksCommands,
  createInsertCommands,
  createReviewCommands,
  createHeaderFooterCommands,
  createCommentsCommands,
];

export interface DocxCommandRuntimeOptions {
  /** Test seam: composed after the base instead of the wave-A area set. */
  areas?: readonly DocxCommandAreaFactory[];
}

export function createDocxCommandRuntime(
  getEditor: () => Editor | null,
  options: DocxCommandRuntimeOptions = {},
): DocxCommandRuntime {
  const context: DocxCommandFactoryContext = { getEditor };
  const base = createBaseCommands(context);
  const createAreas = options.areas ?? DOCX_COMMAND_AREAS;
  const areas = createAreas.map((create) => create(context));
  const readers = [base.readState, ...areas.map((area) => area.readState)];
  const listeners = new Set<(state: DocxRuntimeFormatState) => void>();
  const getState = (): DocxRuntimeFormatState =>
    Object.assign({}, ...readers.map((read) => read(getEditor()))) as DocxRuntimeFormatState;
  const subscribe = (listener: (state: DocxRuntimeFormatState) => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const emitState = (): void => {
    const state = getState();
    for (const listener of listeners) listener(state);
  };
  const clearListeners = (): void => {
    listeners.clear();
  };
  // The composition is the intersection of the base and every area's declared
  // contribution; a spread over a runtime-built area list cannot re-derive that
  // statically, so the composed object is asserted onto the published type.
  // The double assertion keeps this file stable while area files grow: a
  // single-sided assertion would stop overlapping once an area adds a command.
  const areaCommands = Object.assign({}, ...areas.map((area) => area.commands)) as Record<string, unknown>;
  const runtime = {
    ...base.commands,
    ...areaCommands,
    getState,
    subscribe,
    emitState,
    clearListeners,
  } as unknown as DocxCommandRuntime;
  return runtime;
}
