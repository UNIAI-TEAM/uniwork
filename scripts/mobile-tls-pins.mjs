#!/usr/bin/env node
// Are UniChat's TLS pins still good against the servers they pin? (apps/chat-mobile/tls-pins.json, runbook
// docs/runbooks/unichat-tls-pins.md)
//
// Every staging and production binary pins CA keys for its API, web and LiveKit hosts (plugins/with-tls-pins.js).
// A binary cannot change its pins: an OTA does not reach native config, so if a server comes to serve a chain with
// none of the pinned keys, every phone with that binary loses the server (Android until the pin-set's expiry, iOS
// until a new binary is installed). This connects to every pinned host, takes the chain as a TLS client verifies it
// (served certificates plus the trust anchor), and fails when no CA certificate in it carries a pinned key — the
// leaf's own key never counts, since iOS's NSPinnedCAIdentities ignores it. It fails too when a host cannot be
// reached after a few attempts, and once the pin-set has expired; it warns `warnDays` before that, and when a
// leaf is days from expiry (its renewal is stuck).
//
//
// HEAD's pin-set is not the only one that must match: every store binary still served keeps the pin-set it was built
// with, so a chain that only HEAD's pins match (a new CA added and the server moved before phones updated) locks
// those phones out. Each `chat-mobile-v*` tag at or above the server's minimum supported version
// (UNICHAT_MOBILE_MIN_SUPPORTED_VERSION, read from the public GET /api/v1/config of the API the deploy names) is a
// binary in the field; its tls-pins.json, read from git, is checked against the same chains. Every one counts, past
// its own `expires` too: iOS never stops enforcing. The red message names the oldest binary locked out. A shallow
// checkout cannot see the tags, so the script refuses one.
//
//   node scripts/mobile-tls-pins.mjs [--file apps/chat-mobile/tls-pins.json] [--warn-days 60] [--now 2027-01-01]
//                                    [--min-version 0.4.0]
//
// Runs daily and on every PR that touches the pins (.github/workflows/chat-mobile-tls-pins.yml). Prints GitHub
// annotations and, under Actions, a table in the step summary; exits 1 on any error. The CA issuing each pinned host's
// certificate in deploy/ is held to the pinned operators' ACME directories by certManagerProblems, which the
// contract test (scripts/mobile-tls-pins.test.mjs) runs on every PR touching deploy/edge.
import { execFileSync } from "node:child_process";
import { X509Certificate, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import tls from "node:tls";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
export const PINS_FILE = "apps/chat-mobile/tls-pins.json";
const DAY = 24 * 60 * 60 * 1000;
/** A leaf this close to expiry means the ACME renewal is stuck (cert-manager renews 30 days ahead). */
const LEAF_WARN_DAYS = 14;
/** Each store binary is built from a tag `chat-mobile-v<version>` (chat-mobile-release.yml). */
export const TAG_PREFIX = "chat-mobile-v";
const DEPLOY_ENV = "deploy/app/env/uniwork-be.env";
const RUNBOOK_BEFORE = "runbook docs/runbooks/unichat-tls-pins.md › Khắc phục › Trước khi đổi";
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** The base64 SHA-256 of a certificate's SubjectPublicKeyInfo, from its DER bytes or its PEM text. */
export function spkiPin(certificate) {
  const spki = new X509Certificate(certificate).publicKey.export({ type: "spki", format: "der" });
  return createHash("sha256").update(spki).digest("base64");
}

/** `host` or `host:port` (the port defaults to 443). */
export function parseHostEntry(entry) {
  const match = /^([^:/]+)(?::(\d{1,5}))?$/.exec(String(entry).trim().toLowerCase());
  const port = Number(match?.[2] ?? 443);
  if (!match || !HOSTNAME.test(match[1]) || port < 1 || port > 65535) throw new Error(`not a hostname (and port): ${entry}`);
  return { host: match[1], port };
}

/** Every host:port the file pins, once, with the variants that pin it. */
export function pinnedHosts(file) {
  const byKey = new Map();
  for (const [variant, entries] of Object.entries(file.hosts ?? {})) {
    for (const entry of entries) {
      const { host, port } = parseHostEntry(entry);
      const key = `${host}:${port}`;
      if (!byKey.has(key)) byKey.set(key, { host, port, variants: [] });
      const row = byKey.get(key);
      if (!row.variants.includes(variant)) row.variants.push(variant);
    }
  }
  return [...byKey.values()];
}

/** The pin-set's expiry against `now`: ok, a warning within `warnDays`, an error once passed or unreadable. */
export function expiryStatus(expires, now, warnDays) {
  const at = /^\d{4}-\d{2}-\d{2}$/.test(String(expires)) ? Date.parse(`${expires}T00:00:00Z`) : Number.NaN;
  if (Number.isNaN(at)) return { level: "error", days: Number.NaN, message: `the pin-set's expiry is not a date: ${expires}` };
  const days = Math.floor((at - now.getTime()) / DAY);
  if (days <= 0) {
    return { level: "error", days, message: `the pin-set expired on ${expires}: Android binaries no longer enforce it and the EAS builder refuses a new one; renew it (runbook › Khắc phục)` };
  }
  if (days <= warnDays) {
    return { level: "warn", days, message: `the pin-set expires in ${days} days (${expires}): ship a store binary with a later date before then (runbook › Khắc phục)` };
  }
  return { level: "ok", days, message: `the pin-set expires in ${days} days (${expires})` };
}

/** One host's chain ([{ depth, subject, pin, validTo? }], leaf first) against the pins. */
export function chainVerdict(chain, pins, now) {
  const cas = chain.filter((cert) => cert.depth > 0);
  const matched = pins.filter((pin) => cas.some((cert) => cert.pin === pin.sha256));
  if (matched.length === 0) {
    return { level: "error", matched, message: `no pinned key in the chain (${cas.map((cert) => cert.subject).join(" ← ") || "no CA certificate"}): phones with these pins cannot connect` };
  }
  const leaf = chain.find((cert) => cert.depth === 0);
  const leafDays = leaf?.validTo ? Math.floor((Date.parse(leaf.validTo) - now.getTime()) / DAY) : Number.POSITIVE_INFINITY;
  if (leafDays <= LEAF_WARN_DAYS) {
    return { level: "warn", matched, message: `pinned by ${matched.map((pin) => pin.ca).join(", ")}, but the leaf certificate expires in ${leafDays} days: is its renewal stuck?` };
  }
  return { level: "ok", matched, message: `pinned by ${matched.map((pin) => pin.ca).join(", ")}` };
}

const oneLine = (subject) => String(subject ?? "").split("\n").filter(Boolean).join(", ");

/**
 * The chain a TLS client verifies for host:port: the certificates the server sent plus the trust anchor Node
 * completed it with, leaf first. Rejects a chain the trust store does not verify (phones would refuse it too).
 * `ca` replaces the trust store and `connectHost` the address dialled (tests only).
 */
export function fetchChain(host, port, { timeoutMs = 10_000, ca, connectHost } = {}) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: connectHost ?? host, port, servername: host, rejectUnauthorized: true, ...(ca ? { ca } : {}) });
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error(`timed out after ${timeoutMs} ms`)));
    socket.once("error", reject);
    socket.once("secureConnect", () => {
      const chain = [];
      const seen = new Set();
      for (let cert = socket.getPeerCertificate(true); cert?.raw && !seen.has(cert.fingerprint256); cert = cert.issuerCertificate) {
        seen.add(cert.fingerprint256);
        chain.push({ depth: chain.length, subject: oneLine(new X509Certificate(cert.raw).subject), pin: spkiPin(cert.raw), validTo: new Date(cert.valid_to).toISOString() });
      }
      socket.end();
      resolve(chain);
    });
  });
}

