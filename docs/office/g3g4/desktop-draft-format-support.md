# Desktop draft format support matrix

The restart-to-update boundary flushes the local encrypted draft checkpoint and asks the user to confirm the checkpoint before restarting. An I/O failure aborts the update; it never falls through to restart.

| Existing format | New format | Migration / rollback rule |
| --- | --- | --- |
| v1 (G4-04) | v1 | Read and write in place. |
| v1 | v2 | Add metadata only; preserve ciphertext, checksum, and the `uniwork-office` key namespace. |
| v2 | v1 (rollback) | Read the legacy fields and preserve ciphertext; do not delete or re-encrypt. |

Drafts are local encrypted checkpoints only. An update must never auto-save to the cloud or overwrite the original file. Recovery remains gated by the existing account, deployment, base revision, and edit-access checks.
