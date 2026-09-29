# Browser Office draft keys and recovery

> **Status: DECIDED — G3-D1 approved Option B by the user on 2026-09-29
> (record: `office-g3g4/decisions/gates-2026-09-29.md`).** This document is
> the decision package for UNI-821. It does not authorize a production key
> store, an unlock endpoint, or an IndexedDB schema; those remain follow-up
> work with the auth/session owner.

## Decision

The user approved **Option B: a backend session-bound key envelope with a
non-exportable WebCrypto wrapping key** for protected browser Office drafts.
The security and auth owners still need to specify the envelope API, rotation
policy, and device/session revocation semantics before implementation. Until
that follow-up is complete, browser durable recovery remains blocked.

The host-neutral contract in
`packages/core/office/draft-recovery.ts` is safe to implement before the gate:
it moves encrypted bytes and metadata only, requires the authenticated session
on every operation, and returns explicit `blocked`, `conflict`, `locked`, and
`ambiguous` outcomes. The reusable behavior suite is exercised against an
in-memory fake in `draft-recovery.test.ts`; it is the suite G4-04 should run
against its desktop adapter as well.

## Protected data and attacker assumptions

The draft is an encrypted, authenticated snapshot. Its namespace and metadata
include all of the following: deployment, account, organization, workspace,
document, base revision, base version, generation, checksum, and byte length.
The base is a pair: matching only the revision or only the version is unsafe.
The list operation exposes metadata only; ciphertext is available only through
the recovery operation after the checks below. No operation in this proposal
accepts a raw key or plaintext fallback.

The threat model assumes:

1. Another account can use the same browser profile, including account B after
   account A logs out. A stale callback, tab, or cached query may still run.
2. An attacker can inspect ordinary browser storage and application network
   traffic. Ciphertext, checksums, generation numbers, and opaque identifiers
   are therefore not secrets; key material and plaintext must not be stored
   there.
3. A script that executes in the trusted application origin is out of scope
   for this client-side design. XSS prevention, CSP, dependency integrity, and
   origin isolation remain separate security controls. A compromised origin can
   use any key that the origin is legitimately allowed to unwrap.
4. Backend session tokens, live ACL responses, and deployment identity can
   expire or be revoked between listing and recovery. A cached permission or a
   cached key is not an authority.
5. Storage can be evicted, unavailable, full, corrupted, or locked. A read or
   key failure is a protected-recovery failure, never an empty store; an
   unreadable ciphertext must not be replaced by a new snapshot.
6. Two tabs/devices can checkpoint different bases. The adapter must keep both
   snapshots, use atomic replacement per draft id, and never silently merge
   binary data.

This model does not claim protection from a fully compromised browser, OS, or
origin. It does require fail-closed behavior for account/session/ACL mistakes,
and it keeps the existing Q8 rule that a blocked draft cannot be exported,
copied, or placed on the clipboard to bypass access control.

## Candidate key designs

### Option A — backend-wrapped per-account data key (alternative)

The backend creates or rotates a random per-account/deployment data key. The
browser stores only an envelope encrypted for a WebCrypto non-exportable key
and receives an unwrap assertion bound to the current backend session. Draft
ciphertext is AES-256-GCM (or the backend-approved AEAD) with associated data
containing the complete namespace and generation. The browser key never leaves
WebCrypto; a session-bound unwrap assertion is required after restart.

*Advantages:* no raw key in IndexedDB or JavaScript objects after the unwrap
operation; the backend can revoke an account/device session and can rotate an
envelope without rewriting every draft; the same envelope protocol can be
implemented by desktop main/OS credential storage later.

*Costs:* needs a new auth-owned endpoint and a carefully reviewed session
binding; an account cannot recover drafts while the backend is unavailable;
browser profile cloning does not clone a non-exportable key, so an explicit
device enrollment/recovery policy is needed.

### Option B — backend session-bound unwrap of a per-draft key

Each draft has a random data key. The backend returns an envelope for that
draft only after checking the live session, deployment, account, scope, and
edit ACL. The browser keeps a non-exportable wrapping key and asks to unwrap
the draft key when it recovers a particular snapshot.

*Advantages:* least privilege and small blast radius; ACL checks happen at the
exact recovery operation; deleting one draft can retire its key independently.

*Costs:* more backend round trips and key envelopes; an account with many
drafts must recover each key; rotation and migration bookkeeping are larger.

### Option C — browser-generated non-exportable key with backend escrow

The browser generates a per-deployment/account non-exportable key and sends an
escrow envelope to an auth-owned backend endpoint. After restart, the endpoint
returns the escrow envelope only for the current session and live scope.

