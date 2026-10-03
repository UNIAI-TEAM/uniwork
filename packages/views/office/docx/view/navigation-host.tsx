"use client";

// UNI-924 A6-wire: the live headings outline for the navigation pane. The
// editor handle exposes no `editor.state.doc`/`editor.view`, so the host reads
// the rendered document instead: top-level heading elements are extracted into
// the shared outline shape (see docxOutlineFromElement) and a click scrolls the
// very element the item came from. A MutationObserver keeps the outline fresh
// while the pane is open.

import { useCallback, useEffect, useState } from "react";
import { docxOutlineFromElement, type DocxDomOutline, type DocxOutlineItem } from "./headings-outline";
import { DOCX_SURFACE_SELECTOR } from "./surface-targets";
import { DocxNavigationPane } from "./navigation-pane";

const DOCX_DOCUMENT_ROOT_SELECTOR = `${DOCX_SURFACE_SELECTOR} .doc-page`;

function findDocxDocumentRoot(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return (
    document.querySelector<HTMLElement>(DOCX_DOCUMENT_ROOT_SELECTOR) ??
    document.querySelector<HTMLElement>(".doc-page")
  );
}

export interface DocxNavigationHostProps {
  /** Collapse affordance forwarded to the pane. */
  onClose?: () => void;
  className?: string;
}

/** The navigation pane wired to the rendered document. */
export function DocxNavigationHost({ onClose, className }: DocxNavigationHostProps) {
  const [outline, setOutline] = useState<DocxDomOutline>(() => docxOutlineFromElement(null));

  useEffect(() => {
    const root = findDocxDocumentRoot();
    if (!root) return undefined;
    const read = () => setOutline(docxOutlineFromElement(root));
    read();
    if (typeof MutationObserver === "undefined") return undefined;
    const observer = new MutationObserver(read);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  const onSelect = useCallback(
    (item: DocxOutlineItem) => {
      outline.elementById.get(item.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [outline],
  );

  return <DocxNavigationPane items={outline.items} onSelect={onSelect} onClose={onClose} className={className} />;
}
