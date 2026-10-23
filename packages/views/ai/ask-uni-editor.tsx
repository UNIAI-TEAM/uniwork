"use client";

import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { Node, type Editor, type JSONContent } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";
import { Plugin } from "@tiptap/pm/state";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { exitSuggestion, Suggestion, SuggestionPluginKey, type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import { useTranslation } from "react-i18next";
import { isImeComposing } from "@uniwork/core/utils";
import { cn } from "@uniwork/ui/lib/utils";
import { EditorBubbleMenu } from "../editor/bubble-menu";
// Lists, quotes and code inside the box take the editor's prose styles, and the toolbar its own.
import "../editor/styles/index.css";
import { CHIP, entityKindIcon, TaskStatusLabel, useKindLabel } from "./ask-uni-entity";
import { AskUniObjectPicker, type AskUniObjectKind, type AskUniObjectPickerHandle } from "./ask-uni-object-picker";
import { serializeQuestion, type AskUniMentionCard } from "./ask-uni-question";

const KINDS: AskUniObjectKind[] = ["task", "document", "meeting", "project", "member", "room"];

// The frame around the editor shows focus (as the Textarea primitive does with its own ring), so the editor draws none.
const EDITOR_CLASS = cn(
  "rich-text-editor max-h-[8lh] overflow-y-auto px-1 py-1 font-sans text-title-sm tracking-normal outline-none md:text-body",
  "[&_.is-editor-empty]:before:pointer-events-none [&_.is-editor-empty]:before:float-left [&_.is-editor-empty]:before:h-0",
  "[&_.is-editor-empty]:before:text-muted-foreground [&_.is-editor-empty]:before:content-[attr(data-placeholder)]",
);

export interface AskUniQuestion {
  question: string;
  mentions: { kind: AskUniObjectKind; id: string }[];
}

export interface AskUniEditorHandle {
  clear(): void;
  focus(): void;
  isEmpty(): boolean;
}

interface Props {
  wsId: string;
  placeholder: string;
  disabled?: boolean;
  /** Distinct cards a question may carry; at the limit an `@` shows a notice instead of the picker. */
  maxMentions: number;
  onSubmit(question: AskUniQuestion): void;
  onChange?(question: AskUniQuestion): void;
}

type Open = SuggestionProps<unknown, AskUniMentionCard>;

/** What the mention node needs from the component, read through a getter so the node (built once) sees the latest. */
interface Hooks {
  open(props: Open | null): void;
  key(props: SuggestionKeyDownProps): boolean;
  allow(doc: JSONContent): boolean;
  submit(editor: Editor): void;
}

/** The question as the box's markdown (a card reads as its label), "" while it holds no text, and the cards it names, each once. */
function toQuestion(editor: Editor): AskUniQuestion {
  const { text, mentions } = serializeQuestion(editor.getJSON());
  // Empty paragraphs at either end are no part of it (TipTap writes a second empty one in a row as &nbsp;).
  const question = text ? editor.getMarkdown().replace(/^(?:\s|&nbsp;)+|(?:\s|&nbsp;)+$/g, "") : "";
  return { question, mentions: mentions.map(({ kind, id }) => ({ kind, id })) };
}

/** A card in the sentence: the kind's icon and the object's name, as plain text. */
function AskUniToken({ node, selected }: NodeViewProps) {
  const { kind, id, label } = node.attrs as AskUniMentionCard;
  // A chat room is drawn and named as the answer's chips do it.
  const entityKind = kind === "room" ? "chat" : kind;
  const kindLabel = useKindLabel(entityKind);
  const Icon = entityKindIcon(entityKind);
  // The editor's shell.css keeps the wrapper itself inline (it wins over a class), so the card is a span inside it.
  return (
    <NodeViewWrapper as="span" className="inline">
      <span role="img" aria-label={`${kindLabel}: ${label}`} className={cn(CHIP, "cursor-default", selected && "ring-2 ring-ring")}>
        <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{label}</span>
        {kind === "task" ? <TaskStatusLabel taskId={id} /> : null}
      </span>
    </NodeViewWrapper>
  );
}

function askUniMention(hooks: () => Hooks) {
  return Node.create({
    name: "askUniMention",
    // Above the default keymaps (100): an open picker, then Enter-to-send, see each key first.
    priority: 101,
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    addAttributes: () => ({ kind: { default: "task" }, id: { default: "" }, label: { default: "" } }),
    // No parse rule: pasted or dropped HTML never turns into a card.
    parseHTML: () => [],
    renderHTML: ({ node }) => ["span", { "data-ask-uni-mention": node.attrs.kind }, node.attrs.label],
    renderText: ({ node }) => node.attrs.label,
    // Escaped as TipTap escapes typed text, so a name never reads as formatting.
    renderMarkdown: (node) => String(node.attrs?.label ?? "").replace(/([\\`*_[\]~])/g, "\\$1"),
    addNodeView: () => ReactNodeViewRenderer(AskUniToken),
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        Suggestion<unknown, AskUniMentionCard>({
          editor: this.editor,
          char: "@",
          // Titles have spaces: the query runs on past one ("@Việc nhắc") until it finds nothing.
          allowSpaces: true,
          allow: ({ state }) => hooks().allow(state.doc.toJSON()),
          command: ({ editor, range, props }) => {
            const next = editor.state.doc.resolve(range.to).nodeAfter;
            const spaced = next?.isText && /^\s/.test(next.text ?? "");
            editor.commands.insertContentAt(range, [{ type: "askUniMention", attrs: props }, ...(spaced ? [] : [{ type: "text", text: " " }])]);
          },
          render: () => ({
            onStart: (props) => hooks().open(props),
            onUpdate: (props) => hooks().open(props),
            onExit: () => hooks().open(null),
            onKeyDown: (props) => hooks().key(props),
          }),
        }),
        new Plugin({
          props: {
            handleKeyDown(view, event) {
              if (event.key !== "Enter") return false;
              // An IME confirming a Telex/VNI syllable: never a send, and the document stays as it is.
              if (view.composing || isImeComposing(event)) return true;
              // In a list or code block the keymaps keep Enter (a new item or line) and Shift+Enter (a line break).
              const inBlock = editor.isActive("listItem") || editor.isActive("codeBlock");
              // Elsewhere Shift+Enter opens a paragraph, where "- " or "> " starts a list or a quote.
              if (event.shiftKey) return !inBlock && editor.commands.splitBlock();
              // Mod+Enter sends from anywhere.
              if (!event.metaKey && !event.ctrlKey && inBlock) return false;
              hooks().submit(editor);
              return true;
            },
          },
        }),
      ];
    },
  });
}

/**
 * Ask UNI's question box: text with inline marks, lists, quotes and code, sent as markdown, where `@` opens the object
 * picker and a pick becomes a card in the sentence. Enter submits the question with its cards and Shift+Enter opens a
 * paragraph; in a list or code block they add an item or a line, and Mod+Enter submits. Selecting text shows the
 * formatting toolbar.
 * The host positions the picker (it sits above the nearest positioned ancestor).
 */
export const AskUniEditor = forwardRef<AskUniEditorHandle, Props>(function AskUniEditor(
  { wsId, placeholder, disabled = false, maxMentions, onSubmit, onChange },
  ref,
) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai" });
  const listboxId = useId();
  const picker = useRef<AskUniObjectPickerHandle>(null);
  const suggestion = useRef<Open | null>(null);
  const wantsFocus = useRef(false);
  const [query, setQuery] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string>();
  const [notice, setNotice] = useState("");
  const latest = useRef({ placeholder, maxMentions, onSubmit });
  latest.current = { placeholder, maxMentions, onSubmit };

  const hooks = useRef<Hooks | null>(null);
  hooks.current = {
    open(props) {
      suggestion.current = props;
      setQuery(props ? props.query : null);
      if (props) setNotice("");
    },
    key({ view, event, range }) {
      // Escape closes the picker only, not a sheet around the panel.
      if (event.key === "Escape") event.stopPropagation();
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        // As in a text field, the tabs take an arrow only at that edge of the @word; elsewhere it moves the caret.
        const { empty, from, $from } = view.state.selection;
        const next = $from.nodeAfter;
        const edge = event.key === "ArrowLeft" ? from === range.from + 1 : !next?.isText || /^\s/.test(next.text ?? "");
        if (!empty || !edge) return false;
      }
      if (picker.current?.onKeyDown(event)) return true;
      if (event.key !== "Enter" || event.shiftKey || isImeComposing(event)) return false;
      // A settled empty list gives Enter back: the picker closes and the text goes as typed. While loading Enter waits.
      if (picker.current?.isEmpty() && !picker.current.isLoading()) {
        exitSuggestion(view);
        hooks.current!.submit(editor!);
      }
      return true;
    },
    allow(doc) {
      const max = latest.current.maxMentions;
      const ok = serializeQuestion(doc).mentions.length < max;
      if (!ok) setNotice(t("mention.limit", { max }));
      return ok;
    },
    submit(e) {
      const q = toQuestion(e);
      if (q.question) latest.current.onSubmit(q);
    },
  };

  const [extensions] = useState(() => [
    // What markdown carries in a question: bold, italic, strike, code, lists, quotes and code blocks; no headings,
    // rules, links or underline.
    StarterKit.configure({
      dropcursor: false, gapcursor: false, heading: false, horizontalRule: false, link: false, trailingNode: false, underline: false,
    }),
    Markdown.configure({ indentation: { style: "space", size: 3 } }),
    Placeholder.configure({ placeholder: () => latest.current.placeholder }),
    askUniMention(() => hooks.current!),
  ]);

  const open = query !== null;
  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions,
    editorProps: {
      // ProseMirror owns these; a new set reaches the DOM on the next render.
      attributes: {
        class: EDITOR_CLASS,
        "aria-label": t("composer_label"),
        ...(placeholder ? { "aria-placeholder": placeholder } : {}),
        ...(disabled ? { "aria-disabled": "true" } : {}),
        ...(open
          ? {
              role: "combobox",
              "aria-expanded": "true",
              "aria-haspopup": "listbox",
              "aria-autocomplete": "list",
              "aria-controls": listboxId,
              ...(activeId ? { "aria-activedescendant": activeId } : {}),
            }
          : { role: "textbox", "aria-multiline": "true" }),
      },
      // Only plain text comes in: no pasted formatting, and never a card from pasted HTML.
      handlePaste(view, event) {
        const tr = view.state.tr;
        const text = (event.clipboardData?.getData("text/plain") ?? "").replace(/\r\n?/g, "\n");
        // A code block holds its own line breaks.
        if (view.state.selection.$from.parent.type.spec.code) {
          view.dispatch(tr.insertText(text).scrollIntoView());
          return true;
        }
        text.split("\n").forEach((line, i) => {
          if (i > 0) tr.replaceSelectionWith(view.state.schema.nodes.hardBreak!.create(), false);
          if (line) tr.insertText(line);
        });
        view.dispatch(tr.scrollIntoView());
        return true;
      },
    },
    onUpdate: ({ editor: e }) => {
      const q = toQuestion(e);
      if (q.mentions.length < maxMentions) setNotice("");
      onChange?.(q);
    },
    // The custom render has no outside-click dismiss of its own: leaving the box closes the picker.
    onBlur: ({ editor: e }) => {
      if (SuggestionPluginKey.getState(e.state)?.active) exitSuggestion(e.view);
    },
  });

  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);

  // The placeholder is a decoration: an empty transaction redraws it when the text changes.
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr);
  }, [editor, placeholder]);

  // A focus asked for before the editor existed lands once it does.
  useEffect(() => {
    if (!editor || !wantsFocus.current) return;
    wantsFocus.current = false;
    editor.view.focus();
  }, [editor]);

  useImperativeHandle(
    ref,
    () => ({
      clear() {
        editor?.commands.clearContent(true);
        setNotice("");
      },
      focus() {
        if (editor) editor.view.focus();
        else wantsFocus.current = true;
      },
      isEmpty: () => !editor || toQuestion(editor).question === "",
    }),
    [editor],
  );

  return (
    <>
      {open ? (
        <div className="absolute inset-x-0 bottom-full z-10 mb-1 rounded-lg bg-surface-raised p-1 shadow-[var(--menu-shadow)] ring-1 ring-surface-border">
          <AskUniObjectPicker
            ref={picker}
            wsId={wsId}
            query={query}
            kinds={KINDS}
            listboxId={listboxId}
            onActiveChange={setActiveId}
            // A phrase with a space that matches nothing is the reader writing on, not naming an object.
            onSettledEmpty={() => {
              if (editor && /\s/.test(query)) exitSuggestion(editor.view);
            }}
            onPick={(item) => suggestion.current?.command({ kind: item.kind, id: item.id, label: item.title })}
            // The suggestion plugin closes itself after Escape.
            onDismiss={() => undefined}
          />
        </div>
      ) : null}
      {/* One flex item, so the always-mounted notice adds no gap while it is empty. */}
      <div>
        <EditorContent editor={editor} />
        {editor ? <EditorBubbleMenu editor={editor} variant="question" /> : null}
        <p role="status" className="px-1 text-caption text-destructive">
          {notice}
        </p>
      </div>
    </>
  );
});