*Advantages:* the backend never handles plaintext draft keys; browser storage
contains only an opaque escrow envelope and ciphertext; the browser can make
checkpoints without a key request each time.

*Costs:* recovery is tied to the browser key's lifecycle; profile reset or
private-mode eviction requires a separate recovery ceremony; device/session
revocation and multi-device rotation are difficult; an escrow endpoint still
has to be specified and audited. This option must not silently fall back to a
new key, because that would make old ciphertext look like an empty draft.

### Recommendation and gate boundary

The approved choice is **Option B**. Its bounded unwrap endpoint must bind the
response to the session generation, deployment, account, organization,
workspace, document, base pair, and requested draft generation. Option A
remains an operational alternative if per-draft envelopes prove too
expensive; Option C remains a fallback only when the product accepts a
deliberate device-recovery ceremony and documents its loss semantics.

Option B is the approved design, but no production implementation is
authorized until its follow-up endpoint and rotation semantics are reviewed.
In particular, `localStorage`, a constant key in the bundle, an account id in
a storage-key name, a raw key beside ciphertext, and plaintext JSON are all
rejected, including behind feature flags and test shortcuts.

## Key lifetime, rotation, and loss

- A wrapping/data key is scoped to one deployment and account. The namespace is
  not itself a security boundary; the session and unwrap policy are.
- A key is usable only while the backend session generation is active. Logout,
  refresh failure, account switch, and an explicit device revoke invalidate the
  session. The browser clears decrypted bytes and object URLs immediately but
  leaves durable ciphertext for the same account's next login.
- Rotation creates a new envelope/key generation. Existing ciphertext remains
  decryptable through the old envelope until migration is confirmed; a failed
  migration never overwrites the old ciphertext. The adapter generation and
  checksum make retries idempotent.
- If the key is lost, locked, or the ciphertext fails authentication, recovery
  returns `draft_recovery_locked` and retains the old bytes. It must not create
  an empty draft, overwrite the unreadable row, or claim that recovery
  succeeded. A user-facing recovery/reset action is a future product decision.
- A checksum is an integrity/diagnostic field for ciphertext. AEAD
  authentication is the security check; a checksum alone never authorizes
  decryption.

## Recovery and lifecycle rules

1. A two-second checkpoint is local only. The adapter atomically stores one
   encrypted snapshot with a monotonically increasing generation and checksum.
   A failed transaction returns a typed storage error and leaves the previous
   snapshot intact; keystrokes not included in a confirmed checkpoint are not
   promised durable.
2. `clearMemory` is separate from `deleteDurable`. Logout/account switch
   clears plaintext, decrypted models, object URLs, and callbacks, but does not
   delete durable ciphertext. `deleteDurable` is explicit, compare-and-delete,
   and generation-bound so an old Save result cannot remove a newer draft.
3. `list` returns metadata only. It never returns ciphertext or plaintext. A
   caller must supply a current session; account/deployment mismatch is
   forbidden and a revoked session is `token_expired`.
4. `recover` requires the current session, a live `edit` ACL decision, the
   complete deployment/account/org/workspace/document identity, and both base
   fields. A missing base with multiple candidates is `ambiguous`; an exact
   base mismatch is `conflict`; missing edit access is `blocked`.
5. Restart/login for the same account can recover a checkpoint. Login as B
   cannot list or recover A's draft, even if B guesses A's document id. A late
   callback from A is rejected by the session generation and cannot write into
   B's scope.
6. A local storage/key failure is shown as “not protected”/recovery locked.
   “Keep draft” must not close the editor while pretending the checkpoint was
   durable, and it must not promise to preserve a key that was never written.

## Endpoint ownership and pending work

The **auth/session owner** should own any unlock or envelope endpoint because it
controls session generation, refresh, device revoke, and audit policy. The
Office FE-CORE owner consumes its typed response; it must not create a second
auth route or decide ACL from cached document state. The endpoint, if approved,
must define request/response schemas, correlation/audit behavior, rate limits,
session binding, rotation/revoke semantics, and malformed-response handling
before the browser host wires it.

This lane deliberately does **not** create the endpoint, an IndexedDB store,
WebCrypto key provider, or a production cleanup registration. G4-04 may reuse
the contract and behavior suite with an OS credential adapter after G4-D2.

## Evidence and acceptance mapping

The in-memory suite covers: atomic checkpoint and clone boundaries; metadata-only
list; clear-memory versus durable delete; logout/restart/session expiry; account
isolation; live ACL blocked; revision+version conflict; distinct bases and
ambiguous lookup; locked/corrupt store; failed local checkpoint; and
generation-bound deletion. It is not browser durability or cryptographic
evidence. Those require the approved G3-D1 design, a real host store, and live
ACL integration at H1.
