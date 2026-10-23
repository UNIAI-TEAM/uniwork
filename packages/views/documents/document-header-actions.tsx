"use client";

import { AskUniFocusButton } from "../ai/ask-uni-focus-button";
import { useAskUniPageContext } from "../ai/ask-uni-page-context";
import { DocumentCommentsHeaderActions, useDocumentCommentsChrome } from "./document-comments-context";

/** The detail header's controls: "Hỏi UNI" (whenever the header shows) and the comments cluster (flag-gated). */
export function DocumentHeaderActions() {
  const chrome = useDocumentCommentsChrome();
  useAskUniPageContext(chrome ? { kind: "document", id: chrome.doc.id, label: chrome.doc.title } : null);
  return (
    <>
      {chrome ? <AskUniFocusButton kind="document" id={chrome.doc.id} title={chrome.doc.title} workspaceId={chrome.wsId} /> : null}
      <DocumentCommentsHeaderActions />
    </>
  );
}
