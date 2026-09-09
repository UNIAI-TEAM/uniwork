"use client";

import { Document } from "@tiptap/extension-document";
import { Paragraph } from "@tiptap/extension-paragraph";
import Placeholder from "@tiptap/extension-placeholder";
import { Text } from "@tiptap/extension-text";
import { EditorContent, useEditor } from "@tiptap/react";
import { cn } from "@uniwork/ui/lib/utils";
import { forwardRef, useEffect, useImperativeHandle } from "react";

const SingleLineDocument = Document.extend({
  content: "paragraph",
});

export interface TitleEditorProps {
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  className?: string;
  editable?: boolean;
  autoFocus?: boolean;
  onChange?: (value: string) => void;
  onBlur?: (value: string) => void;
}

export interface TitleEditorRef {
  getText: () => string;
  focus: () => void;
}

export const TitleEditor = forwardRef<TitleEditorRef, TitleEditorProps>(function TitleEditor(
  {
    value,
    defaultValue,
    placeholder,
    className,
    editable = true,
    autoFocus,
    onChange,
    onBlur,
  },
  ref,
) {
  const initialContent = value ?? defaultValue ?? "";

  const editor = useEditor({
    extensions: [
      SingleLineDocument,
      Paragraph,
      Text,
      Placeholder.configure({
        placeholder: placeholder ?? "",
      }),
    ],
    content: initialContent,
    editable,
    autofocus: autoFocus,
    immediatelyRender: false,
    onUpdate: ({ editor: instance }) => {
      onChange?.(instance.getText());
    },
    onBlur: ({ editor: instance }) => {
      onBlur?.(instance.getText());
    },
  });

  useEffect(() => {
    if (!editor || value === undefined) return;
    if (editor.isFocused) return;
    const current = editor.getText();
    if (current !== value) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [editor, value]);

  useImperativeHandle(
    ref,
    () => ({
      getText: () => editor?.getText() ?? "",
      focus: () => {
        editor?.commands.focus();
      },
    }),
    [editor],
  );

  return (
    <EditorContent
      editor={editor}
      className={cn(
        "text-title [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[1.5em]",
        className,
      )}
    />
  );
});
