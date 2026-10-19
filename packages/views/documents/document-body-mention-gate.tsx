"use client";

import { useState, type RefObject } from "react";
import { useAuthStore } from "@uniwork/core/auth";
import type { DocumentSaveState } from "@uniwork/core/documents/save-state";
import { canAdministerDocument } from "@uniwork/core/permissions";
import type { Document } from "@uniwork/core/types/document";
import { BodyMentionNotice } from "./document-body-mention-notice";
import type { DocumentEditorHandle } from "./document-editor";
import { useBodyMentionHint } from "./use-body-mention-hint";
import { useMentionDeepLink } from "./use-mention-deeplink";

/**
 * The UNI-1968 pair around the page editor, in one place so DocumentWorkspace
 * stays under the line cap: `?mention=1` deep links (scroll + flash the
 * reader's own mention, then drop the parameter — files consume it without a
 * reveal) and the post-save hint naming people newly mentioned who cannot
 * view. `useEditorReady` hands back the callback the workspace passes to the
 * lazy editor as `onReady`.
 */
export function useBodyMentionDeepLink({
  doc,
  editorRef,
}: {
  doc: Document;
  editorRef: RefObject<DocumentEditorHandle | null>;
}): { onEditorReady: () => void } {
  // True once the lazy page editor mounted — the gate for ?mention=1.
  const [editorReady, setEditorReady] = useState(false);
  useMentionDeepLink({
    ready: doc.kind !== "page" || editorReady,
    reveal: (userId) => editorRef.current?.revealMention(userId),
  });
  return { onEditorReady: () => setEditorReady(true) };
}

/**
 * The post-save no-access hint (UNI-1968 W2): after an acknowledged body
 * save, names the people newly mentioned who cannot view the page — they
 * never got the `document_body_mentioned` row. Share grants view to every
 * name and closes; dismiss closes until the mentions change again; a viewer
 * who cannot administer reads the ask-a-manager line.
 */
export function BodyMentionGate({
  wsId,
  doc,
  state,
}: {
  wsId: string;
  doc: Document;
  state: DocumentSaveState;
}) {
  const viewerId = useAuthStore((s) => s.user?.id ?? null);
  const hint = useBodyMentionHint({ wsId, documentId: doc.id, state, baseContent: doc.content });
  const canAdminister =
    canAdministerDocument(doc, { userId: viewerId, orgRole: null, wsRole: null }).allowed ||
    doc.owner_id === viewerId;
  return (
    <BodyMentionNotice
      wsId={wsId}
      documentId={doc.id}
      documentWorkspaceId={doc.workspace_id}
      targets={hint.targets}
      canAdminister={canAdminister}
      onDismiss={hint.dismiss}
      onShared={hint.refreshAfterShare}
    />
  );
}
