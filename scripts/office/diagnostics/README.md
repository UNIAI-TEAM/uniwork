# XLSX failing-test diagnostics

This test-only probe is for the Linux cloud runner. It refuses execution on the
Windows host and requires an explicit expected full Git revision. Applications
do not import it. The case inventory preserves the 28 failed assertions from
UNI-824 cloud round 5: 22 web cases and 6 server cases.

`xlsx-failure-probe.helper.txt` is inert template data read by the probe and
copied byte-for-byte to VM scratch `.go-tmp/xlsx-failure-probe/diagnostic.ts`.
Its TypeScript contents are not a statically imported application module. The
transform inventory's historical before/after hashes and selected assertions
stay frozen; it refuses source that has changed since that diagnostic round.

Commands run from the repository root:

```sh
node scripts/office/diagnostics/xlsx-failure-probe.mjs inventory "$REVISION"
node scripts/office/diagnostics/xlsx-failure-probe.mjs apply "$REVISION"
node scripts/office/diagnostics/xlsx-failure-probe.mjs run-web "$REVISION"
node scripts/office/diagnostics/xlsx-failure-probe.mjs run-server "$REVISION"
node scripts/office/diagnostics/xlsx-failure-probe.mjs restore "$REVISION"
```

Prepare the real generated XLSX renderer before applying the probe when its
artifact is absent. Artifact generation is a suite-loading prerequisite; it
does not replace a selected assertion or count as a test pass.

The probe backs up six exact source files only on the VM, validates unique
markers and before/after hashes, then adds logging around existing assertions,
WebCrypto calls, coordinator error dispatch and supervisor stderr. Wrappers
rethrow the original error. Inputs, worker entry, execution arguments,
environment isolation, sandbox options and assertions retain their behavior.
Diagnostics print constructor/realm flags and public error fields without
payload bytes or key material. Child stderr is preserved completely.

Always execute the explicit restore command even when a test command fails.
Restoration checks every backup and refuses to overwrite independent source
changes. Preserve the emitted temporary patch, digests, selected names and full
error logs in the cloud report. Instrumented tests are diagnostic evidence;
they do not establish acceptance of unmodified source.

Existing backups refuse overwrite. An interrupted diagnostic run needs its
owner to restore and settle it before a further round. Do not delete another
round's scratch directory or use this probe for a whole-suite rerun.
