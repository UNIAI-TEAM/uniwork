# Migration register — Documents + Office G1/G2

Plan §2.3: G1-01 holds this register. Any lane that needs migration numbers
takes the next free range here **before** it writes the files, so parallel
lanes never claim the same number. A number is `allocated` once the file
exists on the owning lane's branch; until then the range is `reserved` for
the named task and no one else may use it. Ranges never move once published
— if a task needs more, it claims a new range below; if it needs fewer, the
leftover numbers return to `free`.

| Range | Status | Task | Purpose |
|---|---|---|---|
| 978–983 | allocated | G1-01 / UNI-675 | `documents` table + indexes |
| 984–986 | allocated | G1-01 / UNI-675 | `document_versions` table + indexes |
| 987–989 | allocated | G1-01 / UNI-675 | `document_assets` table + indexes |
| 990–992 | allocated | G1-01 / UNI-675 | `document_shares` table + indexes |
| 993–995 | allocated | G1-01 / UNI-675 | `document_share_links` table + indexes |
| 996–998 | allocated | G1-01 / UNI-675 | `document_access_logs` table + indexes |
| 999–1003 | reserved | G1-07 / UNI-681 | `document_favorites` table + indexes |
| 1004–1009 | reserved | G1-07 / UNI-681 | `document_comments` table + indexes |
| 1010 | reserved | G1-03 | `idempotency_keys.payload_fingerprint` column |
| 1011 | allocated | G1-02 / UNI-676 | `document_settings` table (organization public-link switch) |
| 1012 | allocated | G1-02 / UNI-676 | `documents.public_links` feature + starter plan row |
| 1013+ | free | — | next claimant writes its range here first |

## Rules

- One `CREATE ... CONCURRENTLY` statement per file, so each index consumes
  one number (CLAUDE.md migration rules).
- The register records the owner task, not the migration author: G1-07
  designs the favorites/comments schema, but the numbers were reserved here
  by G1-01 (plan §4 G1-01 note).
- Reserved ranges are a promise, not an obligation: if G1-07 ends up needing
  fewer files, the unused numbers flip back to `free` in the same edit that
  lands the real migrations.
