# Browser Office draft store (G3-02b)

The browser host now has a production IndexedDB adapter and a WebCrypto key
provider for the G3-D1 Option B design. The adapter stores only ciphertext,
checksums, generation, namespace metadata, and an AES-KW-wrapped per-draft key;
it never writes plaintext or a raw data key to localStorage or IndexedDB.

Every encrypted snapshot is AES-256-GCM authenticated with associated data made
from the complete deployment/account/organization/workspace/document/base pair
and the draft generation. A random 12-byte IV is prefixed to the ciphertext.
The browser wrapping key is non-exportable and persisted as a `CryptoKey` in a
separate IndexedDB store. If IndexedDB, WebCrypto, a transaction, or quota
fails, the operation reports a typed storage error and leaves the last confirmed
record untouched.

`DraftKeyUnwrapPort` in `packages/core/office/draft-key-port.ts` is the
contract-first seam for the auth/session owner. Its response is validated with
Zod and accepts only a browser-wrappable envelope or explicit blocked,
conflict, and locked outcomes. The real endpoint, wire transport, rate limits,
rotation bookkeeping, and audit policy remain pending with that owner; this
lane intentionally does not add an HTTP route.

`clearMemory()` revokes registered object URLs, runs callbacks, and releases
host references while preserving durable ciphertext. `deleteDurable()` is an
explicit generation-bound compare-and-delete. The 2-second scheduler accepts a
checkpoint only when the caller marks the snapshot stable; it does not claim a
keystroke is protected before the IndexedDB transaction completes.

The shared recovery behavior suite and the host unit tests cover namespacing,
account/session isolation, base drift, ambiguous bases, late writes, atomic
generation checks, lock/corruption handling, and storage failures. Fake
IndexedDB is unit-test infrastructure only. Browser durability (real browser
restart, private mode, eviction, and cross-tab persistence) remains pending in
Q-WEB-E2E and must not be inferred from these tests.
