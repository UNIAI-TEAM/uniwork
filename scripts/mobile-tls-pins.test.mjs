import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { PINS_FILE, certManagerProblems, checkPins, chainVerdict, expiryStatus, fetchChain, minimumSupportedVersion, parseHostEntry, pinnedHosts, readCertManagerManifests, shippedPinSets, spkiPin } from "./mobile-tls-pins.mjs";

// The TLS pins every UniChat staging and production binary carries (apps/chat-mobile/tls-pins.json, runbook
// docs/runbooks/unichat-tls-pins.md): the committed file is held to its certificates and to the servers the deploy
// names here; scripts/mobile-tls-pins.mjs holds it to the live chains (chat-mobile-tls-pins.yml).
const root = path.resolve(import.meta.dirname, "..");
const app = path.join(root, "apps/chat-mobile");
const committed = JSON.parse(fs.readFileSync(path.join(root, PINS_FILE), "utf8"));
const DAY = 24 * 60 * 60 * 1000;

test("every committed pin is the SPKI SHA-256 of the self-signed CA certificate committed beside it", () => {
  for (const pin of committed.pins) {
    const cert = new X509Certificate(fs.readFileSync(path.join(app, pin.certificate)));
    assert.equal(spkiPin(cert.raw), pin.sha256, `${pin.ca}: the pin is not the key of ${pin.certificate}`);
    assert.equal(spkiPin(fs.readFileSync(path.join(app, pin.certificate), "utf8")), pin.sha256, "a PEM reads the same as its DER");
    assert.ok(cert.ca, `${pin.certificate} is a CA certificate`);
    assert.equal(cert.subject, cert.issuer, `${pin.certificate} is a root (self-signed): it outlives every intermediate a CA rotates`);
    assert.match(cert.subject, new RegExp(`^CN=${pin.ca}$`, "m"), `${pin.certificate} is ${pin.ca}`);
    assert.ok(Date.parse(cert.validTo) > Date.parse(committed.expires), `${pin.ca} expires before the pin-set does`);
  }
  const files = fs.readdirSync(path.join(app, "certs/tls-pins"));
  assert.deepEqual(files.sort(), committed.pins.map((pin) => path.basename(pin.certificate)).sort(), "one certificate per pin, none left over");
});

test("the pin-set has a backup: at least two keys from at least two CA operators, and a date Android stops enforcing it", () => {
  assert.ok(new Set(committed.pins.map((pin) => pin.sha256)).size >= 2);
  assert.ok(new Set(committed.pins.map((pin) => pin.operator)).size >= 2, "a second CA operator the server can move to without a new binary");
  assert.match(committed.expires, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Number.isInteger(committed.warnDays) && committed.warnDays >= 30, "warn at least a month ahead: a new store binary takes days to review");
});

test("production pins the API, the web app and the LiveKit signalling host (with its port) the deploy names", () => {
  const deployed = fs.readFileSync(path.join(root, "deploy/app/env/uniwork-be.env"), "utf8");
  const value = (name) => deployed.match(new RegExp(`^${name}=(\\S+)$`, "m"))?.[1] ?? "";
  const production = pinnedHosts({ hosts: { production: committed.hosts.production } }).map(({ host, port }) => `${host}:${port}`);
  for (const name of ["API_PUBLIC_URL", "FRONTEND_ORIGIN", "LIVEKIT_URL"]) {
    const url = new URL(value(name).replace(/^wss:/, "https:"));
    assert.ok(production.includes(`${url.hostname}:${url.port || 443}`), `${name} (${url.host}) is not in tls-pins.json › hosts.production`);
  }
  assert.ok(committed.hosts.staging.length > 0, "staging builds pin too");
});

