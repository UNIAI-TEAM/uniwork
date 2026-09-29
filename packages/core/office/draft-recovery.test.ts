import { describe, expect, it } from "vitest";
import {
  cloneCiphertext,
  DraftRecoveryError,
  draftNamespace,
  metadataFromSnapshot,
  sameBase,
  type CheckpointResult,
  type DraftCheckpointRequest,
  type DraftDeleteRequest,
  type DraftIdentity,
  type DraftListRequest,
  type DraftLookup,
  type DraftMetadata,
  type DraftRecoveryAdapter,
  type DraftRecoveryRequest,
  type DraftSession,
  type DraftSnapshot,
  type RecoveryResult,
} from "./draft-recovery";
import {
  runDraftRecoveryAdapterBehaviorSuite,
  type DraftRecoveryBehaviorHarness,
} from "./draft-recovery.behavior";

class InMemoryDraftRecoveryAdapter implements DraftRecoveryAdapter {
  private readonly snapshots = new Map<string, DraftSnapshot>();
  private readonly revoked = new Set<string>();
  private locked = false;
  private failCheckpoint = false;

  constructor(private readonly knownSessions: readonly DraftSession[]) {}

  revoke(sessionId: string): void {
    this.revoked.add(sessionId);
  }

  setLocked(locked: boolean): void {
    this.locked = locked;
  }

  failNextCheckpoint(): void {
    this.failCheckpoint = true;
  }

  async checkpoint({ session, snapshot }: DraftCheckpointRequest): Promise<CheckpointResult> {
    this.assertSession(session);
    this.assertIdentityBelongsToSession(snapshot.identity, session);
    if (this.locked) throw new DraftRecoveryError("draft_recovery_locked", "draft store is locked");
    if (this.failCheckpoint) {
      this.failCheckpoint = false;
      throw new DraftRecoveryError("storage_unavailable", "draft store rejected the checkpoint");
    }
    const previous = this.snapshots.get(snapshot.draftId);
    if (previous) {
      if (snapshot.generation < previous.generation) {
        throw new DraftRecoveryError("generation_conflict", "draft generation moved backwards");
      }
      if (snapshot.generation === previous.generation) {
        if (snapshot.checksum !== previous.checksum) {
          throw new DraftRecoveryError("generation_conflict", "generation is already bound to another checksum");
        }
        return { status: "unchanged", metadata: metadataFromSnapshot(previous, 1_700_000_000_000) };
      }
    }
    const stored = { ...snapshot, ciphertext: cloneCiphertext(snapshot.ciphertext) };
    // A Map replacement models the adapter's atomic transaction: no mutation
    // happens until all snapshot validation above succeeds.
    this.snapshots.set(snapshot.draftId, stored);
    return { status: "stored", metadata: metadataFromSnapshot(stored, 1_700_000_000_000) };
  }

  async list({ session, lookup }: DraftListRequest): Promise<readonly DraftMetadata[]> {
    this.assertSession(session);
    if (lookup) this.assertLookupBelongsToSession(lookup, session);
    return [...this.snapshots.values()]
      .filter((snapshot) => !lookup || matchesLookup(snapshot, lookup))
      .map((snapshot) => metadataFromSnapshot(snapshot, 1_700_000_000_000));
  }

  async recover({ session, lookup, currentBase, liveAccess }: DraftRecoveryRequest): Promise<RecoveryResult> {
    this.assertSession(session);
    this.assertLookupBelongsToSession(lookup, session);
    const candidates = [...this.snapshots.values()].filter((snapshot) => matchesLookup(snapshot, lookup));
    if (candidates.length === 0) return { status: "missing" };
    if (candidates.length > 1) {
      return {
        status: "ambiguous",
        candidates: candidates.map((snapshot) => metadataFromSnapshot(snapshot, 1_700_000_000_000)),
      };
    }
    const candidate = candidates[0];
    if (!candidate) return { status: "missing" };
    const metadata = metadataFromSnapshot(candidate, 1_700_000_000_000);
    if (this.locked) return { status: "locked", metadata, code: "draft_recovery_locked" };
    if (liveAccess !== "edit") return { status: "blocked", metadata, reason: "edit_acl_missing" };
    if (!sameBase(candidate.identity.base, currentBase)) {
      return { status: "conflict", metadata, currentBase, draftBase: candidate.identity.base };
    }
    return { status: "recovered", metadata, ciphertext: cloneCiphertext(candidate.ciphertext) };
  }

