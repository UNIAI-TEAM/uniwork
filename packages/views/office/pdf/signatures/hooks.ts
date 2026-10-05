"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createSavedSignature,
  deleteSavedSignature,
  listSavedSignatures,
  type SavedSignatureInput,
} from "@uniwork/core/api/endpoints/signatures";
import type { SavedSignature } from "./types";

/** Query keys for the saved-signature surface. Signatures are personal but
 *  scoped to one organization, so the organization id is part of the key: a
 *  switch of organization must not read another tenant's cached rows. */
export const savedSignatureKeys = {
  all: (orgId: string) => ["saved-signatures", orgId] as const,
  list: (orgId: string) => [...savedSignatureKeys.all(orgId), "list"] as const,
};

/** Raised when an endpoint answers in a shape the picker cannot read as a
 *  completed write — a null save or an unproven delete. The transport already
 *  keeps a drifted body from throwing; this keeps it from reading as success. */
export class SavedSignatureRequestError extends Error {
  readonly code: "unusable_response" | "unconfirmed_delete";

  constructor(code: SavedSignatureRequestError["code"], message: string) {
    super(message);
    this.name = "SavedSignatureRequestError";
    this.code = code;
  }
}

/** The caller's own signatures in one organization, newest first. Disabled
 *  while there is no organization id, so the query never fires a request that
 *  could only 404. */
export function useSavedSignatures(orgId: string) {
  return useQuery({
    queryKey: savedSignatureKeys.list(orgId),
    queryFn: ({ signal }) => listSavedSignatures(orgId, signal),
    enabled: orgId !== "",
  });
}

export function useSaveSignature(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SavedSignatureInput): Promise<SavedSignature> => {
      const saved = await createSavedSignature(orgId, input);
      if (!saved) throw new SavedSignatureRequestError("unusable_response", "the saved signature could not be read back");
      return saved;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: savedSignatureKeys.list(orgId) }),
  });
}

export function useDeleteSignature(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (signatureId: string): Promise<string> => {
      const deleted = await deleteSavedSignature(orgId, signatureId);
      if (!deleted) throw new SavedSignatureRequestError("unconfirmed_delete", "the delete was not confirmed by the server");
      return signatureId;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: savedSignatureKeys.list(orgId) }),
  });
}
