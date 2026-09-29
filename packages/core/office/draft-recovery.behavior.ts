import {
  DraftRecoveryError,
  type DraftBase,
  type DraftIdentity,
  type DraftRecoveryAdapter,
  type DraftSession,
  type DraftSnapshot,
} from "./draft-recovery";

/**
 * Controls supplied by a fake or a host adapter test double. They keep the
 * behavior suite independent of IndexedDB, filesystem APIs, and keychain
 * implementations while still exercising the failure paths that both hosts
 * must expose.
 */
export interface DraftRecoveryBehaviorHarness {
  readonly adapter: DraftRecoveryAdapter;
  readonly sessions: {
    readonly accountA: DraftSession;
    readonly accountB: DraftSession;
    readonly accountAAfterRestart: DraftSession;
  };
  revoke(sessionId: string): void;
  setLocked(locked: boolean): void;
  failNextCheckpoint(): void;
}

export interface DraftRecoveryBehaviorReport {
  readonly passed: readonly string[];
}

/**
 * Execute the shared Q8 adapter assertions. The function throws on the first
 * contract violation, so a desktop host can import this exact suite and use
 * its own fake without importing browser or Vitest dependencies.
 */
export async function runDraftRecoveryAdapterBehaviorSuite(
  createHarness: () => DraftRecoveryBehaviorHarness,
): Promise<DraftRecoveryBehaviorReport> {
  const harness = createHarness();
  const { adapter, sessions } = harness;
  const baseA: DraftBase = { revision: "r-1", version: "v-1" };
  const baseB: DraftBase = { revision: "r-2", version: "v-2" };
  const identityA: DraftIdentity = {
    deploymentId: "deployment-test",
    accountId: "account-a",
    organizationId: "org-a",
    workspaceId: "workspace-a",
    documentId: "document-a",
    base: baseA,
  };
  const identityB: DraftIdentity = { ...identityA, accountId: "account-b" };
  const snapshotA: DraftSnapshot = {
    draftId: "draft-a",
    identity: identityA,
    generation: 1,
    checksum: "sha256:ciphertext-a",
    ciphertext: Uint8Array.from([0xa1, 0xb2, 0xc3]),
  };
  const snapshotB: DraftSnapshot = {
    draftId: "draft-b",
    identity: { ...identityA, base: baseB },
    generation: 1,
    checksum: "sha256:ciphertext-b",
    ciphertext: Uint8Array.from([0xd4, 0xe5]),
  };

  const passed: string[] = [];
  await expectStored(adapter, sessions.accountA, snapshotA);
  passed.push("atomic checkpoint stores encrypted snapshot");

  const listed = await adapter.list({ session: sessions.accountA, lookup: identityLookup(identityA) });
  assert(listed.length === 1, "list returns the stored metadata");
  assert(!Object.prototype.hasOwnProperty.call(listed[0], "ciphertext"), "list metadata has no ciphertext");
  assert(listed[0]?.byteLength === snapshotA.ciphertext.byteLength, "metadata reports ciphertext length only");
  passed.push("list is metadata-only");

  await expectError(
    () => adapter.checkpoint({ session: sessions.accountA, snapshot: { ...snapshotA, generation: 0 } }),
    "invalid_snapshot",
    "an invalid checkpoint is rejected before durable mutation",
  );
  const afterInvalidCheckpoint = await adapter.recover({
    session: sessions.accountA,
    lookup: identityLookup(identityA),
    currentBase: baseA,
    liveAccess: "edit",
  });
  assert(
    afterInvalidCheckpoint.status === "recovered" && afterInvalidCheckpoint.metadata.generation === snapshotA.generation,
    "an invalid checkpoint leaves the previous durable snapshot intact",
  );

  const recovered = await adapter.recover({
    session: sessions.accountA,
    lookup: identityLookup(identityA),
    currentBase: baseA,
    liveAccess: "edit",
  });
  assert(recovered.status === "recovered", "matching session, ACL, and both base fields recover");
  if (recovered.status === "recovered") {
    assert(recovered.ciphertext[0] === snapshotA.ciphertext[0], "recovery returns ciphertext bytes");
    recovered.ciphertext[0] = 0;
  }
  const reread = await adapter.recover({
    session: sessions.accountA,
    lookup: identityLookup(identityA),
    currentBase: baseA,
    liveAccess: "edit",
  });
  assert(reread.status === "recovered" && reread.ciphertext[0] === snapshotA.ciphertext[0], "recovery bytes are cloned");
  passed.push("recovery requires live edit access and both base halves");

  await adapter.clearMemory();
  const afterMemoryClear = await adapter.list({ session: sessions.accountA, lookup: identityLookup(identityA) });
  assert(afterMemoryClear.length === 1, "clear-memory leaves durable ciphertext");
  passed.push("clear-memory is separate from durable deletion");

  harness.revoke(sessions.accountA.sessionId);
  await expectError(
    () => adapter.list({ session: sessions.accountA, lookup: identityLookup(identityA) }),
    "token_expired",
    "logout revokes the old session",
  );
  await expectError(
    () => adapter.checkpoint({ session: sessions.accountA, snapshot: { ...snapshotA, generation: 2 } }),
    "token_expired",
    "a late checkpoint from the revoked session cannot write",
  );
  const afterRestart = await adapter.recover({
    session: sessions.accountAAfterRestart,
    lookup: identityLookup(identityA),
    currentBase: baseA,
    liveAccess: "edit",
  });
  assert(
    afterRestart.status === "recovered" && afterRestart.metadata.generation === snapshotA.generation,
    "restart/login restores the same account's draft and the late write did not land",
  );
  passed.push("logout/restart/login A preserves durable draft but old session cannot read");

  await expectError(
    () => adapter.list({ session: sessions.accountB, lookup: identityLookup(identityA) }),
    "forbidden",
    "account B cannot list account A's draft",
  );
  const accountBResult = await adapter.recover({
    session: sessions.accountB,
    lookup: identityLookup(identityB),
    currentBase: baseA,
    liveAccess: "edit",
  });
  assert(accountBResult.status === "missing", "account B has no account A candidate");
  await expectError(
    () => adapter.deleteDurable({ session: sessions.accountB, draftId: snapshotA.draftId, generation: snapshotA.generation }),
    "forbidden",
    "account B cannot delete account A's draft by id",
  );
  passed.push("account isolation binds lookup to the authenticated account");

  const blocked = await adapter.recover({
    session: sessions.accountAAfterRestart,
    lookup: identityLookup(identityA),
    currentBase: baseA,
    liveAccess: "none",
  });
  assert(blocked.status === "blocked", "lost live edit ACL blocks recovery");
  passed.push("live ACL loss returns blocked without deleting bytes");

  const conflict = await adapter.recover({
    session: sessions.accountAAfterRestart,
    lookup: identityLookup(identityA),
    currentBase: baseB,
    liveAccess: "edit",
  });
  assert(conflict.status === "conflict", "revision or version drift returns conflict");

  // Revision and version are an inseparable base pair. Check each half on its
  // own so an adapter cannot accidentally compare only whichever field is
  // most convenient for its host storage format.
  const revisionOnlyDrift = await adapter.recover({
    session: sessions.accountAAfterRestart,
    lookup: identityLookup(identityA),
    currentBase: { revision: "r-drift", version: baseA.version },
    liveAccess: "edit",
  });
  assert(revisionOnlyDrift.status === "conflict", "revision-only drift returns conflict");
  const versionOnlyDrift = await adapter.recover({
    session: sessions.accountAAfterRestart,
    lookup: identityLookup(identityA),
    currentBase: { revision: baseA.revision, version: "v-drift" },
    liveAccess: "edit",
  });
  assert(versionOnlyDrift.status === "conflict", "version-only drift returns conflict");
  passed.push("base drift returns conflict and keeps the draft");

  await expectStored(adapter, sessions.accountAAfterRestart, snapshotB);
  const ambiguous = await adapter.recover({
    session: sessions.accountAAfterRestart,
    lookup: { ...identityLookup(identityA), base: undefined },
    currentBase: baseA,
    liveAccess: "edit",
  });
  assert(ambiguous.status === "ambiguous", "omitting base with multiple candidates is explicit");
  if (ambiguous.status === "ambiguous") {
    assert(ambiguous.candidates.every((candidate) => !("ciphertext" in candidate)), "ambiguous candidates have no bytes");
  }
  passed.push("distinct bases remain separate and ambiguous selection is metadata-only");

  harness.setLocked(true);
  const locked = await adapter.recover({
    session: sessions.accountAAfterRestart,
    lookup: identityLookup(identityA),
    currentBase: baseA,
    liveAccess: "edit",
  });
  assert(locked.status === "locked" && locked.code === "draft_recovery_locked", "key/ciphertext failure is locked");
  await expectError(
    () => adapter.checkpoint({ session: sessions.accountAAfterRestart, snapshot: { ...snapshotA, generation: 2 } }),
    "draft_recovery_locked",
    "a locked store refuses a new checkpoint instead of overwriting unreadable bytes",
  );
  harness.setLocked(false);
  const afterLocked = await adapter.recover({
    session: sessions.accountAAfterRestart,
    lookup: identityLookup(identityA),
    currentBase: baseA,
    liveAccess: "edit",
  });
  assert(afterLocked.status === "recovered", "locked recovery leaves old ciphertext untouched");
  passed.push("key loss/corruption is locked and never treated as empty");

  harness.failNextCheckpoint();
  await expectError(
    () => adapter.checkpoint({ session: sessions.accountAAfterRestart, snapshot: { ...snapshotA, generation: 2 } }),
    "storage_unavailable",
    "local checkpoint failure is typed",
  );
  const afterCheckpointFailure = await adapter.recover({
    session: sessions.accountAAfterRestart,
    lookup: identityLookup(identityA),
    currentBase: baseA,
    liveAccess: "edit",
  });
  assert(afterCheckpointFailure.status === "recovered", "failed checkpoint retains the previous snapshot");
  passed.push("local checkpoint failure reports not-protected and retains the previous draft");

  await expectError(
    () => adapter.deleteDurable({ session: sessions.accountAAfterRestart, draftId: snapshotA.draftId, generation: 0 }),
    "generation_conflict",
    "stale delete cannot remove a draft",
  );
  await adapter.deleteDurable({ session: sessions.accountAAfterRestart, draftId: snapshotA.draftId, generation: snapshotA.generation });
  const deleted = await adapter.recover({
    session: sessions.accountAAfterRestart,
    lookup: identityLookup(identityA),
    currentBase: baseA,
    liveAccess: "edit",
  });
  assert(deleted.status === "missing", "only explicit compare-and-delete removes a draft");
  passed.push("durable deletion is explicit and generation-bound");

  return { passed };
}

function identityLookup(identity: DraftIdentity) {
  return {
    deploymentId: identity.deploymentId,
    accountId: identity.accountId,
    organizationId: identity.organizationId,
    workspaceId: identity.workspaceId,
    documentId: identity.documentId,
    base: identity.base,
  };
}

async function expectStored(
  adapter: DraftRecoveryAdapter,
  session: DraftSession,
  snapshot: DraftSnapshot,
): Promise<void> {
  const result = await adapter.checkpoint({ session, snapshot });
  assert(result.status === "stored" || result.status === "unchanged", "checkpoint accepts a valid snapshot");
}

async function expectError(
  operation: () => Promise<unknown>,
  code: string,
  message: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    assert(error instanceof DraftRecoveryError && error.code === code, message);
    return;
  }
  throw new Error(message);
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
