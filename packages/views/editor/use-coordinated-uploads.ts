"use client";

/** Stub until draft-upload coordinator ports with Task 5–6. */
export function useCoordinatedUploads(_opts?: unknown) {
  return {
    uploads: [] as unknown[],
    start: async () => null,
    abort: () => {},
    hasUploading: false,
  };
}
