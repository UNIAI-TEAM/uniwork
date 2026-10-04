"use client";

/**
 * The Mermaid diagram control (M4): insert a fenced `mermaid` block and show a
 * typed error state when the diagram source does not parse.
 *
 * A diagram is a fenced code block whose info string is `mermaid`, which is
 * exactly what the shared node view already renders live
 * (`packages/views/editor/extensions/code-block-view.tsx` renders
 * `MermaidDiagram` for that language) and what the Markdown serializer writes
 * back as a fence. So the insert helper writes a `codeBlock` node — never a
 * second node type, and never a fork of the renderer.
 *
 * The error state is TYPED (`MermaidValidation`), not a boolean: `invalid`
 * carries the parser's own message, which is the only clue about which line is
 * wrong. It is produced by `mermaid.parse` (which throws on invalid input,
 * unlike `render`, which would paint Mermaid's error graphic into the DOM).
 */
import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/core";
import { useTranslation } from "react-i18next";
import { MermaidDiagram } from "../../../editor/mermaid-diagram";

/** The fence info string that marks a diagram. */
export const MERMAID_LANGUAGE = "mermaid";

/**
 * The starter diagram inserted by the toolbar control: valid on arrival, so the
 * user edits a rendered diagram rather than an empty block that shows an error.
 */
export const MERMAID_TEMPLATE = "graph TD\n  A[Start] --> B[End]\n";

/** The outcome of parsing diagram source, with the parser message on failure. */
export type MermaidValidation =
  | { status: "valid" }
  | { status: "invalid"; message: string };

/**
 * Parse diagram source through Mermaid's own parser. `parse` rejects on
 * invalid syntax; the message it rejects with names the offending token or
 * line, so it is kept verbatim for the error state.
 */
export async function validateMermaidSource(source: string): Promise<MermaidValidation> {
  if (!source.trim()) return { status: "invalid", message: "" };
  try {
    const mermaid = (await import("mermaid")).default;
    await mermaid.parse(source);
    return { status: "valid" };
  } catch (error) {
    return { status: "invalid", message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Insert a fenced `mermaid` block holding the starter template (or a caller's
 * own source) at the selection. Writes the shared `codeBlock` node so the
 * existing node view renders it and the serializer keeps the fence.
 */
export function insertMermaidDiagram(editor: Editor | null, source: string = MERMAID_TEMPLATE): void {
  if (!editor) return;
  editor
    .chain()
    .focus()
    .insertContent({
      type: "codeBlock",
      attrs: { language: MERMAID_LANGUAGE },
      content: source.length > 0 ? [{ type: "text", text: source }] : [],
    })
    .run();
}

/** Parse state for one source string, recomputed when the source changes. */
export function useMermaidValidation(source: string): MermaidValidation {
  const [validation, setValidation] = useState<MermaidValidation>({ status: "valid" });
  useEffect(() => {
    let cancelled = false;
    void validateMermaidSource(source).then((next) => {
      if (!cancelled) setValidation(next);
    });
    return () => {
      cancelled = true;
    };
  }, [source]);
  return validation;
}

export interface MermaidBlockPreviewProps {
  /** The diagram source, as the fenced block holds it. */
  source: string;
  className?: string;
}

/**
 * A diagram block with its typed error state: valid source renders through the
 * shared `MermaidDiagram`; invalid source renders the error with the parser's
 * message instead of a broken canvas.
 */
export function MermaidBlockPreview({ source, className }: MermaidBlockPreviewProps) {
  const { t } = useTranslation();
  const validation = useMermaidValidation(source);
  if (validation.status === "invalid") {
    return (
      <div className="mermaid-diagram mermaid-diagram-error" data-mermaid-error role="alert">
        <div className="mermaid-diagram-error-head">
          <p>{t("office.markdown.diagram.renderError")}</p>
        </div>
        {validation.message.length > 0 && (
          <p className="mermaid-diagram-error-detail" data-mermaid-error-detail>
            {validation.message}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className={className} data-mermaid-preview>
      <MermaidDiagram chart={source} />
    </div>
  );
}
