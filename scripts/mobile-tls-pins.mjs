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
//   node scripts/mobile-tls-pins.mjs [--file apps/chat-mobile/tls-pins.json] [--warn-days 60] [--now 2027-01-01]
//
// Runs daily and on every PR that touches the pins (.github/workflows/chat-mobile-tls-pins.yml). Prints GitHub
// annotations and, under Actions, a table in the step summary; exits 1 on any error.
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

/** Every pinned host and the pin-set's expiry: { errors, warnings, rows }. */
export async function checkPins({ file, now = new Date(), warnDays = file.warnDays ?? 60, fetch = fetchChain, attempts = 3, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  const errors = [];
  const warnings = [];
  const rows = [];
  const expiry = expiryStatus(file.expires, now, warnDays);
  if (expiry.level === "error") errors.push(expiry.message);
  if (expiry.level === "warn") warnings.push(expiry.message);
  for (const { host, port, variants } of pinnedHosts(file)) {
    const name = `${host}:${port}`;
    const label = `${name} (${variants.join(", ")})`;
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
    if (!chain) {
      const message = `${label}: unreachable after ${attempts} attempts: ${failure?.message ?? failure}`;
      errors.push(message);
      rows.push({ host: name, variants, level: "error", message, chain: [] });
      continue;
    }
    const verdict = chainVerdict(chain, file.pins ?? [], now);
    if (verdict.level === "error") errors.push(`${label}: ${verdict.message}`);
    if (verdict.level === "warn") warnings.push(`${label}: ${verdict.message}`);
    rows.push({ host: name, variants, level: verdict.level, message: verdict.message, chain });
  }
  return { errors, warnings, rows, expiry };
}

function summary({ rows, expiry }) {
  const mark = { ok: "ok", warn: "warning", error: "**FAILED**" };
  const lines = ["### UniChat TLS pins", "", `Pin-set: ${expiry.message}.`, "", "| Host | Variants | Result | Chain (leaf first) |", "| --- | --- | --- | --- |"];
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
  const result = await checkPins({ file, now, ...(warnDays === undefined ? {} : { warnDays }) });
  for (const row of result.rows) console.log(`${row.level.padEnd(5)} ${row.host} [${row.variants.join(", ")}] ${row.message}`);
  console.log(result.expiry.message);
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