test("reads a host entry with or without its port, and lists each host once with the variants that pin it", () => {
  assert.deepEqual(parseHostEntry("Example.com"), { host: "example.com", port: 443 });
  assert.deepEqual(parseHostEntry(" livekit.example:7880 "), { host: "livekit.example", port: 7880 });
  for (const bad of ["wss://x.example", "x.example:0", "x.example:70000", "*.example", "x.example/path", ""]) {
    assert.throws(() => parseHostEntry(bad), /not a hostname/, bad);
  }
  assert.deepEqual(pinnedHosts({ hosts: { staging: ["a.example", "b.example:7880"], production: ["A.example:443", "c.example"] } }), [
    { host: "a.example", port: 443, variants: ["staging", "production"] },
    { host: "b.example", port: 7880, variants: ["staging"] },
    { host: "c.example", port: 443, variants: ["production"] },
  ]);
});

test("warns warnDays before the pin-set's expiry and fails once it has passed", () => {
  const now = new Date("2027-08-01T00:00:00Z");
  assert.equal(expiryStatus("2027-12-31", now, 60).level, "ok");
  const soon = expiryStatus("2027-09-15", now, 60);
  assert.equal(soon.level, "warn");
  assert.equal(soon.days, 45);
  assert.match(soon.message, /45 days/);
  assert.match(soon.message, /store binary/);
  assert.equal(expiryStatus("2027-08-01", now, 60).level, "error");
  assert.equal(expiryStatus("2027-07-01", now, 60).level, "error");
  assert.equal(expiryStatus("not a date", now, 60).level, "error");
});

const PIN_ROOT = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";
const PIN_BACKUP = "YLh1dUR9y6Kja30RrAn7JKnbQG/uEtLMkBgFF2Fuihg=";
const PINS = [
  { sha256: PIN_ROOT, ca: "Root A", operator: "One" },
  { sha256: PIN_BACKUP, ca: "Root B", operator: "Two" },
];
const NOW = new Date("2026-10-23T00:00:00Z");
const leaf = (over = {}) => ({ depth: 0, subject: "CN=api.example", pin: "LEAF", validTo: new Date(NOW.getTime() + 60 * DAY).toISOString(), ...over });

test("a chain passes when a CA certificate in it carries a pinned key, never on the leaf's key alone", () => {
  const chain = [leaf(), { depth: 1, subject: "CN=Intermediate", pin: "INTER" }, { depth: 2, subject: "CN=Root A", pin: PIN_ROOT }];
  const ok = chainVerdict(chain, PINS, NOW);
  assert.equal(ok.level, "ok");
  assert.deepEqual(ok.matched.map((pin) => pin.ca), ["Root A"]);
  // iOS's NSPinnedCAIdentities ignores the leaf: a pin on it would pass on Android and lock iPhones out.
  const leafOnly = chainVerdict([leaf({ pin: PIN_ROOT }), { depth: 1, subject: "CN=Other", pin: "OTHER" }], PINS, NOW);
  assert.equal(leafOnly.level, "error");
  assert.match(leafOnly.message, /no pinned key/);
  assert.match(leafOnly.message, /CN=Other/, "names the CAs that are there");
  // A leaf about to run out means the renewal is stuck: a warning, the pins are fine.
  const stale = chainVerdict([leaf({ validTo: new Date(NOW.getTime() + 5 * DAY).toISOString() }), { depth: 1, subject: "CN=Root A", pin: PIN_ROOT }], PINS, NOW);
  assert.equal(stale.level, "warn");
  assert.match(stale.message, /expires in 5 days/);
});

