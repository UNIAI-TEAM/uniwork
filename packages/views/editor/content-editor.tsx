"use client";

import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { cn } from "@uniwork/ui/lib/utils";
import { forwardRef, useEffect, useImperativeHandle } from "react";

export interface ContentEditorProps {
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  className?: string;
  editable?: boolean;
  autoFocus?: boolean;
  onChange?: (value: string) => void;
  onBlur?: (value: string) => void;
}

export interface ContentEditorRef {
  getText: () => string;
  focus: () => void;
}

export const ContentEditor = forwardRef<ContentEditorRef, ContentEditorProps>(function ContentEditor(
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
      StarterKit,
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
        "text-body [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[4em]",
        className,
      )}
    />
  );
});
