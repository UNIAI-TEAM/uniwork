"use client";

import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { Node, type JSONContent } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import { Plugin } from "@tiptap/pm/state";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Suggestion, type SuggestionProps } from "@tiptap/suggestion";
import { useTranslation } from "react-i18next";
import { isImeComposing } from "@uniwork/core/utils";
import { cn } from "@uniwork/ui/lib/utils";
import { entityKindIcon } from "./ask-uni-entity";
import { AskUniObjectPicker, type AskUniObjectKind, type AskUniObjectPickerHandle } from "./ask-uni-object-picker";
import { serializeQuestion, type AskUniMentionCard } from "./ask-uni-question";

const KINDS: AskUniObjectKind[] = ["task", "document", "meeting", "project", "member", "room"];

// The frame around the editor shows focus (as the Textarea primitive does with its own ring), so the editor draws none.
const EDITOR_CLASS = cn(
  "max-h-[8lh] overflow-y-auto px-1 py-1 font-sans text-title-sm tracking-normal outline-none md:text-body",
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
  key(event: KeyboardEvent): boolean;
  allow(doc: JSONContent): boolean;
  submit(doc: JSONContent): void;
}

function toQuestion(doc: JSONContent): AskUniQuestion {
  const { text, mentions } = serializeQuestion(doc);
  return { question: text, mentions: mentions.map(({ kind, id }) => ({ kind, id })) };
}

/** A card in the sentence: the kind's icon and the object's name, as plain text. */
function AskUniToken({ node, selected }: NodeViewProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai.picker.tabs" });
  const { kind, label } = node.attrs as AskUniMentionCard;
  const Icon = entityKindIcon(kind === "room" ? "chat" : kind);
  return (
    <NodeViewWrapper
      as="span"
      role="img"
      aria-label={`${t(kind)}: ${label}`}
      className={cn(
        "mx-0.5 inline-flex max-w-64 cursor-default items-center gap-1 rounded-md bg-muted px-1.5 align-baseline text-foreground",
        selected && "ring-2 ring-ring",
      )}
    >
      <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{label}</span>
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
    addNodeView: () => ReactNodeViewRenderer(AskUniToken),
    addProseMirrorPlugins() {
      return [
        Suggestion<unknown, AskUniMentionCard>({
          editor: this.editor,
          char: "@",
          allow: ({ state }) => hooks().allow(state.doc.toJSON()),
          command: ({ editor, range, props }) => {
            editor.commands.insertContentAt(range, [{ type: "askUniMention", attrs: props }, { type: "text", text: " " }]);
          },
          render: () => ({
            onStart: (props) => hooks().open(props),
            onUpdate: (props) => hooks().open(props),
            onExit: () => hooks().open(null),
            onKeyDown: ({ event }) => hooks().key(event),
          }),
        }),
        new Plugin({
          props: {
            handleKeyDown(view, event) {
              // ProseMirror skips keys during a composition; the event flags cover what it misses. Telex/VNI confirm with Enter.
              if (event.key !== "Enter" || event.shiftKey || view.composing || isImeComposing(event)) return false;
              hooks().submit(view.state.doc.toJSON());
              return true;
            },
          },
        }),
      ];
    },
  });
}

/**
 * Ask UNI's question box: plain text with line breaks, where `@` opens the object picker and a pick becomes a card in
 * the sentence. Enter submits the question with its cards; Shift+Enter breaks the line. The host positions the picker
 * (it sits above the nearest positioned ancestor).
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
    key(event) {
      // Escape closes the picker only, not a sheet around the panel.
      if (event.key === "Escape") event.stopPropagation();
      // While the picker is open Enter picks or does nothing; it never sends.
      return picker.current?.onKeyDown(event) || (event.key === "Enter" && !event.shiftKey && !isImeComposing(event));
    },
    allow(doc) {
      const max = latest.current.maxMentions;
      const ok = serializeQuestion(doc).mentions.length < max;
      if (!ok) setNotice(t("mention.limit", { max }));
      return ok;
    },
    submit(doc) {
      const q = toQuestion(doc);
      if (q.question) latest.current.onSubmit(q);
    },
  };

  const [extensions] = useState(() => [
    // Plain text, line breaks and undo: a question carries no formatting.
    StarterKit.configure({
      blockquote: false, bold: false, bulletList: false, code: false, codeBlock: false, dropcursor: false, gapcursor: false,
      heading: false, horizontalRule: false, italic: false, link: false, listItem: false, listKeymap: false,
      orderedList: false, strike: false, trailingNode: false, underline: false,
    }),
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
      // Only plain text comes in: no formatting, and never a card from pasted HTML.
      handlePaste(view, event) {
        const tr = view.state.tr;
        (event.clipboardData?.getData("text/plain") ?? "").replace(/\r\n?/g, "\n").split("\n").forEach((line, i) => {
          if (i > 0) tr.replaceSelectionWith(view.state.schema.nodes.hardBreak!.create(), false);
          if (line) tr.insertText(line);
        });
        view.dispatch(tr.scrollIntoView());
        return true;
      },
    },
    onUpdate: ({ editor: e }) => onChange?.(toQuestion(e.getJSON())),
  });

  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);

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
      isEmpty: () => !editor || toQuestion(editor.getJSON()).question === "",
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
            onPick={(item) => suggestion.current?.command({ kind: item.kind, id: item.id, label: item.title })}
            // The suggestion plugin closes itself after Escape.
            onDismiss={() => undefined}
          />
        </div>
      ) : null}
      <EditorContent editor={editor} />
      {notice ? (
        <p role="status" className="px-1 text-caption text-destructive">
          {notice}
        </p>
      ) : null}
    </>
  );
});