test("checks every pinned host, retries a host it cannot reach, and fails on a missing pin, an unreachable host or an expired set", async () => {
  const file = { expires: "2027-10-31", warnDays: 60, pins: PINS, hosts: { staging: ["api.example"], production: ["api.example", "live.example:7880", "down.example"] } };
  const calls = [];
  const fetch = async (host, port) => {
    calls.push(`${host}:${port}`);
    if (host === "api.example") return [leaf(), { depth: 1, subject: "CN=Root A", pin: PIN_ROOT }];
    if (host === "live.example") return [leaf(), { depth: 1, subject: "CN=Elsewhere", pin: "ELSE" }];
    throw new Error("connect ECONNREFUSED");
  };
  const result = await checkPins({ file, now: NOW, fetch, attempts: 3, sleep: async () => {} });
  assert.deepEqual(calls, ["api.example:443", "live.example:7880", "down.example:443", "down.example:443", "down.example:443"]);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /live\.example:7880 \(production\): no pinned key/);
  assert.match(result.errors[1], /down\.example:443 \(production\): unreachable after 3 attempts: connect ECONNREFUSED/);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(
    result.rows.map((row) => [row.host, row.level]),
    [
      ["api.example:443", "ok"],
      ["live.example:7880", "error"],
      ["down.example:443", "error"],
    ],
  );

  const expiring = await checkPins({ file: { ...file, hosts: { production: ["api.example"] }, expires: "2026-11-30" }, now: NOW, fetch, sleep: async () => {} });
  assert.deepEqual(expiring.errors, []);
  assert.equal(expiring.warnings.length, 1);
  assert.match(expiring.warnings[0], /38 days/);
  const expired = await checkPins({ file: { ...file, hosts: { production: ["api.example"] }, expires: "2026-10-01" }, now: NOW, fetch, sleep: async () => {} });
  assert.match(expired.errors[0], /expired/);
});

// The real connection path against a local server: a throwaway CA, a leaf for localhost, the chain as Node sees it.
test("reads the chain a TLS server serves, with each certificate's SPKI pin, and refuses one the trust store does not verify", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tls-pins-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const openssl = (...args) => execFileSync("openssl", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  openssl("req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-keyout", "ca.key", "-out", "ca.pem", "-days", "2", "-subj", "/CN=Test Root", "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign");
  openssl("req", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-keyout", "leaf.key", "-out", "leaf.csr", "-subj", "/CN=localhost");
  fs.writeFileSync(path.join(dir, "ext.cnf"), "subjectAltName=DNS:localhost\n");
  openssl("x509", "-req", "-in", "leaf.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-out", "leaf.pem", "-days", "30", "-extfile", "ext.cnf");
  const read = (f) => fs.readFileSync(path.join(dir, f), "utf8");
  const server = tls.createServer({ key: read("leaf.key"), cert: read("leaf.pem") + read("ca.pem") }, (socket) => socket.end());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address();

  const chain = await fetchChain("localhost", port, { ca: read("ca.pem"), connectHost: "127.0.0.1" });
  assert.deepEqual(
    chain.map((cert) => [cert.depth, cert.subject, cert.pin]),
    [
      [0, "CN=localhost", spkiPin(new X509Certificate(read("leaf.pem")).raw)],
      [1, "CN=Test Root", spkiPin(read("ca.pem"))],
    ],
  );
  assert.equal(chainVerdict(chain, [{ sha256: spkiPin(read("ca.pem")), ca: "Test Root" }], new Date()).level, "ok");
  assert.equal(chainVerdict(chain, [{ sha256: spkiPin(read("leaf.pem")), ca: "leaf" }], new Date()).level, "error");
  await assert.rejects(fetchChain("localhost", port, { connectHost: "127.0.0.1" }), /self.signed|unable to (get|verify)/i);
});

// A binary keeps its pins (iOS for good, Android until its own `expires`), so HEAD's pin-set is not the only one
// that has to match: every store binary still served carries the pin-set of its chat-mobile-v* tag.
test("lists the pin-sets binaries already carry: each chat-mobile-v* tag at or above the minimum that has tls-pins.json, oldest first", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tls-pins-git-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const commit = (message, pins) => {
    if (pins) {
      fs.mkdirSync(path.join(dir, path.dirname(PINS_FILE)), { recursive: true });
      fs.writeFileSync(path.join(dir, PINS_FILE), JSON.stringify({ expires: "2027-10-31", pins, hosts: { production: ["api.example"] } }));
    }
    fs.writeFileSync(path.join(dir, "log"), message);
    git(["add", "-A"]);
    git(["commit", "-q", "-m", message]);
  };
  git(["init", "-q"]);
  commit("before pinning");
  git(["tag", "chat-mobile-v0.1.0"]);
  commit("pins A", [{ sha256: "A" }]);
  git(["tag", "chat-mobile-v0.2.0"]);
  git(["tag", "chat-mobile-v0.10.0"]);
  commit("pins A B", [{ sha256: "A" }, { sha256: "B" }]);
  git(["tag", "chat-mobile-v0.9.1"]);
  git(["tag", "chat-mobile-vnext"]);
  git(["tag", "chat-desktop-v9.9.9"]);

  const all = shippedPinSets({ git, minimum: "" });
  assert.deepEqual(
    all.map((set) => [set.tag, set.file.pins.map((pin) => pin.sha256).join("")]),
    [
      ["chat-mobile-v0.2.0", "A"],
      ["chat-mobile-v0.9.1", "AB"],
      ["chat-mobile-v0.10.0", "A"],
    ],
    "versions compare as numbers; a tag from before pinning ships no pins and a tag that is no version ships no binary",
  );
  assert.deepEqual(
    shippedPinSets({ git, minimum: "0.9.1" }).map((set) => set.tag),
    ["chat-mobile-v0.9.1", "chat-mobile-v0.10.0"],
    "a binary below UNICHAT_MOBILE_MIN_SUPPORTED_VERSION is already told to update",
  );
});

