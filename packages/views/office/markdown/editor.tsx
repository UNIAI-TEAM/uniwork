"use client";

import { useTranslation } from "react-i18next";
import { SourceEditor, type SourceEditorProps } from "../source-editor";
import type { MarkdownEditorProps } from "./types";

export function MarkdownEditor<TSnapshot = unknown>(props: MarkdownEditorProps<TSnapshot>) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.markdown" });
  const sourceProps: SourceEditorProps<TSnapshot> = {
    ...props,
    format: "md",
    title: props.title ?? t("title"),
    permissions: props.permissions,
    onOpen: props.onOpen ? (outcome) => {
      if (outcome.outcome === "opened" || outcome.format === "md") props.onOpen?.(outcome as Parameters<NonNullable<typeof props.onOpen>>[0]);
    } : undefined,
  };
  return <SourceEditor {...sourceProps} />;
}

export type { MarkdownEditorProps } from "./types";
