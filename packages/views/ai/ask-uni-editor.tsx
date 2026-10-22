"use client";

import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { Node, type JSONContent } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import { Plugin } from "@tiptap/pm/state";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { exitSuggestion, Suggestion, SuggestionPluginKey, type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import { useTranslation } from "react-i18next";
import { isImeComposing } from "@uniwork/core/utils";
import { cn } from "@uniwork/ui/lib/utils";
import { CHIP, entityKindIcon, TaskStatusLabel, useKindLabel } from "./ask-uni-entity";
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
  key(props: SuggestionKeyDownProps): boolean;
  allow(doc: JSONContent): boolean;
  submit(doc: JSONContent): void;
}

function toQuestion(doc: JSONContent): AskUniQuestion {
  const { text, mentions } = serializeQuestion(doc);
  return { question: text, mentions: mentions.map(({ kind, id }) => ({ kind, id })) };
}

/** A card in the sentence: the kind's icon and the object's name, as plain text. */
function AskUniToken({ node, selected }: NodeViewProps) {
  const { kind, id, label } = node.attrs as AskUniMentionCard;
  // A chat room is drawn and named as the answer's chips do it.
  const entityKind = kind === "room" ? "chat" : kind;
  const kindLabel = useKindLabel(entityKind);
  const Icon = entityKindIcon(entityKind);
  return (
    <NodeViewWrapper as="span" role="img" aria-label={`${kindLabel}: ${label}`} className={cn(CHIP, "cursor-default", selected && "ring-2 ring-ring")}>
      <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{label}</span>
      {kind === "task" ? <TaskStatusLabel taskId={id} /> : null}
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
              if (event.key !== "Enter" || event.shiftKey) return false;
              // An IME confirming a Telex/VNI syllable: never a send, and the document stays as it is.
              if (view.composing || isImeComposing(event)) return true;
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
        hooks.current!.submit(view.state.doc.toJSON());
      }
      return true;
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
    onUpdate: ({ editor: e }) => {
      const q = toQuestion(e.getJSON());
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
        <p role="status" className="px-1 text-caption text-destructive">
          {notice}
        </p>
      </div>
    </>
  );
});
