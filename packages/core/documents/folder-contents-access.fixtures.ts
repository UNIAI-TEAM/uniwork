// Wire bodies of the folder contents access routes (UNI-2244, spec §3), shared
// by the core tests and the views tests that mock the transport. Test-only:
// nothing in production code imports this file.

/** 200 to PUT .../contents-access with dry_run, merge: nothing is lost. */
export const dryRunMerge = {
  total: 42,
  preview: {
    changed: 37,
    unchanged: 0,
    skipped_not_manageable: 5,
    skipped_locked: 0,
    losing_users: 0,
    downgraded_users: 0,
    warnings: [] as string[],
  },
};

/** 200 to the same call with replace: people lose access, the folder may go private. */
export const dryRunReplace = {
  total: 42,
  preview: {
    changed: 37,
    unchanged: 0,
    skipped_not_manageable: 5,
    skipped_locked: 0,
    losing_users: 12,
    downgraded_users: 3,
    warnings: ["wide_scope", "to_private"],
  },
};

/** 200 to the real write of a small subtree. */
export const syncResult = {
  batch_id: "01JBATCHSYNC0000000000000",
  mode: "sync",
  total: 42,
  changed: 37,
  unchanged: 0,
  skipped_not_manageable: 5,
  skipped_locked: 0,
};

/** 202 to the real write of a large subtree: a background batch was queued. */
export const backgroundAccepted = {
  batch_id: "01JBATCHBG000000000000000",
  mode: "background",
  total: 1800,
};

/** GET .../contents-access/{batchID} while the worker is part-way. */
export const batchRunning = {
  batch_id: "01JBATCHBG000000000000000",
  status: "running",
  total: 1800,
  processed: 600,
  changed: 590,
  unchanged: 0,
  skipped_not_manageable: 10,
  skipped_locked: 0,
  finished_at: null as string | null,
};

export const batchCompleted = {
  batch_id: "01JBATCHBG000000000000000",
  status: "completed",
  total: 1800,
  processed: 1800,
  changed: 1750,
  unchanged: 20,
  skipped_not_manageable: 25,
  skipped_locked: 5,
  finished_at: "2026-10-27T10:15:00Z" as string | null,
};

/** The worker stopped early; what it already wrote stays written. */
export const batchFailed = {
  batch_id: "01JBATCHBG000000000000000",
  status: "failed",
  total: 1800,
  processed: 800,
  changed: 780,
  unchanged: 0,
  skipped_not_manageable: 20,
  skipped_locked: 0,
  finished_at: "2026-10-27T10:05:00Z" as string | null,
};

/** GET while queued or running, as the server sends it: `finished_at` is omitted, not null. */
export const batchRunningWire: Omit<typeof batchRunning, "finished_at"> = {
  batch_id: "01JBATCHBG000000000000000",
  status: "running",
  total: 1800,
  processed: 600,
  changed: 590,
  unchanged: 0,
  skipped_not_manageable: 10,
  skipped_locked: 0,
};

/** 422: the id names a document that is not a folder. */
export const errorNotAFolder = {
  error: { code: "not_a_folder", message: "Document is not a folder" },
};

/** 409: a batch for this folder is already running; its id rides the fields. */
export const errorBatchRunning = {
  error: {
    code: "folder_access_batch_running",
    message: "An access batch is already running for this folder",
    fields: { batch_id: "01JBATCHBG000000000000000" },
  },
};

/** 422: one or more principals were refused; nothing was written. */
export const errorAccessRejected = {
  error: {
    code: "document_access_rejected",
    message: "Some principals were rejected",
    fields: {
      rejected: [{ index: 1, principal_type: "user", principal_id: "u9", code: "principal_not_in_organization" }],
    },
  },
};