/** MAJOR.MINOR.PATCH (a tag may add a suffix) as numbers; null when the text is no version. */
function parseVersion(text, { suffix = false } = {}) {
  const match = (suffix ? /^(\d+)\.(\d+)\.(\d+)(?:[-+.][0-9A-Za-z.-]*)?$/ : /^(\d+)\.(\d+)\.(\d+)$/).exec(String(text ?? "").trim());
  return match ? match.slice(1, 4).map(Number) : null;
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * The pin-sets of the binaries in the field, oldest first: [{ tag, version, file }] for each `chat-mobile-v*` tag at
 * or above `minimum` ("" for none) whose tree has tls-pins.json. A tag from before pinning built an unpinned binary,
 * and a tag that names no version built none (the release refuses it). `git(args)` returns git's stdout.
 */
export function shippedPinSets({ git, minimum = "" }) {
  const floor = parseVersion(minimum);
  const sets = [];
  for (const tag of git(["tag", "--list", `${TAG_PREFIX}*`]).split("\n").map((line) => line.trim()).filter(Boolean)) {
    const version = parseVersion(tag.slice(TAG_PREFIX.length), { suffix: true });
    if (!version || (floor && compareVersions(version, floor) < 0)) continue;
    if (git(["ls-tree", "--name-only", tag, "--", PINS_FILE]).trim() === "") continue;
    let file;
    try {
      file = JSON.parse(git(["show", `${tag}:${PINS_FILE}`]));
    } catch (error) {
      throw new Error(`${tag}: ${PINS_FILE} does not parse: ${error.message}`);
    }
    sets.push({ tag, version, file });
  }
  return sets.sort((a, b) => compareVersions(a.version, b.version) || a.tag.localeCompare(b.tag));
}

/**
 * UNICHAT_MOBILE_MIN_SUPPORTED_VERSION as the server serves it (`min_supported_mobile_version` of the public
 * GET /api/v1/config): { minimum } — "" when none is set — or, when it cannot be read, { minimum: "", warning }: an
 * unknown minimum checks every shipped pin-set, too strict rather than too lax.
 */
export async function minimumSupportedVersion({ api, fetch = globalThis.fetch, timeoutMs = 10_000 }) {
  const url = `${String(api).replace(/\/+$/, "")}/api/v1/config`;
  let reason;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (response.ok) {
      const value = (await response.json())?.min_supported_mobile_version;
      if (typeof value === "string" && (value.trim() === "" || parseVersion(value))) return { minimum: value.trim() };
      reason = `min_supported_mobile_version is ${JSON.stringify(value)}`;
    } else {
      reason = `HTTP ${response.status}`;
    }
  } catch (error) {
    reason = error?.message ?? String(error);
  }
  return { minimum: "", warning: `could not read the minimum supported version from ${url} (${reason}): checking the pin-set of every ${TAG_PREFIX}* tag` };
}

