import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";

// Log lines identify people by id, never by email or display name (spec F-11
// §6.2). A slog call whose attribute key is one of those words is flagged;
// a genuine exception carries `// log-pii-ok: <reason>` on the same line.
test("no slog line carries an email or display name attribute", () => {
  const hits = execSync(
    `grep -rnE '(slog|log|logger|s\\.log|h\\.Log|h\\.log)\\.(Info|Warn|Error|Debug)(Context)?\\(.*"(email|user_email|display_name|full_name|to)",' ` +
      `server --include='*.go' --exclude='*_test.go' | grep -v 'log-pii-ok:' || true`,
    { encoding: "utf8" },
  ).trim();
  assert.equal(hits, "", `log lines with PII keys:\n${hits}`);
});
