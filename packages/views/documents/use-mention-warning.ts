"use client";

import { useCallback, useRef, useState } from "react";
import { useShareDocument } from "@uniwork/core/documents/hooks-sharing";
import type { DocumentCommentMentionWithoutAccess } from "@uniwork/core/types/document";
import { mentionDisplayName } from "./document-comments-model";

// The pre-send warning state machine of G8-18 (F2-F4, N3): the people the
// caller picked who cannot view the document, the sequential `view` shares,
// and the single comment call that follows them.

type Mention = DocumentCommentMentionWithoutAccess;

export interface MentionWarnState {
  targets: Mention[];
  phase: "idle" | "sharing" | "share_failed" | "partial_failure";
  shared: Mention[];
  failed: Mention[];
}

export function useMentionWarning({
  wsId,
  documentId,
  onShareView,
  sendNow,
}: {
  wsId: string;
  documentId: string;
  /** Replaces the share transport call (`POST /api/v1/documents/{id}/shares`). */
  onShareView?: (userId: string) => Promise<void>;
  /** Sends the comment once; `sharedNames` is kept for the "failed after share" line. */
  sendNow: (sharedNames?: string[]) => Promise<void>;
}) {
  const shareMutation = useShareDocument(wsId, documentId);
  const [warn, setWarn] = useState<MentionWarnState | null>(null);
  const [sharedUserIds, setSharedUserIds] = useState<ReadonlySet<string>>(() => new Set());
  // People already granted `view` in this composer session: a retry after a failed send never shares again.
  const sharedRef = useRef<Set<string>>(new Set());

  // Everyone the pre-send warning listed (upper-cased ids): the post-send notice must not repeat them.
  const warnedRef = useRef<Set<string>>(new Set());

  const resetShared = useCallback(() => {
    warnedRef.current = new Set();
    if (sharedRef.current.size === 0) return;
    sharedRef.current = new Set();
    setSharedUserIds(new Set());
  }, []);

  const open = (targets: Mention[]) => {
    for (const target of targets) warnedRef.current.add(target.user_id.toUpperCase());
    setWarn({ targets, phase: "idle", shared: [], failed: [] });
  };
  // Cancelling the warning un-warns everyone: the user may still edit the body before the next send.
  const close = () => {
    warnedRef.current = new Set();
    setWarn(null);
  };

  const shareThenSend = async (toShare: Mention[]) => {
    if (!warn || warn.phase === "sharing") return;
    setWarn({ ...warn, phase: "sharing", failed: [] });
    const shared = [...warn.shared];
    const failed: Mention[] = [];
    for (const target of toShare) {
      try {
        if (onShareView) await onShareView(target.user_id);
        else await shareMutation.mutateAsync({ principal_type: "user", principal_id: target.user_id, level: "view" });
        shared.push(target);
        sharedRef.current.add(target.user_id.toUpperCase());
      } catch {
        failed.push(target);
      }
    }
    setSharedUserIds(new Set(sharedRef.current));
    if (failed.length === 0) {
      setWarn(null);
      await sendNow(shared.map(mentionDisplayName));
    } else {
      setWarn({ ...warn, phase: shared.length === 0 ? "share_failed" : "partial_failure", shared, failed });
    }
  };

  /** "Send without notifying" and the partial-success "Send comment": one comment call, no further shares. */
  const sendOnly = async () => {
    if (!warn || warn.phase === "sharing") return;
    const sharedNames = warn.shared.map(mentionDisplayName);
    setWarn(null);
    await sendNow(sharedNames.length > 0 ? sharedNames : undefined);
  };

  return { warn, sharedUserIds, sharedRef, warnedRef, open, close, shareThenSend, sendOnly, resetShared };
}
