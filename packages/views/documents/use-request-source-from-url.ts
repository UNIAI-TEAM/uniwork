"use client";

import { useEffect, useRef, useState } from "react";
import { useOptionalNavigation } from "../navigation";
import { dropSearchParams } from "./drop-search-params";
import type { DocumentAccessRequestSource } from "./document-locked-card";

// A task id as the editor link carries it (`?from=task:<ULID>`, access addendum
// §3.1). Meeting links are deferred (Q5); anything else is dropped silently.
const FROM_TASK = /^task:([0-9A-HJKMNP-TV-Z]{26})$/i;

function readFromParam(value: string | null | undefined): DocumentAccessRequestSource | null {
  const match = FROM_TASK.exec(value ?? "");
  return match?.[1] ? { kind: "task", id: match[1] } : null;
}

/**
 * Reads `?from=` once per document and takes it off the address (`replace`),
 * so a copied or shared URL never carries the task id; the value lives on in
 * state for the locked card's request. A client navigation to another document
 * reads its own `from` instead of keeping the previous one.
 */
export function useRequestSourceFromUrl(documentId: string): DocumentAccessRequestSource | null {
  const nav = useOptionalNavigation();
  const [held, setHeld] = useState(() => ({ documentId, source: readFromParam(nav?.searchParams.get("from")) }));
  let current = held;
  if (held.documentId !== documentId) {
    current = { documentId, source: readFromParam(nav?.searchParams.get("from")) };
    setHeld(current);
  }
  const navRef = useRef(nav);
  navRef.current = nav;
  const hasFrom = nav?.searchParams.has("from") ?? false;
  useEffect(() => {
    if (navRef.current && hasFrom) dropSearchParams(navRef.current, ["from"]);
  }, [hasFrom]);
  return current.source;
}
