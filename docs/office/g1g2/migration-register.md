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
| after 998 | timestamped | any | `999<unix-ms>_name` - no range to claim; list the files here when they land |
| 9991790519637301 | allocated | G1-03 / UNI-677 | `idempotency_keys.payload_fingerprint` column |
| 9991790521814499 | allocated | G2-02 / UNI-685 | `office_jobs` table |
| 9991790521814500 | allocated | G2-02 / UNI-685 | `uidx_office_jobs_idempotency` (org, workspace, idempotency_key) |
| 9991790521814501 | allocated | G2-02 / UNI-685 | `uidx_office_jobs_live_fingerprint` (one live job per base + payload) |
| 9991790521814502 | allocated | G2-02 / UNI-685 | `idx_office_jobs_live_deadline` (reconciler sweep) |
| 9991790521814503 | allocated | G2-02 / UNI-685 | `idx_office_jobs_output_file` (FileService reference lookup) |
| 9991790522571159 | allocated | G1-02 / UNI-676 | `9991790522571159_document_settings` - `document_settings` table (organization public-link switch) |
| 9991790522571160 | allocated | G1-02 / UNI-676 | `9991790522571160_documents_public_links_feature` - `documents.public_links` feature + starter plan row |
| 9991790532871902 | allocated | G1-07 / UNI-681 | `9991790532871902_document_comments` - `document_comments` table (threaded document comments on the shared comment core) |
| 9991790532871903 | allocated | G1-07 / UNI-681 | `9991790532871903_document_comments_document_idx` - comment list index `(document_id, created_at)` |
| 9991790532871904 | allocated | G1-07 / UNI-681 | `9991790532871904_document_favorites` - `document_favorites` table (server-side per-user favorites) |
| 9991790532871905 | allocated | G1-07 / UNI-681 | `9991790532871905_document_favorites_user_idx` - favorites list index `(organization_id, user_id, created_at)` |

## Rules

- The three-digit space ends at `998` (user decision 2026-09-27). sqlc reads
  `server/migrations/` in string order, so a four-digit `1010_` sorted before
  `154_` and broke `make sqlc`. Every later migration is
  `999<unix-milliseconds>_descriptive_name`; the shared `999` head and fixed
  width make string order equal numeric order. The earlier reservations
  (999-1003 and 1004-1009 for G1-07, 1010 for G1-03, 1011-1012 for G1-02b) are
  void: those tasks name their files this way instead. `999_` and bare
  four-digit prefixes fail `TestMigrationPrefixesSortTheSameAsStringsAndNumbers`.

- One `CREATE ... CONCURRENTLY` statement per file, so each index consumes
  one number (CLAUDE.md migration rules).
- The register records the owner task, not the migration author: G1-07
  designs the favorites/comments schema, but the numbers were reserved here
  by G1-01 (plan §4 G1-01 note).
- Reserved ranges are a promise, not an obligation: if G1-07 ends up needing
  fewer files, the unused numbers flip back to `free` in the same edit that
  lands the real migrations.