  clearMemory(): void {
  }

  async deleteDurable({ session, draftId, generation }: DraftDeleteRequest): Promise<void> {
    this.assertSession(session);
    if (this.locked) throw new DraftRecoveryError("draft_recovery_locked", "draft store is locked");
    const previous = this.snapshots.get(draftId);
    if (!previous) return;
    this.assertIdentityBelongsToSession(previous.identity, session);
    if (previous.generation !== generation) {
      throw new DraftRecoveryError("generation_conflict", "delete generation does not match the durable snapshot");
    }
    this.snapshots.delete(draftId);
  }

  private assertSession(session: DraftSession): void {
    const known = this.knownSessions.some(
      (candidate) => candidate.sessionId === session.sessionId && candidate.accountId === session.accountId,
    );
    if (!known || this.revoked.has(session.sessionId)) {
      throw new DraftRecoveryError("token_expired", "draft session is no longer active");
    }
  }

  private assertIdentityBelongsToSession(identity: DraftIdentity, session: DraftSession): void {
    if (identity.deploymentId !== session.deploymentId || identity.accountId !== session.accountId) {
      throw new DraftRecoveryError("forbidden", "draft identity is outside the session scope");
    }
  }

  private assertLookupBelongsToSession(lookup: DraftLookup, session: DraftSession): void {
    if (lookup.deploymentId !== session.deploymentId || lookup.accountId !== session.accountId) {
      throw new DraftRecoveryError("forbidden", "draft lookup is outside the session scope");
    }
  }
}

function matchesLookup(snapshot: DraftSnapshot, lookup: DraftLookup): boolean {
  const identity = snapshot.identity;
  return (
    identity.deploymentId === lookup.deploymentId &&
    identity.accountId === lookup.accountId &&
    identity.organizationId === lookup.organizationId &&
    identity.workspaceId === lookup.workspaceId &&
    identity.documentId === lookup.documentId &&
    (!lookup.draftId || snapshot.draftId === lookup.draftId) &&
    (!lookup.base || sameBase(identity.base, lookup.base))
  );
}

function createHarness(): DraftRecoveryBehaviorHarness {
  const accountA: DraftSession = {
    sessionId: "session-a",
    deploymentId: "deployment-test",
    accountId: "account-a",
    generation: 1,
  };
  const accountB: DraftSession = {
    sessionId: "session-b",
    deploymentId: "deployment-test",
    accountId: "account-b",
    generation: 1,
  };
  const accountAAfterRestart: DraftSession = {
    sessionId: "session-a-restart",
    deploymentId: "deployment-test",
    accountId: "account-a",
    generation: 2,
  };
  const adapter = new InMemoryDraftRecoveryAdapter([accountA, accountB, accountAAfterRestart]);
  return {
    adapter,
    sessions: { accountA, accountB, accountAAfterRestart },
    revoke: (sessionId) => adapter.revoke(sessionId),
    setLocked: (locked) => adapter.setLocked(locked),
    failNextCheckpoint: () => adapter.failNextCheckpoint(),
  };
}

describe("draft recovery contract", () => {
  it("runs the shared Q8 adapter behavior suite against an in-memory fake", async () => {
    const report = await runDraftRecoveryAdapterBehaviorSuite(createHarness);
    expect(report.passed).toHaveLength(12);
  });

  it("namespaces deployment, account, org, workspace, document, and both base fields", () => {
    // Keep this assertion in the contract suite so an implementation cannot
    // accidentally treat a document id alone as an isolation boundary.
    const identity: DraftIdentity = {
      deploymentId: "dep/a",
      accountId: "acct",
      organizationId: "org",
      workspaceId: "ws",
      documentId: "doc",
      base: { revision: "r/1", version: "v" },
    };
    const namespace = draftNamespace(identity);
    expect(namespace).toContain("dep%2Fa");
    expect(namespace).toContain("acct");
    expect(namespace).toContain("org");
    expect(namespace).toContain("ws");
    expect(namespace).toContain("doc");
    expect(namespace).toContain("r%2F1");
    expect(namespace).toContain("v");
  });
});
