// scripts/mobile-ci-provisioning.mjs: the names the mobile workflows read come from the workflow files themselves, a
// job's environment is honoured, and the check fails on a required name GitHub does not have.
import assert from "node:assert/strict";
import test from "node:test";
import { allRequirements, audit, fetchRemote, OPTIONAL, report, requirements } from "./mobile-ci-provisioning.mjs";

const WORKFLOW = `name: x
env:
  ORG: \${{ vars.SENTRY_ORG }}
jobs:
  build:
    runs-on: ubuntu-latest
    environment: chat-mobile-release
    steps:
      - run: echo \${{ secrets.EXPO_TOKEN }} \${{ secrets.GITHUB_TOKEN }}
  nightly:
    environment:
      name: chat-mobile-nightly
    steps:
      - run: echo \${{ vars.MAESTRO_API_URL }} \${{ secrets.EXPO_TOKEN }} \${{ vars.SENTRY_URL }}
`;

test("reads every vars/secrets name per job, with the job's environment, and leaves GitHub's own token out", () => {
  const rows = requirements("x.yml", WORKFLOW).map((r) => `${r.job}|${r.environment}|${r.kind}|${r.name}`);
  assert.deepEqual(rows, [
    "(workflow)|null|variable|SENTRY_ORG",
    "build|chat-mobile-release|secret|EXPO_TOKEN",
    "build|chat-mobile-release|environment|chat-mobile-release",
    "nightly|chat-mobile-nightly|variable|MAESTRO_API_URL",
    "nightly|chat-mobile-nightly|secret|EXPO_TOKEN",
    "nightly|chat-mobile-nightly|variable|SENTRY_URL",
    "nightly|chat-mobile-nightly|environment|chat-mobile-nightly",
  ]);
});

test("a name is met in the job's environment or the repository; an environment must exist; optional names say why", () => {
  const remote = {
    repo: { variables: new Set(["SENTRY_ORG"]), secrets: new Set() },
    environments: { "chat-mobile-release": { variables: new Set(), secrets: new Set(["EXPO_TOKEN"]) } },
  };
  const results = audit(requirements("x.yml", WORKFLOW), remote);
  const state = Object.fromEntries(results.map((r) => [`${r.job}|${r.kind}|${r.name}`, r.found ?? (r.optional ? "optional" : "missing")]));
  assert.equal(state["(workflow)|variable|SENTRY_ORG"], "repository");
  assert.equal(state["build|secret|EXPO_TOKEN"], "environment chat-mobile-release");
  assert.equal(state["build|environment|chat-mobile-release"], "environment");
  assert.equal(state["nightly|secret|EXPO_TOKEN"], "missing", "a secret of another environment does not count");
  assert.equal(state["nightly|environment|chat-mobile-nightly"], "missing");
  assert.equal(state["nightly|variable|SENTRY_URL"], "optional");
  const { lines, ok } = report(results);
  assert.equal(ok, false);
  assert.match(lines.join("\n"), /x\.yml › nightly \[chat-mobile-nightly\] {2}secret EXPO_TOKEN: MISSING/);
  assert.match(lines.at(-1), /3 required setting\(s\) missing/);
});

test("reports success when everything required exists", () => {
  const remote = {
    repo: { variables: new Set(["SENTRY_ORG", "MAESTRO_API_URL"]), secrets: new Set(["EXPO_TOKEN"]) },
    environments: { "chat-mobile-release": { variables: new Set(), secrets: new Set() }, "chat-mobile-nightly": { variables: new Set(), secrets: new Set() } },
  };
  const { ok, lines } = report(audit(requirements("x.yml", WORKFLOW), remote));
  assert.equal(ok, true);
  assert.equal(lines.at(-1), "Every required setting exists.");
});

test("asks GitHub for names only, by scope, every page", () => {
  const asked = [];
  const pages = {
    "repos/o/r/environments": [{ environments: [{ name: "chat-mobile-nightly" }] }],
    "repos/o/r/environments/chat-mobile-nightly/variables": [{ variables: [] }],
    "repos/o/r/environments/chat-mobile-nightly/secrets": [{ secrets: [{ name: "EXPO_TOKEN" }] }],
    "repos/o/r/actions/variables": [{ variables: [{ name: "MAESTRO_API_URL" }] }, { variables: [{ name: "MAESTRO_ROOM_ID" }] }],
    "repos/o/r/actions/secrets": [{ secrets: [] }],
  };
  const remote = fetchRemote((endpoint) => {
    asked.push(endpoint);
    return pages[endpoint];
  }, "o/r");
  assert.deepEqual([...remote.repo.variables], ["MAESTRO_API_URL", "MAESTRO_ROOM_ID"]);
  assert.deepEqual([...remote.environments["chat-mobile-nightly"].secrets], ["EXPO_TOKEN"]);
  assert.equal(asked.length, 5);
});

test("the real workflows: the nightly's settings, the release environments and every optional name are known", () => {
  const rows = allRequirements();
  const names = new Set(rows.map((r) => r.name));
  for (const name of ["MAESTRO_TEST_EMAIL", "MAESTRO_CALLER_PASSWORD", "UNICHAT_GOOGLE_SERVICES_JSON", "EXPO_TOKEN", "chat-mobile-nightly", "chat-mobile-production"]) {
    assert.ok(names.has(name), `${name} is read by a mobile workflow`);
  }
  for (const name of Object.keys(OPTIONAL)) assert.ok(names.has(name), `OPTIONAL.${name} is still read somewhere`);
  // The PR gate reads nothing: it must run on a fork's PR and never waits on a setting.
  assert.deepEqual(rows.filter((r) => r.workflow === "mobile-verify.yml"), []);
});
