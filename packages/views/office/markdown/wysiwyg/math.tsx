"use client";

/**
 * The formula controls (M4): create and edit inline/block math, and normalise a
 * pasted formula written with LaTeX delimiters into a real math node.
 *
 * The nodes themselves are the shared `InlineMathExtension` /
 * `BlockMathExtension` (`packages/views/editor/extensions/math.tsx`) — this
 * module only writes them, reads the one under the cursor, and turns pasted
 * `\(…\)`, `\[…\]` and `$$…$$` into them. No second node type, no fork of the
 * renderer.
 *
 * Paste normalisation is a ProseMirror `handlePaste` prop on its own extension,
 * with `priority: 1000` so it runs BEFORE the shared markdown-paste catch-all
 * (which claims nearly every paste and would otherwise flatten a formula into
 * escaped text). It claims the event only when the whole clipboard text is one
 * formula; anything else falls through untouched.
 */
import { useEffect, useState, type KeyboardEvent } from "react";
import { FunctionSquare, Sigma } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";

/** Which math node a value refers to. */
export type MathKind = "inline" | "block";

/** A formula written with its delimiters, ready to become a math node. */
export interface ParsedMathPaste {
  kind: MathKind;
  expression: string;
}

const INLINE_PASTE_RE = /^\\\(([\s\S]*?)\\\)$/;
const BLOCK_BRACKET_PASTE_RE = /^\\\[([\s\S]*?)\\\]$/;
const BLOCK_DOLLAR_PASTE_RE = /^\$\$([\s\S]*?)\$\$$/;

/**
 * Classify pasted text as one formula, or null when it is not.
 *
 * Delimiters, matching what LaTeX users paste from a paper or an editor:
 * `\(…\)` is inline, `\[…\]` and `$$…$$` are display (block) math. The WHOLE
 * text must be the formula — a sentence that merely mentions one is left to the
 * markdown paste path, so a paste never silently drops surrounding prose.
 */
export function parseMathPaste(text: string): ParsedMathPaste | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const inline = INLINE_PASTE_RE.exec(trimmed);
  if (inline) return { kind: "inline", expression: (inline[1] ?? "").trim() };
  const bracket = BLOCK_BRACKET_PASTE_RE.exec(trimmed);
  if (bracket) return { kind: "block", expression: (bracket[1] ?? "").trim() };
  const dollar = BLOCK_DOLLAR_PASTE_RE.exec(trimmed);
  if (dollar) return { kind: "block", expression: (dollar[1] ?? "").trim() };
  return null;
}

/** What the popover reads: the formula's kind and source, without its position. */
export interface MathPopoverValue {
  kind: MathKind;
  expression: string;
}

/** The math node at the selection, or null when the cursor is not on one. */
export interface MathSelection extends MathPopoverValue {
  /** Document position of the node, for the in-place update. */
  pos: number;
}

function mathNodeAt(editor: Editor | null): { node: { type: { name: string }; attrs: { expression?: string } }; pos: number } | null {
  if (!editor) return null;
  const { selection } = editor.state;
  const selected = (selection as unknown as { node?: { type: { name: string }; attrs: { expression?: string } } }).node;
  if (selected && (selected.type.name === "inlineMath" || selected.type.name === "blockMath")) {
    return { node: selected, pos: selection.from };
  }
  const { $from } = selection;
  const before = $from.nodeBefore;
  if (before && (before.type.name === "inlineMath" || before.type.name === "blockMath")) {
    return { node: before, pos: $from.pos - before.nodeSize };
  }
  const after = $from.nodeAfter;
  if (after && (after.type.name === "inlineMath" || after.type.name === "blockMath")) {
    return { node: after, pos: $from.pos };
  }
  return null;
}

/** Read the math node the cursor sits on, for the popover's "edit" mode. */
export function readMathSelection(editor: Editor | null): MathSelection | null {
  const found = mathNodeAt(editor);
  if (!found) return null;
  return {
    kind: found.node.type.name === "inlineMath" ? "inline" : "block",
    expression: String(found.node.attrs.expression ?? ""),
    pos: found.pos,
  };
}

/** Replace the formula the cursor sits on, in place. */
function updateMathSelection(editor: Editor, target: MathSelection, expression: string): boolean {
  const { tr } = editor.state;
  tr.setNodeMarkup(target.pos, undefined, { expression });
  editor.view.dispatch(tr);
  return true;
}

/** Options for `applyMath`. */
interface ApplyMathOptions {
  /**
   * Edit the formula under the cursor in place when there is one. Defaults to
   * true, the toolbar's behaviour. Callers that always mean "insert a new
   * formula" (the slash menu) pass false: after the trigger text is deleted the
   * caret can sit directly before an unrelated existing node, and updating it
   * would silently empty that formula.
   */
  updateExisting?: boolean;
}

