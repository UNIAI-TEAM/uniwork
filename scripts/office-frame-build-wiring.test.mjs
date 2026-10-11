import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

// A production image must ship the genoffice frame bundles. The gate lives in
// apps/web/scripts/office-frame-sync.mjs (NODE_ENV=production), so the three
// places that build the web image have to keep feeding it the source.

test("the web Dockerfile builds with NODE_ENV=production and takes OFFICE_FRAME_SOURCE as a build arg", () => {
  const dockerfile = read("apps/web/Dockerfile");
  assert.match(dockerfile, /^ARG OFFICE_FRAME_SOURCE=?$/m, "ARG OFFICE_FRAME_SOURCE missing");
  assert.match(dockerfile, /^RUN NODE_ENV=production pnpm --filter @uniwork\/web build$/m, "the build RUN must carry NODE_ENV=production");
  assert.doesNotMatch(dockerfile, /^ENV[^\n]*OFFICE_FRAME_SOURCE/m, "the secret must not become an ENV");
  assert.ok(
    dockerfile.indexOf("ARG OFFICE_FRAME_SOURCE") > dockerfile.indexOf("pnpm install"),
    "the ARG must come after pnpm install so the secret stays out of the install layer",
  );
});

test("the production Jenkinsfile passes OFFICE_FRAME_SOURCE to the web image build", () => {
  const jenkins = read("ci/Jenkinsfile.production-app.groovy");
  assert.match(jenkins, /--build-arg OFFICE_FRAME_SOURCE=/);
});

test("docker-compose.prod.yml forwards OFFICE_FRAME_SOURCE to the web build", () => {
  const compose = read("docker-compose.prod.yml");
  const web = compose.slice(compose.indexOf("\n  web:"));
  const build = web.slice(web.indexOf("build:"), web.indexOf("environment:"));
  assert.match(build, /^\s+OFFICE_FRAME_SOURCE:\s*\$\{OFFICE_FRAME_SOURCE/m);
});
