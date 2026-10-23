"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ownership from "../api/endpoints/organization-document-ownership";
import { documentKeys } from "../documents/keys";

/**
 * Documents a member owns, for the deactivation dialog and the "transfer
 * documents" action on a deactivated row (DOC-06, spec §2.2). Kept out of the
 * `org-members` prefix on purpose: the deactivate mutation invalidates that
 * prefix, and a count that refetches under the dialog would flicker the step
 * the admin is reading.
 */
export const memberDocumentOwnershipKeys = {
  member: (orgSlug: string, userId: string) => ["org-document-ownership", orgSlug, userId] as const,
};

/**
 * Throws on an unreadable answer so the caller sees an error ("could not
 * count"), not a zero that would hide the transfer step.
 */
export function useMemberDocumentOwnership(orgSlug: string, userId: string, enabled = true) {
  return useQuery({
    queryKey: memberDocumentOwnershipKeys.member(orgSlug, userId),
    queryFn: async () => {
      const out = await ownership.getMemberDocumentOwnership(orgSlug, userId);
      if (!out) throw new Error("document-ownership: unreadable response");
      return out;
    },
    enabled: enabled && !!orgSlug && !!userId,
    // A count taken for an earlier dialog is not this dialog's count.
    gcTime: 0,
  });
}

/** Where a bulk run stands; also what a retry resumes from. */
export interface BulkTransferProgress {
  bulkId: string;
  /** Opaque cursor of the last committed batch; empty before the first. */
  cursor: string;
  transferred: number;
  skipped: { recipient_not_member: number; self_restricted: number };
}

const START: BulkTransferProgress = {
  bulkId: "",
  cursor: "",
  transferred: 0,
  skipped: { recipient_not_member: 0, self_restricted: 0 },
};

/** A batch failed after `progress` had already committed. The cause is the transport error, when there was one. */
export class BulkTransferFailure extends Error {
  readonly progress: BulkTransferProgress;
  override readonly cause: unknown;
  constructor(progress: BulkTransferProgress, cause?: unknown) {
    super("bulk document transfer stopped");
    this.name = "BulkTransferFailure";
    this.progress = progress;
    this.cause = cause;
  }
}

/**
 * Moves every document of a member to one recipient, 500 at a time (the
 * server's batch cap), echoing `bulk_id` + `cursor` until `has_more` is
 * false. A permission change: it awaits the server and never writes the
 * cache optimistically. Every committed batch invalidates the documents of
 * every workspace right away, so an open tab sees it even if a later batch
 * fails; the failure carries what committed so "try again" resumes there.
 */
export function useBulkTransferMemberDocuments(orgSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      userId: string;
      toUserId: string;
      /** The progress a previous failure carried. */
      resume?: BulkTransferProgress;
      onProgress?: (progress: BulkTransferProgress) => void;
    }): Promise<BulkTransferProgress> => {
      let state = vars.resume ?? START;
      for (;;) {
        let batch: Awaited<ReturnType<typeof ownership.transferMemberDocuments>>;
        try {
          batch = await ownership.transferMemberDocuments(orgSlug, vars.userId, {
            to_user_id: vars.toUserId,
            bulk_id: state.bulkId,
            cursor: state.cursor,
          });
        } catch (err) {
          throw new BulkTransferFailure(state, err);
        }
        // Unreadable: the batch is not known to have committed, so stop where we are.
        if (!batch) throw new BulkTransferFailure(state);
        const previousCursor = state.cursor;
        state = {
          bulkId: batch.bulk_id || state.bulkId,
          cursor: batch.has_more ? batch.cursor : "",
          transferred: state.transferred + batch.transferred,
          skipped: {
            recipient_not_member: state.skipped.recipient_not_member + batch.skipped.recipient_not_member,
            self_restricted: state.skipped.self_restricted + batch.skipped.self_restricted,
          },
        };
        // The lot is committed: tell open tabs now, not after the last batch.
        void qc.invalidateQueries({ queryKey: documentKeys.all });
        vars.onProgress?.(state);
        if (!batch.has_more) return state;
        // has_more with no way forward would loop on the same batch forever.
        if (!state.cursor || state.cursor === previousCursor) throw new BulkTransferFailure(state);
      }
    },
  });
}