/**
 * Create or edit a formula: when the cursor is on a math node it is updated in
 * place (unless `updateExisting` is false), otherwise a new node of `kind` is
 * inserted at the selection.
 */
export function applyMath(
  editor: Editor | null,
  kind: MathKind,
  expression: string,
  options: ApplyMathOptions = {},
): void {
  // A read-only document must not be mutated even if a caller reaches this
  // without going through the disabled popover.
  if (!editor?.isEditable) return;
  const target = options.updateExisting === false ? null : readMathSelection(editor);
  if (target) {
    updateMathSelection(editor, target, expression);
    return;
  }
  editor
    .chain()
    .focus()
    .insertContent({ type: kind === "inline" ? "inlineMath" : "blockMath", attrs: { expression } })
    .run();
}

/**
 * The paste normaliser. It must outrank the shared markdown-paste catch-all,
 * which claims nearly every paste; the priority puts its plugin first in the
 * chain, and it returns false for anything that is not a single formula.
 */
export function createMathPasteExtension() {
  return Extension.create({
    name: "mathPaste",
    // The shared markdown-paste catch-all claims nearly every paste, so this
    // plugin must sit earlier in the prop chain to see the event first.
    priority: 1000,
    addProseMirrorPlugins() {
      const { editor } = this;
      return [
        new Plugin({
          key: new PluginKey("mathPaste"),
          props: {
            handlePaste(view, event) {
              const text = event.clipboardData?.getData("text/plain");
              if (!text) return false;
              const parsed = parseMathPaste(text);
              if (!parsed) return false;
              const node = view.state.schema.nodes[parsed.kind === "inline" ? "inlineMath" : "blockMath"];
              if (!node) return false;
              // Stamp the metas ProseMirror uses to tell a paste apart from
              // typing, as the shared paste path does for its own dispatch.
              view.dispatch(
                view.state.tr
                  .replaceSelectionWith(node.create({ expression: parsed.expression }))
                  .setMeta("paste", true)
                  .setMeta("uiEvent", "paste"),
              );
              return true;
            },
          },
        }),
      ];
    },
  });
}

export interface MathPopoverProps {
  /** The formula under the cursor, or null when the cursor is elsewhere. */
  math: MathPopoverValue | null;
  disabled?: boolean;
  /** Apply the formula: update in place when one is selected, else insert. */
  onApply: (kind: MathKind, expression: string) => void;
}

/**
 * The formula control: one popover that creates an inline or block formula and
 * edits the one under the cursor. Seeded from the current formula every time it
 * opens, so editing starts from what the document really holds.
 */
export function MathPopover({ math, disabled = false, onApply }: MathPopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [expression, setExpression] = useState("");

  useEffect(() => {
    if (!open) return;
    setExpression(math?.expression ?? "");
  }, [open, math?.expression]);

  const label = t("office.markdown.math.blockLabel");
  const kind: MathKind = math?.kind ?? "block";

  const apply = () => {
    onApply(kind, expression);
    setOpen(false);
  };

  // The popover is not a form, so Enter has to apply explicitly rather than
  // submit.
  const onFieldKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    apply();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              disabled={disabled}
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={label}
                  aria-pressed={math !== null}
                  aria-disabled={disabled || undefined}
                  data-toolbar-control="insertMath"
                  className="pointer-coarse:min-h-11 pointer-coarse:min-w-11 aria-pressed:bg-surface-selected aria-pressed:text-surface-selected-foreground"
                />
              }
            />
          }
        >
          <Sigma aria-hidden />
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-80 gap-2" data-toolbar-popover="math">
        <Input
          value={expression}
          onChange={(event) => setExpression(event.target.value)}
          onKeyDown={onFieldKeyDown}
          placeholder="E = mc^2"
          aria-label={t("office.markdown.math.latexPlaceholder")}
          data-toolbar-math-input
        />
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" disabled={disabled} onClick={apply} data-toolbar-math-apply>
            {math ? t("office.markdown.math.edit") : t("office.markdown.math.insertBlock")}
          </Button>
          {/* Edit mode updates the formula in place and ignores `kind`, so an
              "Insert inline formula" button would promise an insert it cannot
              do. Hide it while editing; the primary button applies. */}
          {math === null && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                onApply("inline", expression);
                setOpen(false);
              }}
              data-toolbar-math-insert-inline
            >
              <FunctionSquare aria-hidden />
              {t("office.markdown.math.insertInline")}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
