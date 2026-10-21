"use client";

import { AskUniFocusButton } from "../ai/ask-uni-focus-button";
import { DocumentCommentsHeaderActions, useDocumentCommentsChrome } from "./document-comments-context";

/** The detail header's controls: "Hỏi UNI" (whenever the header shows) and the comments cluster (flag-gated). */
export function DocumentHeaderActions() {
  const chrome = useDocumentCommentsChrome();
  return (
    <>
      {chrome ? <AskUniFocusButton kind="document" id={chrome.doc.id} title={chrome.doc.title} workspaceId={chrome.wsId} /> : null}
      <DocumentCommentsHeaderActions />
    </>
  );
}