test("reads the minimum supported version from the server's public config, and checks every tag when it cannot", async () => {
  const answer = (body, ok = true) => async (url) => {
    assert.equal(url, "https://api.example/api/v1/config");
    return { ok, status: ok ? 200 : 503, json: async () => body };
  };
  assert.deepEqual(await minimumSupportedVersion({ api: "https://api.example", fetch: answer({ min_supported_mobile_version: " 0.4.2 " }) }), { minimum: "0.4.2" });
  assert.deepEqual(await minimumSupportedVersion({ api: "https://api.example/", fetch: answer({ min_supported_mobile_version: "" }) }), { minimum: "" });
  for (const fetch of [answer({}, false), answer({ min_supported_mobile_version: 3 }), answer({ min_supported_mobile_version: "0.4" }), async () => Promise.reject(new Error("ECONNRESET"))]) {
    const result = await minimumSupportedVersion({ api: "https://api.example", fetch });
    assert.equal(result.minimum, "", "an unknown minimum checks every shipped pin-set: too strict, never too lax");
    assert.match(result.warning, /minimum supported version/);
  }
});

test("a chain no shipped binary's pins match is red even when HEAD's pins match it, naming the oldest binary locked out", async () => {
  const PIN_NEW = "NEWCAPIN";
  const head = { expires: "2027-10-31", warnDays: 60, pins: [...PINS, { sha256: PIN_NEW, ca: "New Root", operator: "Three" }], hosts: { production: ["api.example", "live.example:7880"] } };
  const shippedSet = (tag, version, expires, pins, hosts = { production: ["api.example", "live.example:7880"] }) => ({ tag, version, file: { expires, pins, hosts } });
  const shipped = [
    shippedSet("chat-mobile-v0.3.0", [0, 3, 0], "2026-09-30", PINS, { production: ["api.example", "old.example"] }),
    shippedSet("chat-mobile-v0.4.0", [0, 4, 0], "2027-06-30", PINS),
    shippedSet("chat-mobile-v0.5.0", [0, 5, 0], "2027-10-31", head.pins),
  ];
  const calls = [];
  const fetch = async (host, port) => {
    calls.push(`${host}:${port}`);
    if (host === "api.example") return [leaf(), { depth: 1, subject: "CN=New Root", pin: PIN_NEW }];
    if (host === "live.example") return [leaf(), { depth: 1, subject: "CN=Root A", pin: PIN_ROOT }];
    throw new Error("getaddrinfo ENOTFOUND");
  };
  const result = await checkPins({ file: head, shipped, now: NOW, fetch, attempts: 1, sleep: async () => {} });
  assert.deepEqual(calls, ["api.example:443", "live.example:7880", "old.example:443"], "each host is dialled once, whatever number of pin-sets name it");
  assert.equal(result.errors.length, 1, result.errors.join("\n"));
  assert.match(result.errors[0], /^api\.example:443: /);
  assert.match(result.errors[0], /oldest locked out: chat-mobile-v0\.3\.0 \(iPhones\)/, "past its expiry Android no longer enforces v0.3.0's pins; iOS still does");
  assert.match(result.errors[0], /chat-mobile-v0\.4\.0 \(iPhones; Android until 2027-06-30\)/);
  assert.doesNotMatch(result.errors[0], /v0\.5\.0/, "v0.5.0 pins the new root");
  assert.match(result.errors[0], /UNICHAT_MOBILE_MIN_SUPPORTED_VERSION/);
  assert.deepEqual(result.warnings, ["old.example:443 (pinned by chat-mobile-v0.3.0): unreachable after 1 attempts: getaddrinfo ENOTFOUND"], "a host only old binaries name is not HEAD's to keep up");
  assert.deepEqual(
    result.rows.map((row) => [row.host, row.level]),
    [
      ["api.example:443", "error"],
      ["live.example:7880", "ok"],
    ],
  );
  assert.deepEqual(result.shipped, ["chat-mobile-v0.3.0", "chat-mobile-v0.4.0", "chat-mobile-v0.5.0"]);

  const fine = await checkPins({ file: head, shipped: shipped.slice(2), now: NOW, fetch, attempts: 1, sleep: async () => {} });
  assert.deepEqual(fine.errors, []);
});

