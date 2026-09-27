// DOCX password intent state (P5) — ported semantics of upstream
// apps/docs/src/main/docx-encryption.ts:105-183, re-keyed per document_id
// instead of (webContents, file path).
//
// Two state channels, mirroring upstream:
//   diskPassword[doc]   — the password that opened the current on-disk bytes
//                         (set on decrypt-open and updated on save commit)
//   intents[doc]        — desired password for the NEXT save
//                         (password: string = encrypt with it; null = user
//                         cleared it; absent key = keep the disk password)
// intentRevision is a monotonic counter — the service grant cites a revision
// so a save can never apply an intent newer than the one the grant saw.
//
// The SECRET stays inside this module and flows only into the crypto seam —
// it is never placed in a result, warning, log or audit payload (the contract
// leak scanner treats password-shaped keys as forbidden anyway).

export interface DocPasswordSnapshot {
  /** Effective password for the next save: intent if set, else disk state. */
  password: string | null;
  /** The intent revision this snapshot consumed; null when no intent exists. */
  intentRevision: number | null;
  /** Where the effective password came from — for service bookkeeping only. */
  source: "intent" | "disk" | "none";
}

export class DocPasswordIntents {
  private disk = new Map<string, string>();
  private intents = new Map<string, { password: string | null; revision: number }>();
  private rev = 0;

  /** Record the password that produced the decrypted view of this document.
   * Called by the adapter right after a successful decryptDocx. */
  rememberDiskPassword(documentId: string, password: string): void {
    this.disk.set(documentId, password);
  }

  diskPassword(documentId: string): string | null {
    return this.disk.get(documentId) ?? null;
  }

  isEncryptedSource(documentId: string): boolean {
    return this.disk.has(documentId);
  }

  /** set/clear intent — `password === null` means the user asked to drop
   * encryption on the next save (upstream setDocPassword(path, null)). */
  setIntent(documentId: string, password: string | null): number {
    this.rev += 1;
    this.intents.set(documentId, { password, revision: this.rev });
    return this.rev;
  }

  /** currentDocPasswordIntentRevision — the max issued revision; the service
   * records this on the grant so later intent changes can't slip in. */
  intentRevision(): number {
    return this.rev;
  }

  /** The intent revision that currently applies to one document (0 = none). */
  intentRevisionOf(documentId: string): number {
    return this.intents.get(documentId)?.revision ?? 0;
  }

  /** discardDocPasswordIntents(throughRevision) — drop intents ≤ revision. */
  discardThrough(revision: number): void {
    for (const [doc, intent] of [...this.intents.entries()]) {
      if (intent.revision <= revision) this.intents.delete(doc);
    }
  }

  /** snapshotDocPassword — the effective password for a save about to run.
   * No intent => disk password (encrypted docs stay encrypted by default,
   * matching upstream). No disk state + no intent => unencrypted. */
  snapshot(documentId: string): DocPasswordSnapshot {
    const intent = this.intents.get(documentId);
    if (intent !== undefined) {
      return { password: intent.password, intentRevision: intent.revision, source: "intent" };
    }
    const diskPassword = this.disk.get(documentId);
    if (diskPassword !== undefined) {
      return { password: diskPassword, intentRevision: null, source: "disk" };
    }
    return { password: null, intentRevision: null, source: "none" };
  }

  /** commitDocPasswordSave — after a save succeeded the produced bytes carry
   * the snapshot's password state: disk state becomes the effective password
   * (or is dropped when the effective was null), consumed intents clear. */
  commitSave(documentId: string, snap: DocPasswordSnapshot): void {
    if (snap.password === null) {
      this.disk.delete(documentId);
    } else {
      this.disk.set(documentId, snap.password);
    }
    if (snap.intentRevision !== null) this.discardThrough(snap.intentRevision);
  }

  /** Session teardown: drop both channels for the document (upstream
   * clearDocPasswords on window close). */
  forget(documentId: string): void {
    this.disk.delete(documentId);
    this.intents.delete(documentId);
  }
}
