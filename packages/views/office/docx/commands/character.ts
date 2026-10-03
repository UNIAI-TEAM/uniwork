import type { Editor } from "@tiptap/core";
import type { Mark } from "@tiptap/pm/model";
import { applyCase, caseModeForToggle, selectionText, type CaseCommandMode } from "../character/case-transform";
import { collectDocumentFonts, isEastAsianFontName, textHasCjk } from "../character/font-list";
import { DEFAULT_FONT_SIZE_PT, nextFontSize } from "../character/font-size";
import type { DocxCommandArea, DocxCommandFactoryContext } from "./context";

export type VerticalAlign = "superscript" | "subscript";

export interface DocxCharacterFormatState {
  strike: boolean;
  verticalAlign: VerticalAlign | null;
  /** The face the caret/selection shows: the East-Asian slot for CJK text, the
   * Latin slot otherwise. Null = no explicit run font. */
  fontFamily: string | null;
  /** Explicit run size in points; null = inherit the style/doc default. */
  fontSizePt: number | null;
  /** Hex without "#"; null = automatic. */
  color: string | null;
  /** OOXML highlight name; null = no highlight. */
  highlight: string | null;
}

export interface DocxCharacterCommands {
  toggleStrike(): void;
  setVerticalAlign(kind: VerticalAlign | null): void;
  setFontFamily(family: string | null): void;
  setFontSizePt(pt: number | null): void;
  stepFontSize(direction: 1 | -1): void;
  setTextColor(color: string | null): void;
  setHighlight(name: string | null): void;
  clearCharacterFormatting(): void;
  changeCase(mode: CaseCommandMode): void;
  documentFonts(): string[];
  /** Format painter: capture the caret/selection's character marks. */
  copyCharacterFormat(): boolean;
  /** Apply the captured marks to the current selection, then disarm. */
  applyCharacterFormat(): boolean;
  /** Drop a capture without applying it. */
  clearCharacterFormat(): void;
}

/** Character-formatting marks shared by the clear-formatting command and the
 * painter; semantic marks (links, comments, revisions, fields) stay put. */
const CHARACTER_MARKS = ["bold", "italic", "underline", "strike", "docTextStyle"] as const;

const EMPTY_STATE: DocxCharacterFormatState = {
  strike: false,
  verticalAlign: null,
  fontFamily: null,
  fontSizePt: null,
  color: null,
  highlight: null,
};

interface PainterMark {
  type: string;
  attrs: Record<string, unknown>;
}