// The one infrastructure change the repo sees before it happens: the issuer of a pinned host's certificate. A PR
// that points it at a CA no binary pins is red here, before it is applied (runbook › Trước khi đổi).
test("every certificate the deploy issues for a pinned host comes from the ACME directory of a pinned CA operator", () => {
  const docs = readCertManagerManifests(path.join(root, "deploy"));
  assert.ok(docs.some((doc) => doc.kind === "Certificate"), "the deploy's certificates are read");
  assert.deepEqual(certManagerProblems({ docs, file: committed }), []);
});

test("refuses an unpinned ACME directory, a CA or self-signed issuer, and an issuer the repo does not define", () => {
  const issuer = (name, spec, kind = "ClusterIssuer") => ({ source: "deploy/x.yaml", kind, metadata: { name }, spec });
  const certificate = (dnsNames, issuerRef) => ({ source: "deploy/c.yaml", kind: "Certificate", metadata: { name: "c", namespace: "edge" }, spec: { dnsNames, issuerRef } });
  const file = { pins: PINS.map((pin, i) => ({ ...pin, operator: i === 0 ? "ISRG (Let's Encrypt)" : "Google Trust Services" })), hosts: { production: ["api.example", "live.example:7880"] } };
  const le = issuer("le", { acme: { server: "https://acme-v02.api.letsencrypt.org/directory" } });
  const gts = issuer("gts", { acme: { server: "https://dv.acme-v02.api.pki.goog/directory" } }, "Issuer");
  gts.metadata.namespace = "edge";
  assert.deepEqual(certManagerProblems({ docs: [le, gts, certificate(["api.example"], { name: "le", kind: "ClusterIssuer" }), certificate(["api.example"], { name: "gts" })], file }), []);
  assert.deepEqual(certManagerProblems({ docs: [issuer("self", { selfSigned: {} }), certificate(["other.example"], { name: "self", kind: "ClusterIssuer" })], file }), [], "a host no binary pins may use any issuer");

  const cases = [
    [issuer("zerossl", { acme: { server: "https://acme.zerossl.com/v2/DV90" } }), /acme\.zerossl\.com.*not the ACME directory of a pinned CA operator/],
    [issuer("le-staging", { acme: { server: "https://acme-staging-v02.api.letsencrypt.org/directory" } }), /not the ACME directory of a pinned CA operator/],
    [issuer("own", { ca: { secretName: "root" } }), /not an ACME issuer/],
    [issuer("self", { selfSigned: {} }), /not an ACME issuer/],
  ];
  for (const [bad, message] of cases) {
    const problems = certManagerProblems({ docs: [bad, certificate(["api.example", "x.example"], { name: bad.metadata.name, kind: "ClusterIssuer" })], file });
    assert.equal(problems.length, 1, problems.join("\n"));
    assert.match(problems[0], message);
    assert.match(problems[0], /api\.example/);
    assert.match(problems[0], /Trước khi đổi/);
  }
  const missing = certManagerProblems({ docs: [certificate(["live.example"], { name: "elsewhere", kind: "ClusterIssuer" })], file });
  assert.match(missing[0], /ClusterIssuer elsewhere.*not defined/);
  const wrongNamespace = certManagerProblems({ docs: [{ ...gts, metadata: { name: "gts", namespace: "other" } }, certificate(["api.example"], { name: "gts" })], file });
  assert.match(wrongNamespace[0], /Issuer edge\/gts.*not defined/, "an Issuer is namespaced: kind defaults to Issuer");
  const wildcard = certManagerProblems({ docs: [issuer("own", { ca: {} }), certificate(["*.example"], { name: "own", kind: "ClusterIssuer" })], file });
  assert.equal(wildcard.length, 1, "a wildcard name covers the pinned host");
  // An operator not among the pins: the GTS directory stops counting the day its roots leave tls-pins.json.
  const isrgOnly = { ...file, pins: file.pins.filter((pin) => pin.operator.startsWith("ISRG")) };
  assert.match(certManagerProblems({ docs: [gts, certificate(["api.example"], { name: "gts" })], file: isrgOnly })[0], /not the ACME directory of a pinned CA operator/);
  // An Ingress annotation makes cert-manager issue a certificate for its TLS hosts.
  const ingress = { source: "deploy/i.yaml", kind: "Ingress", metadata: { name: "i", namespace: "edge", annotations: { "cert-manager.io/cluster-issuer": "own" } }, spec: { tls: [{ hosts: ["api.example"] }] } };
  assert.match(certManagerProblems({ docs: [issuer("own", { ca: {} }), ingress], file })[0], /Ingress edge\/i/);
});

