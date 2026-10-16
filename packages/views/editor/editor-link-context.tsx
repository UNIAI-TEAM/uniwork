"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Where the editor is shown, as far as a link click is concerned. A host sets
 * it so an internal document link can carry its source (`?from=task:<id>`) to
 * the document screen; with no provider nothing is tagged.
 */
export interface EditorLinkContext {
  kind: "task" | "meeting";
  id: string;
}

const Ctx = createContext<EditorLinkContext | null>(null);

export function EditorLinkProvider({
  value,
  children,
}: {
  value: EditorLinkContext;
  children: ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEditorLinkContext(): EditorLinkContext | null {
  return useContext(Ctx);
}