function editable(editor: Editor | null): Editor | null {
  return editor && !editor.isDestroyed && editor.isEditable ? editor : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function readVerticalAlign(value: unknown): VerticalAlign | null {
  return value === "superscript" || value === "subscript" ? value : null;
}

function readFontFamily(editor: Editor, attrs: Record<string, unknown>): string | null {
  const font = readString(attrs.font);
  const fontAscii = readString(attrs.fontAscii);
  if (!font || !fontAscii || font === fontAscii) return font ?? fontAscii;
  const { from, to } = editor.state.selection;
  const limit = editor.state.doc.content.size;
  const sample =
    from === to
      ? editor.state.doc.textBetween(Math.max(0, from - 1), Math.min(limit, from + 1))
      : editor.state.doc.textBetween(from, Math.min(to, from + 32), " ");
  return textHasCjk(sample) ? font : fontAscii;
}

/** Word picks up the FIRST character's formatting of a range, and the marks at
 * the caret for a collapsed selection. rawRPr is the source run's unmodelled
 * XML pass-through and must not travel to foreign runs. */
function capturePainterMarks(editor: Editor): PainterMark[] {
  const { state } = editor;
  const { $head, from, to, empty } = state.selection;
  const picked: Mark[] = empty ? [...$head.marks()] : [];
  if (!empty) {
    let found = false;
    state.doc.nodesBetween(from, to, (node) => {
      if (found) return false;
      if (!node.isText) return true;
      found = true;
      picked.push(...node.marks);
      return false;
    });
  }
  return picked
    .filter((mark) => (CHARACTER_MARKS as readonly string[]).includes(mark.type.name))
    .map((mark) => {
      const attrs = { ...(mark.attrs as Record<string, unknown>) };
      if (mark.type.name === "docTextStyle") delete attrs.rawRPr;
      return { type: mark.type.name, attrs };
    });
}

export function readCharacterState(editor: Editor | null): DocxCharacterFormatState {
  if (!editor || editor.isDestroyed) return EMPTY_STATE;
  const attrs = editor.getAttributes("docTextStyle") as Record<string, unknown>;
  return {
    strike: editor.isActive("strike"),
    verticalAlign: readVerticalAlign(attrs.vertAlign),
    fontFamily: readFontFamily(editor, attrs),
    fontSizePt: typeof attrs.sizeHalfPoints === "number" ? attrs.sizeHalfPoints / 2 : null,
    color: attrs.color === "auto" ? null : readString(attrs.color),
    highlight: readString(attrs.highlight),
  };
}

export function createCharacterCommands(
  context: DocxCommandFactoryContext,
): DocxCommandArea<DocxCharacterCommands, DocxCharacterFormatState> {
  const getEditor = () => context.getEditor();
  let painterMarks: PainterMark[] | null = null;

  const runEditable = (action: (editor: Editor) => void): void => {
    const editor = editable(getEditor());
    if (editor) action(editor);
  };

  /** setMark merges into the existing mark (and the caret's stored mark), so
   * only the patch travels — the same seam the genoffice ribbon uses. */
  const setTextStyle = (patch: Record<string, unknown>): void => {
    runEditable((editor) => {
      editor.chain().focus().setMark("docTextStyle", patch).run();
    });
  };

  return {
    commands: {
      toggleStrike: () => {
        runEditable((editor) => {
          editor.chain().focus().toggleMark("strike").run();
        });
      },
      setVerticalAlign: (kind) => {
        setTextStyle({ vertAlign: kind });
      },
      setFontFamily: (family) => {
        const name = readString(family);
        if (!name) {
          setTextStyle({ font: null, fontAscii: null });
          return;
        }
        setTextStyle(isEastAsianFontName(name) ? { font: name } : { fontAscii: name });
      },
      setFontSizePt: (pt) => {
        if (pt === null) {
          setTextStyle({ sizeHalfPoints: null });
          return;
        }
        if (!Number.isFinite(pt) || pt <= 0) return;
        const halfPoints = Math.round(Math.min(pt, 1638) * 2);
        if (halfPoints < 2) return;
        setTextStyle({ sizeHalfPoints: halfPoints });
      },
      stepFontSize: (direction) => {
        const editor = editable(getEditor());
        if (!editor) return;
        const attrs = editor.getAttributes("docTextStyle") as Record<string, unknown>;
        const explicit = typeof attrs.sizeHalfPoints === "number" ? attrs.sizeHalfPoints / 2 : null;
        const current = explicit ?? DEFAULT_FONT_SIZE_PT;
        const next = Math.round(nextFontSize(current, direction) * 2);
        editor.chain().focus().setMark("docTextStyle", { sizeHalfPoints: next }).run();
      },
      setTextColor: (color) => {
        if (color === null) {
          setTextStyle({ color: null });
          return;
        }
        const match = /^#?([0-9a-fA-F]{6})$/.exec(color.trim());
        if (!match) return;
        setTextStyle({ color: (match[1] as string).toUpperCase() });
      },
      setHighlight: (name) => {
        if (name === null) {
          setTextStyle({ highlight: null });
          return;
        }
        const value = readString(name);
        if (!value) return;
        setTextStyle({ highlight: value });
      },
      clearCharacterFormatting: () => {
        runEditable((editor) => {
          let chain = editor.chain().focus();
          for (const mark of CHARACTER_MARKS) chain = chain.unsetMark(mark);
          chain.run();
        });
      },
      changeCase: (mode) => {
        runEditable((editor) => {
          applyCase(editor, mode === "toggle" ? caseModeForToggle(selectionText(editor)) : mode);
        });
      },
      documentFonts: () => {
        const editor = getEditor();
        return editor && !editor.isDestroyed ? collectDocumentFonts(editor.state.doc) : [];
      },
      copyCharacterFormat: () => {
        const editor = editable(getEditor());
        if (!editor) return false;
        painterMarks = capturePainterMarks(editor);
        return true;
      },
      applyCharacterFormat: () => {
        const editor = editable(getEditor());
        const marks = painterMarks;
        if (!editor || !marks) return false;
        painterMarks = null;
        let chain = editor.chain().focus();
        for (const mark of CHARACTER_MARKS) chain = chain.unsetMark(mark);
        for (const mark of marks) chain = chain.setMark(mark.type, mark.attrs);
        chain.run();
        return true;
      },
      clearCharacterFormat: () => {
        painterMarks = null;
      },
    },
    readState: readCharacterState,
  };
}