test("reads the cert-manager manifests of a deploy tree, block and flow style, comments and several documents", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tls-pins-deploy-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "edge"));
  fs.writeFileSync(
    path.join(dir, "edge", "certs.yaml"),
    [
      "# the issuer",
      "apiVersion: cert-manager.io/v1",
      "kind: ClusterIssuer",
      "metadata:",
      "  name: le # inline comment",
      "spec:",
      "  acme:",
      '    server: "https://acme-v02.api.letsencrypt.org/directory"',
      "    solvers:",
      "      - http01:",
      "          ingress:",
      "            class: apisix",
      "---",
      "apiVersion: cert-manager.io/v1",
      "kind: Certificate",
      "metadata:",
      "  name: c",
      "  namespace: edge",
      "spec:",
      "  dnsNames: [api.example, 'b.example']",
      "  issuerRef: { name: le, kind: ClusterIssuer }",
      "---",
      "kind: Service",
      "metadata: { name: unrelated }",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(path.join(dir, "edge", "other.yml"), "kind: ConfigMap\ndata:\n  x: y\n");
  const docs = readCertManagerManifests(dir);
  assert.deepEqual(
    docs.map((doc) => [doc.kind, doc.metadata.name, doc.source.endsWith("certs.yaml")]),
    [
      ["ClusterIssuer", "le", true],
      ["Certificate", "c", true],
    ],
  );
  assert.equal(docs[0].spec.acme.server, "https://acme-v02.api.letsencrypt.org/directory");
  assert.deepEqual(docs[1].spec.dnsNames, ["api.example", "b.example"]);
  assert.deepEqual(docs[1].spec.issuerRef, { name: "le", kind: "ClusterIssuer" });
});
