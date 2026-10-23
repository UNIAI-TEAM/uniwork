import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

function assignments(relativePath) {
  const text = fs.readFileSync(path.join(root, relativePath), "utf8");
  const out = new Map();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    out.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
  }
  return out;
}

const businessFiles = [
  "deploy/app-dev/env/uniwork-be.env",
  "deploy/app-dev/env/uniwork-fe.env",
  "deploy/app-dev/env/uniwork-fe.build.env",
  "deploy/app-dev/env/uniwork-office-engine.env",
];

test("business env files carry no secrets", () => {
  const forbiddenExact = new Set([
    "DATABASE_URL",
    "REDIS_URL",
    "JWT_SECRET",
    "OFFICE_ENGINE_SERVICE_TOKEN",
    "OFFICE_ENGINE_GRANT_KEY",
  ]);
  for (const file of businessFiles) {
    for (const [key, value] of assignments(file)) {
      const sensitive =
        forbiddenExact.has(key) ||
        key.includes("PASSWORD") ||
        key.includes("SECRET") ||
        key.includes("ACCESS_KEY") ||
        key.includes("API_KEY");
      if (sensitive) assert.equal(value, "", `${file} ${key}`);
    }
  }

  const be = assignments("deploy/app-dev/env/uniwork-be.env");
  assert.equal(be.get("STORAGE_BACKEND"), "minio");
  assert.equal(be.get("MINIO_ENDPOINT"), "https://minio.ubos.vn");
  assert.equal(be.get("MINIO_BUCKET"), "uniwork-development");
  assert.equal(be.get("MINIO_REGION"), "us-east-1");
  assert.equal(be.get("S3_KEY_PREFIX"), "develop/");
  assert.equal(be.get("APP_ENV"), "development");
  assert.equal(be.get("TRUSTED_PROXIES"), "10.230.19.0/24");
  assert.equal(be.get("PREVIEW_ORIGIN"), "https://preview.unicomhub.com");
  assert.equal(be.get("OFFICE_ENGINE_URL"), "");

  const office = assignments("deploy/app-dev/env/uniwork-office-engine.env");
  assert.equal(office.get("OFFICE_ENGINE_OUTPUT_ORIGINS"), "https://minio.ubos.vn");
  const officeText = fs.readFileSync(
    path.join(root, "deploy/app-dev/env/uniwork-office-engine.env"),
    "utf8",
  );
  assert.equal(officeText.includes("s3.hn-2.cloud.cmctelecom.vn"), false);

  const build = assignments("deploy/app-dev/env/uniwork-fe.build.env");
  assert.deepEqual([...build.keys()], [
    "NEXT_PUBLIC_API_URL",
    "NEXT_PUBLIC_WS_URL",
    "NEXT_PUBLIC_APP_URL",
  ]);
  assert.equal(build.get("NEXT_PUBLIC_API_URL"), "https://uniwork.unicomhub.com");
  assert.equal(build.get("NEXT_PUBLIC_WS_URL"), "wss://uniwork.unicomhub.com");
  assert.equal(build.get("NEXT_PUBLIC_APP_URL"), "https://uniwork.unicomhub.com");
});

test("compose files pin registry images", () => {
  const compose = fs.readFileSync(path.join(root, "deploy/app-dev/docker-compose.yml"), "utf8");
  assert.match(compose, /^name: uniwork-app-dev$/m);
  assert.match(compose, /subnet: 10\.230\.19\.0\/24/);
  assert.equal(/^\s*build\s*:/m.test(compose), false);
  assert.equal(/^\s{2}(postgres|redis|minio)\s*:/m.test(compose), false);

  const secrets = fs.readFileSync(
    path.join(root, "deploy/app-dev/docker-compose.secrets.yml"),
    "utf8",
  );
  assert.match(secrets, /OFFICE_ENGINE_SERVICE_TOKEN: \$\{OFFICE_ENGINE_SERVICE_TOKEN:\?\}/);
  assert.match(secrets, /OFFICE_ENGINE_GRANT_KEY: \$\{OFFICE_ENGINE_GRANT_KEY:\?\}/);
  assert.equal(secrets.includes("dev-only-office-engine"), false);
});

test("Jenkinsfile deploys by SSH without a latest tag", () => {
  const text = fs.readFileSync(path.join(root, "ci/Jenkinsfile.app-dev.groovy"), "utf8");
  for (const value of ["113.20.107.188", "2232", "root", "/home/devops/uniwork", "ssh-107.188"]) {
    assert.equal(text.includes(value), true, value);
  }
  assert.equal(/docker\s+(tag|push)\b[^\n]*:latest/.test(text), false);
  assert.equal(text.includes("cfg=\\\\$(mktemp -d)"), true, "cfg=\\\\$(mktemp -d)");
  assert.equal((text.match(/sh '''#!\/bin\/bash/g) || []).length, 2);
});
