"use client";

// UNI-957: a host that keeps several documents mounted in one page (the
// desktop tab strip hides inactive tabs instead of unmounting them) marks
// each document subtree active or inactive. Window/document-level listeners
// (shortcuts, find, slide show keys) and anything else that must act on the
// visible document only read this flag. Without a provider a document is
// active: the web host renders one document per page.
import { createContext, useContext, useRef, type ReactNode, type RefObject } from "react";

const OfficeDocumentActiveContext = createContext(true);

export function OfficeDocumentActiveProvider({ active, children }: { active: boolean; children: ReactNode }) {
  return <OfficeDocumentActiveContext.Provider value={active}>{children}</OfficeDocumentActiveContext.Provider>;
}

/** Whether the surrounding document is the one the user sees. */
export function useOfficeDocumentActive(): boolean {
  return useContext(OfficeDocumentActiveContext);
}

/** The same flag as a ref, for listeners registered once in an effect. */
export function useOfficeDocumentActiveRef(): RefObject<boolean> {
  const active = useOfficeDocumentActive();
  const ref = useRef(active);
  ref.current = active;
  return ref;
}
