"use client";

import { useTranslation } from "react-i18next";
import { SourceEditor, type SourceEditorProps } from "../source-editor";
import type { HtmlEditorProps } from "./types";

export function HtmlEditor<TSnapshot = unknown>(props: HtmlEditorProps<TSnapshot>) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.html" });
  const sourceProps: SourceEditorProps<TSnapshot> = {
    ...props,
    format: "html",
    title: props.title ?? t("title"),
    onOpen: props.onOpen ? (outcome) => {
      if (outcome.outcome === "opened" || outcome.format === "html") props.onOpen?.(outcome as Parameters<NonNullable<typeof props.onOpen>>[0]);
    } : undefined,
  };
  return <SourceEditor {...sourceProps} />;
}

export type { HtmlEditorProps } from "./types";
