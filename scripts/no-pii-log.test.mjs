import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

function walkGo(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "vendor" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkGo(p, out);
    else if (e.name.endsWith(".go") && !e.name.endsWith("_test.go")) out.push(p);
  }
  return out;
}

const piiCall =
  /(slog|log|logger|s\.log|h\.Log|h\.log)\.(Info|Warn|Error|Debug)(Context)?\(.*"(email|user_email|display_name|full_name|to)",/;

// Log lines identify people by id, never by email or display name (spec F-11
// §6.2). A slog call whose attribute key is one of those words is flagged;
// a genuine exception carries `// log-pii-ok: <reason>` on the same line.
test("no slog line carries an email or display name attribute", () => {
  const hits = [];
  for (const file of walkGo(path.join(root, "server"))) {
    const rel = path.relative(root, file).replaceAll("\\", "/");
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      if (line.includes("log-pii-ok:")) return;
      if (piiCall.test(line)) hits.push(`${rel}:${i + 1}:${line}`);
    });
  }
  assert.equal(hits.join("\n"), "", `log lines with PII keys:\n${hits.join("\n")}`);
});
