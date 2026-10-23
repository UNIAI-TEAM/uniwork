import type { FileDisposition } from "../types/file";

/**
 * Query keys for resolved files. Every key carries the principal (the signed-in
 * user id) and the context the files are read through (today the upload
 * session in one workspace), never the file id alone: a resolve answer is
 * authorized for that person in that context, and another account on the same
 * browser must never be served it (spec 2026-09-22 §8).
 */
export const fileKeys = {
  all: ["files"] as const,
  principal: (principalId: string) => [...fileKeys.all, principalId] as const,
  uploads: (principalId: string, wsId: string) =>
    [...fileKeys.principal(principalId), "uploads", wsId] as const,
  uploadBatch: (
    principalId: string,
    wsId: string,
    fileIds: readonly string[],
    disposition: FileDisposition,
  ) => [...fileKeys.uploads(principalId, wsId), disposition, [...fileIds]] as const,
};
