#!/usr/bin/env node
// Node 22 built-in verifier for the G3-G4 contract vectors. This is a tiny
// deterministic check, not a product auth implementation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const vectors = join(here, "..", "..", "docs", "office", "g3g4", "vectors");
const pkce = JSON.parse(await readFile(join(vectors, "pkce-rfc7636.json"), "utf8"));
const callbacks = JSON.parse(await readFile(join(vectors, "callback-rejections.json"), "utf8"));
const launchTickets = JSON.parse(await readFile(join(vectors, "launch-ticket.json"), "utf8"));
const deepLinks = JSON.parse(await readFile(join(vectors, "deep-link.json"), "utf8"));
const exchanges = JSON.parse(await readFile(join(vectors, "exchange.json"), "utf8"));

test("RFC 7636 appendix B S256 challenge is reproduced", () => {
  assert.equal(pkce.code_challenge_method, "S256");
  const actual = createHash("sha256")
    .update(Buffer.from(pkce.code_verifier, "ascii"))
    .digest()
    .toString("base64url");
  assert.equal(actual, pkce.code_challenge);
});

test("every callback rejection vector is rejected at its documented layer", () => {
  assert.equal(callbacks.length, 8, "callback vector set changed");
  const exactRedirect = "uniwork-office://auth/callback";
  const isSingleString = (value) => typeof value === "string" && value.length > 0;
  for (const vector of callbacks) {
    const { query, pending } = vector;
    const rejected = !pending
      || !isSingleString(query.code)
      || !isSingleString(query.state)
      || query.state !== pending.state
      || pending.redirect_uri !== exactRedirect
      || (vector.callback_redirect ?? exactRedirect) !== exactRedirect
      || (vector.callback_deployment ?? pending.deployment_id) !== pending.deployment_id
      || vector.code_redeemed === true
      || (pending.expires_at && new Date(vector.now ?? new Date().toISOString()) >= new Date(pending.expires_at));
    assert.ok(rejected, `${vector.id}: vector was not rejected`);
    assert.equal(vector.expected_outcome, "rejected", `${vector.id}: expected_outcome`);
    assert.ok(["client", "exchange"].includes(vector.rejected_at), `${vector.id}: rejected_at layer`);
    if (vector.rejected_at === "exchange") {
      assert.equal(vector.expected_error, "auth_code_invalid", `${vector.id}: exchange error`);
    } else {
      assert.equal(vector.expected_error, undefined, `${vector.id}: a client discard never produces a server error`);
    }
  }
  console.log(`verified RFC 7636 S256 vector and ${callbacks.length} callback rejection vectors`);
});

const ticketPattern = /^ticket_[A-Za-z0-9_-]{32,185}$/;
const reasonForTicket = (ticket) => {
  if (/^(?:code|state|attempt)[_-]/i.test(ticket) || /^fake-code-/i.test(ticket)) return "login_code";
  if (ticket.length > 192) return "oversized_ticket";
  return ticket.length >= 39 && ticketPattern.test(ticket) ? undefined : "invalid_ticket";
};

test("launch ticket vectors pin issuer, size and login-code separation", () => {
  for (const vector of launchTickets.valid) assert.equal(reasonForTicket(vector.ticket), undefined, vector.id);
  for (const vector of launchTickets.invalid) {
    if (vector.ticket_length) {
      assert.equal(vector.ticket_length, 193, vector.id);
      continue;
    }
    assert.equal(reasonForTicket(vector.ticket), vector.expected_reason, vector.id);
  }
});

test("deep-link vectors allow only one canonical ticket parameter", () => {
  for (const vector of deepLinks.valid) {
    const url = new URL(vector.url);
    assert.equal(url.protocol, "uniwork-office:", vector.id);
    assert.equal(url.hostname, "open", vector.id);
    assert.equal(url.pathname === "" || url.pathname === "/", true, vector.id);
    assert.equal([...url.searchParams.keys()].join(","), "ticket", vector.id);
    assert.equal(url.searchParams.get("ticket"), vector.expected.ticket, vector.id);
  }
  for (const vector of deepLinks.invalid) {
    const raw = vector.url;
    let rejected = false;
    try {
      const url = new URL(raw);
      const keys = [...url.searchParams.keys()];
      rejected = url.protocol !== "uniwork-office:" || url.hostname !== "open" || (url.pathname !== "" && url.pathname !== "/") || keys.length !== 1 || keys[0] !== "ticket" || reasonForTicket(url.searchParams.get("ticket") ?? "") !== undefined;
    } catch {
      rejected = true;
    }
    assert.equal(rejected, true, vector.id);
  }
});

test("exchange vectors keep the descriptor first-party and receipt-only", () => {
  assert.equal(exchanges.request.client_id, "uniwork-office");
  assert.equal(exchanges.valid_response.receipt_id.length > 0, true);
  assert.match(exchanges.valid_response.document.download_path, /^\/api\/v1\/documents\/.+\/download$/);
  for (const vector of exchanges.invalid) {
    if (vector.response) assert.notEqual(vector.response.document?.download_path?.startsWith("/api/v1/documents/"), true, vector.id);
    if (vector.request) assert.equal(vector.expected_reason, "invalid_request", vector.id);
  }
});
