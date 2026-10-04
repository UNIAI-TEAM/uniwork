"use client";

/**
 * The code-block controls (M4): a language picker and a copy button for the
 * code block the cursor sits in.
 *
 * The existing node view (`packages/views/editor/extensions/code-block-view.tsx`)
 * already owns the in-block affordances — a language caption, the HTML
 * preview toggle and its own copy button — and takes no slot, so this is the
 * CONTEXTUAL toolbar the brief's C9 allows: it renders nothing unless the
 * selection is inside a code block, and it drives the live editor through the
 * M2 actions (`updateAttributes("codeBlock", { language })`), never through a
 * second copy of the node.
 *
 * Copy goes through `copyText` (the product's clipboard helper, which falls
 * back to `execCommand` on plain http://) and the "copied" mark is gated on
 * its boolean result, so a refused clipboard never claims success.
 */
import { useState } from "react";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { Check, ChevronDown, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { copyText } from "@uniwork/ui/lib/clipboard";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";

/**
 * The languages the picker offers: plain text first, then the common
 * grammars the shared lowlight instance registers (plus `mermaid` and `html`,
 * which the node view renders live). Lowlight only highlights a registered
 * grammar; anything else stays plaintext, which is why the list is finite.
 */
export const CODE_BLOCK_LANGUAGES: readonly string[] = [
  "plaintext",
  "javascript",
  "typescript",
  "python",
  "go",
  "rust",
  "java",
  "cpp",
  "csharp",
  "css",
  "html",
  "json",
  "sql",
  "bash",
  "yaml",
  "mermaid",
];

/** The language a fenced block with no info string carries. */
export const PLAIN_TEXT_LANGUAGE = "plaintext";

/** The code block the cursor is inside, as the toolbar reads it. */
export interface CodeBlockInfo {
  /** The block's `language` attribute; empty string when the fence had none. */
  language: string;
  /** The block's exact text, for the copy control. */
  text: string;
}

export interface CodeBlockToolbarProps {
  /** Null when the selection is not inside a code block: the control hides. */
  codeBlock: CodeBlockInfo | null;
  disabled?: boolean;
  /** Set the current block's `language` attribute. */
  onLanguageChange: (language: string) => void;
  /** Copy the current block's text; resolves true when it reached the clipboard. */
  onCopy: () => Promise<boolean>;
}

/** The code block the cursor sits in, read from the live editor, or null. */
function readCodeBlock(editor: Editor | null): CodeBlockInfo | null {
  if (!editor || !editor.isActive("codeBlock")) return null;
  const language = (editor.getAttributes("codeBlock") as { language?: string }).language ?? "";
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === "codeBlock") return { language, text: node.textContent };
  }
  return null;
}

/**
 * The contextual control's props, driven by the live editor: null `codeBlock`
 * outside a code block (so the caller renders nothing), the picker writing
 * `language` through `updateAttributes`, and the copy control reading the
 * block's text and writing it through the product clipboard helper.
 */
export function useCodeBlockToolbar(editor: Editor | null): CodeBlockToolbarProps {
  const codeBlock = useEditorState({
    editor,
    selector: ({ editor: live }) => readCodeBlock(live),
  });
  return {
    codeBlock: codeBlock ?? null,
    onLanguageChange: (language) => {
      editor?.chain().focus().updateAttributes("codeBlock", { language }).run();
    },
    onCopy: () => copyText(codeBlock?.text ?? ""),
  };
}

/** The language name shown for one menu entry ("plaintext" reads as prose). */
export function codeBlockLanguageLabel(language: string): string {
  return language;
}

export function CodeBlockToolbar({ codeBlock, disabled = false, onLanguageChange, onCopy }: CodeBlockToolbarProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  if (!codeBlock) return null;

  const language = codeBlock.language || PLAIN_TEXT_LANGUAGE;

  const handleCopy = async () => {
    if (!codeBlock.text) return;
    if (await onCopy()) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      className="flex shrink-0 items-center gap-0.5"
      data-code-block-toolbar
      data-code-block-language={language}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              aria-label={t("office.markdown.code.language")}
              aria-disabled={disabled || undefined}
              data-toolbar-control="codeBlockLanguage"
              className="h-[22px] min-w-24 justify-between gap-1.5 px-1.5 text-caption font-normal pointer-coarse:min-h-11"
            />
          }
        >
          <span className="truncate">{language === PLAIN_TEXT_LANGUAGE ? t("office.markdown.code.plain") : codeBlockLanguageLabel(language)}</span>
          <ChevronDown aria-hidden className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-44" data-toolbar-menu="codeBlockLanguage">
          {CODE_BLOCK_LANGUAGES.map((option) => (
            <DropdownMenuItem
              key={option}
              onClick={() => onLanguageChange(option)}
              data-code-block-language-option={option}
              className={cn("gap-2", option === language && "bg-surface-selected text-surface-selected-foreground")}
            >
              <span className="flex-1">
                {option === PLAIN_TEXT_LANGUAGE ? t("office.markdown.code.plain") : codeBlockLanguageLabel(option)}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("office.markdown.code.copy")}
        aria-disabled={disabled || undefined}
        data-toolbar-control="codeBlockCopy"
        className="pointer-coarse:min-h-11 pointer-coarse:min-w-11"
        onClick={() => {
          void handleCopy();
        }}
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      </Button>
    </div>
  );
}
