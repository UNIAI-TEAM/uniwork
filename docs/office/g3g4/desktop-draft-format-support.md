# Desktop draft format support matrix

The real durable envelope contains version, encrypted, draftId, identity (including account, deployment and document base), generation, checksum, byteLength, updatedAt, nonce and ciphertext. It never stores a key or a plaintext copy. Version 2 adds the `uniwork-office-draft/2` format marker; the encryption, authenticated data and namespace derivation stay unchanged.

| Reader / transition | Supported behavior |
| --- | --- |
| G4-04 legacy reader | Reads v1 only. Never point it directly at v2 rows. |
| G4-07b reader | Reads v1 and v2; refuses corrupt/unsupported rows without hiding or deleting them. |
| Upgrade v1 to v2 | `DesktopDraftStore.migrateFormat(2)` retains each source envelope and atomically changes metadata only. |
| Rollback v2 to legacy v1 | Run `migrateFormat(1)` before restarting into a v1-only reader; removes the v2 marker and retains source ciphertext. |
| Interrupted migration | The G4-07b reader can read the mixed v1/v2 store. Retry the same migration; exclusive retained copies are never overwritten. |

The checkpoint scheduler keeps one pending snapshot per document/draft, records background IO failures, and flushes all pending/in-flight writes. `prepareForRestart` verifies durable ciphertext hashes and seals writes across the confirmation dialog; cancellation reopens writes. A signed update descriptor selects the target draft format before checkpoint confirmation and installation.

Beta and stable use the accepted shared `uniwork-office` key namespace; dev remains separate. Migration never changes identity, ciphertext, nonce, checksum, file namespace, or OS key namespace. Retained `.keep` envelopes are ciphertext backups, not automatically recovered older revisions. No update operation writes to cloud or the original Office file.

Tests reopen the actual store after v1 to v2 and v2 to v1 conversions and recover the same plaintext with the same key store. They also exercise failed atomic replacement, unsupported formats, multi-document flushing, a background IO failure and confirmation cancellation. The native Help-menu update action uses the verifier and durable store, confirms before opening the installer, and reopens writes after cancellation or an installation error. Production automatic updates remain disabled; independent review, visual evidence and final-SHA verification are separate acceptance gates.
