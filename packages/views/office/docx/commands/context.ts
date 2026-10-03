import type { Editor } from "@tiptap/core";

/** The TipTap editor only exists once a document is open, while the command
 * runtime must exist before that (the view subscribes to it on mount). A
 * factory therefore reads the live editor through this port instead of
 * capturing a possibly-null instance. */
export interface DocxCommandFactoryContext {
  getEditor(): Editor | null;
}

/** One command area's contribution: its own commands plus its own slice of the
 * format state. Task ownership is one factory file per area (character,
 * paragraph, table, links, insert, review, header-footer); the runtime in
 * ./index.ts composes the base commands with every area and merges their state
 * readers into one state object. */
export interface DocxCommandArea<TCommands extends object, TState extends object> {
  commands: TCommands;
  readState(editor: Editor | null): TState;
}