/** Which phones with this binary enforce its pins on `now`: iPhones always, Android until the pin-set's expiry. */
function enforcedOn(set, now) {
  const expires = String(set.file.expires ?? "");
  const android = /^\d{4}-\d{2}-\d{2}$/.test(expires) && Date.parse(`${expires}T00:00:00Z`) > now.getTime();
  return android ? `iPhones; Android until ${expires}` : "iPhones";
}

/**
 * Every pinned host against HEAD's pin-set and against each pin-set in the field (`shipped`, oldest first, from
 * shippedPinSets), and HEAD's expiry: { errors, warnings, rows, expiry, shipped }. Each host is dialled once.
 */
export async function checkPins({ file, shipped = [], now = new Date(), warnDays = file.warnDays ?? 60, fetch = fetchChain, attempts = 3, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  const errors = [];
  const warnings = [];
  const rows = [];
  const expiry = expiryStatus(file.expires, now, warnDays);
  if (expiry.level === "error") errors.push(expiry.message);
  if (expiry.level === "warn") warnings.push(expiry.message);
  const chains = new Map();
  const chainOf = async (host, port) => {
    const name = `${host}:${port}`;
    if (!chains.has(name)) {
      let chain;
      let failure;
      for (let attempt = 1; attempt <= attempts && !chain; attempt++) {
        try {
          chain = await fetch(host, port);
        } catch (error) {
          failure = error;
          if (attempt < attempts) await sleep(2000 * attempt);
        }
      }
      chains.set(name, chain ? { chain } : { failure: `unreachable after ${attempts} attempts: ${failure?.message ?? failure}` });
    }
    return chains.get(name);
  };
  const headHosts = pinnedHosts(file);
  for (const { host, port, variants } of headHosts) {
    const name = `${host}:${port}`;
    const label = `${name} (${variants.join(", ")})`;
    const { chain, failure } = await chainOf(host, port);
    if (!chain) {
      errors.push(`${label}: ${failure}`);
      rows.push({ host: name, variants, level: "error", message: failure, chain: [] });
      continue;
    }
    const verdict = chainVerdict(chain, file.pins ?? [], now);
    if (verdict.level === "error") errors.push(`${label}: ${verdict.message}`);
    if (verdict.level === "warn") warnings.push(`${label}: ${verdict.message}`);
    rows.push({ host: name, variants, level: verdict.level, message: verdict.message, chain });
  }

  // The binaries already on phones: each keeps the pins it was built with.
  const lockedOut = new Map();
  const unreachable = new Map();
  for (const set of shipped) {
    for (const { host, port } of pinnedHosts(set.file)) {
      const name = `${host}:${port}`;
      const { chain } = await chainOf(host, port);
      if (!chain) {
        if (!headHosts.some((row) => `${row.host}:${row.port}` === name)) unreachable.set(name, [...(unreachable.get(name) ?? []), set.tag]);
        continue;
      }
      if (chainVerdict(chain, set.file.pins ?? [], now).level === "error") lockedOut.set(name, [...(lockedOut.get(name) ?? []), set]);
    }
  }
  for (const [name, tags] of unreachable) warnings.push(`${name} (pinned by ${tags.join(", ")}): ${chains.get(name).failure}`);
  for (const [name, sets] of lockedOut) {
    const { chain } = chains.get(name);
    const cas = chain.filter((cert) => cert.depth > 0).map((cert) => cert.subject).join(" ← ") || "no CA certificate";
    const [oldest, ...rest] = sets.map((set) => `${set.tag} (${enforcedOn(set, now)})`);
    const message = `binaries already on phones pin no key in its chain (${cas}): oldest locked out: ${oldest}${rest.length ? `, then ${rest.join(", ")}` : ""}. Go back to a pinned CA now, or raise UNICHAT_MOBILE_MIN_SUPPORTED_VERSION above them and wait for phones to update before moving (runbook docs/runbooks/unichat-tls-pins.md › Khắc phục)`;
    errors.push(`${name}: ${message}`);
    const row = rows.find((candidate) => candidate.host === name);
    if (row) Object.assign(row, { level: "error", message: row.level === "error" ? `${row.message}; ${message}` : message });
    else rows.push({ host: name, variants: [], level: "error", message, chain });
  }
  return { errors, warnings, rows, expiry, shipped: shipped.map((set) => set.tag) };
}

/** The ACME directories whose certificates chain to a pinned root, by the operator named in tls-pins.json › pins. */
const ACME_DIRECTORIES = {
  "https://acme-v02.api.letsencrypt.org/directory": "ISRG (Let's Encrypt)",
  "https://dv.acme-v02.api.pki.goog/directory": "Google Trust Services",
};

// A YAML reader for the subset deploy manifests use (block maps and lists, flow lists and maps of scalars, comments,
// several documents): enough to read cert-manager's kinds with Node alone, as the workflow installs nothing.
function stripComment(line) {
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function splitFlow(body) {
  const parts = [];
  let depth = 0;
  let quote = "";
  let current = "";
  for (const char of body) {
    if (quote) quote = char === quote ? "" : quote;
    else if (char === '"' || char === "'") quote = char;
    else if (char === "[" || char === "{") depth++;
    else if (char === "]" || char === "}") depth--;
    if (char === "," && depth === 0 && !quote) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current);
  return parts.map((part) => part.trim());
}

const MAP_ENTRY = /^("[^"]*"|'[^']*'|[^\s"'{[][^:]*?):(?:\s+(.*))?$/;

function scalar(text) {
  const value = text.trim();
  if (/^".*"$|^'.*'$/.test(value)) return value.slice(1, -1);
  if (value.startsWith("[") && value.endsWith("]")) return splitFlow(value.slice(1, -1)).map(scalar);
  if (value.startsWith("{") && value.endsWith("}")) {
    return Object.fromEntries(
      splitFlow(value.slice(1, -1)).map((entry) => {
        const match = MAP_ENTRY.exec(entry);
        if (!match) throw new Error(`not a flow mapping entry: ${entry}`);
        return [scalar(match[1]), match[2] === undefined ? null : scalar(match[2])];
      }),
    );
  }
  return value;
}

const isItem = (text) => text === "-" || text.startsWith("- ");

function parseNode(lines, i, indent) {
  return isItem(lines[i].text) ? parseList(lines, i, indent) : parseMap(lines, i, indent);
}

function parseList(lines, i, indent) {
  const list = [];
  while (i < lines.length && lines[i].indent === indent && isItem(lines[i].text)) {
    const rest = lines[i].text.slice(1).trimStart();
    if (rest === "") {
      i++;
      if (i < lines.length && lines[i].indent > indent) {
        let value;
        [value, i] = parseNode(lines, i, lines[i].indent);
        list.push(value);
      } else list.push(null);
    } else if (MAP_ENTRY.test(rest) && !/^[[{"']/.test(rest)) {
      const childIndent = indent + (lines[i].text.length - rest.length);
      lines[i] = { indent: childIndent, text: rest };
      let value;
      [value, i] = parseMap(lines, i, childIndent);
      list.push(value);
    } else {
      list.push(scalar(rest));
      i++;
    }
  }
  return [list, i];
}

function parseMap(lines, i, indent) {
  const map = {};
  while (i < lines.length && lines[i].indent === indent && !isItem(lines[i].text)) {
    const match = MAP_ENTRY.exec(lines[i].text);
    if (!match) throw new Error(`not a mapping entry: ${lines[i].text}`);
    const key = scalar(match[1]);
    i++;
    if (match[2] !== undefined && match[2] !== "") {
      map[key] = scalar(match[2]);
    } else if (i < lines.length && (lines[i].indent > indent || (lines[i].indent === indent && isItem(lines[i].text)))) {
      [map[key], i] = parseNode(lines, i, lines[i].indent);
    } else {
      map[key] = null;
    }
  }
  if (i < lines.length && lines[i].indent > indent) throw new Error(`unexpected indentation: ${lines[i].text}`);
  return [map, i];
}

function parseYamlDocument(text) {
  const lines = text
    .split("\n")
    .map((line) => stripComment(line).replace(/\s+$/, ""))
    .filter((line) => line.trim() !== "")
    .map((line) => ({ indent: line.length - line.trimStart().length, text: line.trim() }));
  if (lines.length === 0) return null;
  const [value, end] = parseNode(lines, 0, lines[0].indent);
  if (end !== lines.length) throw new Error(`unexpected line: ${lines[end].text}`);
  return value;
}

const CERT_MANAGER_KIND = /^kind:\s*(?:ClusterIssuer|Issuer|Certificate)\s*$|cert-manager\.io\/(?:cluster-)?issuer\b/m;

/** The cert-manager issuers and certificates (and Ingresses that ask cert-manager for one) in a deploy tree. */
export function readCertManagerManifests(dir) {
  const docs = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.ya?ml$/.test(entry.name)) {
        for (const text of fs.readFileSync(full, "utf8").split(/^---[ \t]*$/m)) {
          if (!CERT_MANAGER_KIND.test(text)) continue;
          let doc;
          try {
            doc = parseYamlDocument(text);
          } catch (error) {
            throw new Error(`${path.relative(ROOT, full)}: ${error.message}`);
          }
          if (doc && typeof doc === "object") docs.push({ ...doc, source: path.relative(ROOT, full) });
        }
      }
    }
  };
  walk(dir);
  return docs;
}

/** Does a certificate name (maybe a wildcard) cover this host? */
const covers = (dnsName, host) => {
  const name = String(dnsName).toLowerCase();
  if (!name.startsWith("*.")) return name === host;
  return host.endsWith(name.slice(1)) && !host.slice(0, -name.length + 1).includes(".");
};

/**
 * Every certificate the deploy has cert-manager issue for a host the pins cover must come from an ACME issuer the repo
 * defines whose directory belongs to an operator tls-pins.json pins: [] or one message per offending certificate.
 */
export function certManagerProblems({ docs, file }) {
  const hosts = [...new Set(pinnedHosts(file).map(({ host }) => host))];
  const operators = new Set((file.pins ?? []).map((pin) => pin.operator));
  const issuers = new Map();
  for (const doc of docs) {
    if (doc.kind === "ClusterIssuer") issuers.set(`ClusterIssuer ${doc.metadata?.name}`, doc);
    if (doc.kind === "Issuer") issuers.set(`Issuer ${doc.metadata?.namespace ?? "default"}/${doc.metadata?.name}`, doc);
  }
  const allowed = Object.entries(ACME_DIRECTORIES)
    .filter(([, operator]) => operators.has(operator))
    .map(([url, operator]) => `${url} (${operator})`)
    .join(", ");
  const issuerProblem = (key) => {
    const issuer = issuers.get(key);
    if (!issuer) return `${key} is not defined under deploy/, so the repo cannot tell which CA it uses`;
    const acme = issuer.spec?.acme;
    if (!acme) return `${key} (${issuer.source}) is not an ACME issuer (${Object.keys(issuer.spec ?? {}).join(", ") || "no spec"}): no binary pins its CA`;
    const operator = ACME_DIRECTORIES[acme.server];
    if (!operator || !operators.has(operator)) return `${key} (${issuer.source}) uses ${acme.server}, not the ACME directory of a pinned CA operator (${allowed || "none"})`;
    return null;
  };
  const problems = [];
  const check = (subject, source, names, key) => {
    const pinned = hosts.filter((host) => names.some((name) => covers(name, host)));
    if (pinned.length === 0) return;
    const problem = issuerProblem(key);
    if (problem) problems.push(`${subject} (${source}) is issued for ${pinned.join(", ")}, which every UniChat binary pins, but ${problem}: phones lose the server once it is applied (${RUNBOOK_BEFORE})`);
  };
  for (const doc of docs) {
    const namespace = doc.metadata?.namespace ?? "default";
    const subject = `${doc.kind} ${namespace}/${doc.metadata?.name}`;
    if (doc.kind === "Certificate") {
      const ref = doc.spec?.issuerRef ?? {};
      const kind = ref.kind ?? "Issuer";
      const names = [...(doc.spec?.dnsNames ?? []), ...(doc.spec?.commonName ? [doc.spec.commonName] : [])];
      check(subject, doc.source, names, kind === "ClusterIssuer" ? `ClusterIssuer ${ref.name}` : `Issuer ${namespace}/${ref.name}`);
    }
    const annotations = doc.metadata?.annotations ?? {};
    const cluster = annotations["cert-manager.io/cluster-issuer"];
    const local = annotations["cert-manager.io/issuer"];
    if (doc.kind !== "Certificate" && (cluster || local)) {
      const names = (doc.spec?.tls ?? []).flatMap((entry) => entry?.hosts ?? []);
      check(subject, doc.source, names, cluster ? `ClusterIssuer ${cluster}` : `Issuer ${namespace}/${local}`);
    }
  }
  return problems;
}

function summary({ rows, expiry, shipped }) {
  const mark = { ok: "ok", warn: "warning", error: "**FAILED**" };
  const lines = ["### UniChat TLS pins", "", `Pin-set: ${expiry.message}.`, "", `Pin-sets in the field: ${shipped.join(", ") || "none"}.`, "", "| Host | Variants | Result | Chain (leaf first) |", "| --- | --- | --- | --- |"];
  for (const row of rows) lines.push(`| \`${row.host}\` | ${row.variants.join(", ")} | ${mark[row.level]}: ${row.message} | ${row.chain.map((cert) => cert.subject).join(" ← ")} |`);
  return `${lines.join("\n")}\n`;
}

async function main(argv) {
  const arg = (name) => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };
  const file = JSON.parse(fs.readFileSync(path.resolve(ROOT, arg("--file") ?? PINS_FILE), "utf8"));
  const warnDays = arg("--warn-days") === undefined ? undefined : Number(arg("--warn-days"));
  const now = arg("--now") ? new Date(arg("--now")) : new Date();
  const git = (args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (git(["rev-parse", "--is-shallow-repository"]).trim() === "true") {
    throw new Error(`a shallow checkout cannot see every ${TAG_PREFIX}* tag: check out with fetch-depth: 0`);
  }
  let found;
  if (arg("--min-version") !== undefined) {
    if (arg("--min-version") !== "" && !parseVersion(arg("--min-version"))) throw new Error(`--min-version is not MAJOR.MINOR.PATCH: ${arg("--min-version")}`);
    found = { minimum: arg("--min-version") };
  } else {
    const api = fs.readFileSync(path.join(ROOT, DEPLOY_ENV), "utf8").match(/^API_PUBLIC_URL=(\S+)$/m)?.[1];
    found = api ? await minimumSupportedVersion({ api }) : { minimum: "", warning: `${DEPLOY_ENV} names no API_PUBLIC_URL: checking the pin-set of every ${TAG_PREFIX}* tag` };
  }
  const shipped = shippedPinSets({ git, minimum: found.minimum });
  const result = await checkPins({ file, shipped, now, ...(warnDays === undefined ? {} : { warnDays }) });
  if (found.warning) result.warnings.unshift(found.warning);
  for (const row of result.rows) console.log(`${row.level.padEnd(5)} ${row.host} [${row.variants.join(", ")}] ${row.message}`);
  console.log(result.expiry.message);
  console.log(`pin-sets in the field (minimum supported version ${found.minimum || "none"}): ${result.shipped.join(", ") || "none"}`);
  for (const warning of result.warnings) console.log(`::warning::${warning}`);
  for (const error of result.errors) console.log(`::error::${error}`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary(result));
  return result.errors.length === 0 ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.log(`::error::${error.message}`);
      process.exit(1);
    },
  );
}
