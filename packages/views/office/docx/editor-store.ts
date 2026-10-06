"use client";

// UNI-957: the per-document DOCX scope. Chrome that lives in another React
// subtree from the toolbar context (find panel, status bar, Insert image, the
// context menu, the view zoom, ribbon dialogs) reads its document's live TipTap
// editor, Find visibility, zoom controller and root element from here. Each
// DocxEditor owns one scope, so two DOCX documents mounted in one page (the
// desktop keeps inactive tabs mounted, only hidden) never share any of it.
import type { Editor } from "@tiptap/core";
import { createContext, createElement, useContext, useSyncExternalStore, type ReactNode } from "react";
import { createDocxZoomController, type DocxZoomController } from "./view/zoom-controller";

interface DocxScopeCell<T> {
  get(): T;
  set(next: T): void;
  subscribe(listener: () => void): () => void;
}

function createCell<T>(initial: T): DocxScopeCell<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export interface DocxDocumentScope {
  /** The live TipTap editor; null while no document is open. */
  readonly editor: DocxScopeCell<Editor | null>;
  /** Find panel visibility (toolbar toggle and the panel slot sit in different subtrees). */
  readonly find: DocxScopeCell<boolean>;
  /** The zoom controller the View tab, the status bar and the chrome mount share. */
  readonly zoom: DocxZoomController;
  /** The document's own root element; DOM lookups never leave it. */
  readonly root: { current: HTMLElement | null };
  /** Publish the editor; a teardown (null) also closes Find, the way Word starts a document. */
  publishEditor(editor: Editor | null): void;
}

export function createDocxDocumentScope(): DocxDocumentScope {
  const editor = createCell<Editor | null>(null);
  const find = createCell(false);
  let releaseDestroy: (() => void) | null = null;
  const publishEditor = (next: Editor | null): void => {
    if (next === editor.get()) return;
    releaseDestroy?.();
    releaseDestroy = null;
    if (next) {
      // A destroyed editor leaves the scope at once, whoever destroyed it.
      const onDestroy = () => {
        if (editor.get() === next) publishEditor(null);
      };
      next.on("destroy", onDestroy);
      releaseDestroy = () => next.off("destroy", onDestroy);
    } else {
      find.set(false);
    }
    editor.set(next);
  };
  return {
    editor,
    find,
    zoom: createDocxZoomController(),
    root: { current: null },
    publishEditor,
  };
}

const DocxDocumentScopeContext = createContext<DocxDocumentScope | null>(null);

export function DocxDocumentScopeProvider({ scope, children }: { scope: DocxDocumentScope; children: ReactNode }) {
  return createElement(DocxDocumentScopeContext.Provider, { value: scope }, children);
}

/** The surrounding document's scope. There is no page-wide fallback (review
 *  r1 m3): DOCX chrome mounted outside a DocxEditor is a wiring bug, and a
 *  shared default would quietly bring the old singleton back. */
export function useDocxDocumentScope(): DocxDocumentScope {
  return requireDocxScope(useContext(DocxDocumentScopeContext));
}

/** For chrome that may also be handed its scope or controller explicitly. */
export function useOptionalDocxDocumentScope(): DocxDocumentScope | null {
  return useContext(DocxDocumentScopeContext);
}

export function requireDocxScope<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error("docx_document_scope_missing: render DOCX chrome inside a DocxEditor (DocxDocumentScopeProvider)");
  }
  return value;
}

export function useDocxScopeValue<T>(cell: DocxScopeCell<T>): T {
  return useSyncExternalStore(cell.subscribe, cell.get, cell.get);
}

/** The live editor of the surrounding document. */
export function useDocxLiveEditor(): Editor | null {
  return useDocxScopeValue(useDocxDocumentScope().editor);
}
