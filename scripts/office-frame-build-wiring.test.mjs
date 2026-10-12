import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

// A production image must ship the genoffice frame bundles. The gate lives in
// apps/web/scripts/office-frame-sync.mjs (NODE_ENV=production); the source it installs from is
// committed (apps/web/platform/office-frame/source.json, a public release tarball checked by
// sha256), so none of the places that build the web image needs a credential. OFFICE_FRAME_SOURCE
// stays an optional override.

test("the web Dockerfile builds with NODE_ENV=production and takes OFFICE_FRAME_SOURCE only as an optional build arg", () => {
  const dockerfile = read("apps/web/Dockerfile");
  assert.match(dockerfile, /^ARG OFFICE_FRAME_SOURCE=?$/m, "ARG OFFICE_FRAME_SOURCE missing");
  assert.match(dockerfile, /^RUN NODE_ENV=production pnpm --filter @uniwork\/web build$/m, "the build RUN must carry NODE_ENV=production");
  assert.doesNotMatch(dockerfile, /^ENV[^\n]*OFFICE_FRAME_SOURCE/m, "the override must not become an ENV");
  assert.ok(
    dockerfile.indexOf("ARG OFFICE_FRAME_SOURCE") > dockerfile.indexOf("pnpm install"),
    "the ARG must come after pnpm install so an override stays out of the install layer",
  );
});

// pnpm install runs the packages/office-upstream prepare script, which applies its patch series
// with `git apply`; node:22-alpine has no git (232e58a2b, lost once in #219).
test("the web Dockerfile installs git before pnpm install", () => {
  const dockerfile = read("apps/web/Dockerfile");
  const git = dockerfile.search(/^RUN apk add --no-cache git$/m);
  assert.ok(git >= 0, "the build stage must install git");
  assert.ok(git < dockerfile.indexOf("RUN pnpm install"), "git must be installed before pnpm install");
});

test("the production Jenkinsfile builds the web image without a frame credential", () => {
  const jenkins = read("ci/Jenkinsfile.production-app.groovy");
  assert.doesNotMatch(jenkins, /OFFICE_FRAME_SOURCE/, "the Jenkinsfile must not wire OFFICE_FRAME_SOURCE or its credential");
  assert.match(jenkins, /-f apps\/web\/Dockerfile \./, "the FE image build is gone from the Jenkinsfile");
});

test("docker-compose.prod.yml may forward an OFFICE_FRAME_SOURCE override that defaults to empty", () => {
  const compose = read("docker-compose.prod.yml");
  const web = compose.slice(compose.indexOf("\n  web:"));
  const build = web.slice(web.indexOf("build:"), web.indexOf("environment:"));
  assert.match(build, /^\s+OFFICE_FRAME_SOURCE:\s*\$\{OFFICE_FRAME_SOURCE:-\}/m);
});

test("the CI e2e job installs the frame from the committed source, not from a secret", () => {
  const ci = read(".github/workflows/ci.yml");
  assert.doesNotMatch(ci, /secrets\.OFFICE_FRAME_SOURCE/, "OFFICE_FRAME_SOURCE secret is no longer used");
});

test("the committed frame source is a sha256-pinned https tarball of the same fork build as the pins", () => {
  const source = JSON.parse(read("apps/web/platform/office-frame/source.json"));
  assert.equal(source.schema, 1);
  assert.match(source.url, /^https:\/\/\S+\.tar\.gz$/);
  assert.match(source.sha256, /^[0-9a-f]{64}$/);
  for (const module of ["docs", "pdf", "markdown", "html", "slides", "sheets"]) {
    const pin = JSON.parse(read(`apps/web/platform/office-frame/${module}.pin.json`));
    assert.ok(source.url.includes(pin.version), `source.json url must name ${module}'s pinned ${pin.version}: a re-pin changes the pins and source.json in one commit`);
  }
});
