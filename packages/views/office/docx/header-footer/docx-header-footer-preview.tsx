"use client";

import { useEffect, useRef } from "react";
import type { DocxHeaderFooter } from "@uniwork/office-engine/docx";
import { makeGapHfEl, type RendererHeaderFooter } from "@uniwork/office-upstream/docs-renderer-editor";

export interface DocxHeaderFooterPreviewProps {
  /** The part to render; null shows nothing (the panel renders its empty state). */
  value: DocxHeaderFooter | null;
  kind: "header" | "footer";
  /** Page number substituted for the PAGE field; 1 when absent. */
  pageNo?: number | string;
  /** Total substituted for the NUMPAGES field; 1 when absent. */
  pageTotal?: number;
  /** Accessible name, e.g. "Header preview". */
  label: string;
  className?: string;
}

/**
 * Task A13: a live preview of one header/footer slot. The strip element is
 * built by the same vendored makeGapHfEl the pagination canvas mounts, so the
 * panel shows the real strip rendering (run styling, paragraph spacing, tabs,
 * PAGE/NUMPAGES substitution) instead of a second, approximate renderer.
 */
export function DocxHeaderFooterPreview({
  value,
  kind,
  pageNo = 1,
  pageTotal = 1,
  label,
  className,
}: DocxHeaderFooterPreviewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    if (!value) {
      host.replaceChildren();
      return undefined;
    }
    // DocxHeaderFooter carries the same fields the renderer reads; the shim's
    // paragraph type is the structural twin of what the engine parse and
    // applyHfText produce.
    const stripValue: RendererHeaderFooter = {
      text: value.text,
      ...(value.pageNumber ? { pageNumber: true } : {}),
      ...(Array.isArray(value.paras) && value.paras.length > 0
        ? { paras: value.paras as RendererHeaderFooter["paras"] }
        : {}),
    };
    const strip = makeGapHfEl({ kind, value: stripValue, pageNo, pageTotal });
    // The canvas anchors strips absolutely inside .page-wrap; the panel shows
    // the same element in flow at the panel's width instead.
    strip.style.position = "relative";
    strip.style.left = "auto";
    strip.style.transform = "none";
    strip.style.width = "100%";
    strip.style.boxSizing = "border-box";
    strip.style.paddingRight = "0";
    host.replaceChildren(strip);
    return () => host.replaceChildren();
  }, [value, kind, pageNo, pageTotal]);

  return (
    <div
      ref={hostRef}
      role="img"
      aria-label={label}
      data-testid="docx-header-footer-preview"
      className={className}
    />
  );
}
