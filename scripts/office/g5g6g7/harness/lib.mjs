/* global process, Buffer */
// Pure helpers for the G7-01 app harness (UNI-1376): fresh port picking and the
// environment a run is started with. Nothing here touches the network beyond
// binding a throwaway listener to port 0, so the node --test file can pin the
// behaviour without starting the stack.
import net from "node:net";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/** Exit code every harness script uses for "a precondition is missing", never for "the check failed". */
export const BLOCKED_EXIT = 77;

/** The pinned fork revision the harness runs unless OFFICE_FORK_SHA overrides it. */
export const DEFAULT_FORK_SHA = "0d03b18";

/**
 * Picks `count` free TCP ports on `host`. Each candidate is bound with listen(0)
 * so the kernel picks an unused port, then released; ports already handed out in
 * this call are never returned twice. A run gets its own ports because a warm
 * cloud VM still holds :3000/:8080 from an earlier round.
 */
export async function freePorts(count, { host = "127.0.0.1" } = {}) {
  if (!Number.isInteger(count) || count < 1) throw new Error(`freePorts needs a positive count, got ${count}`);
  const taken = new Set();
  const ports = [];
  for (let i = 0; i < count; i += 1) {
    let port;
    do {
      port = await oneFreePort(host);
    } while (taken.has(port));
    taken.add(port);
    ports.push(port);
  }
  return ports;
}

function oneFreePort(host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen({ port: 0, host, exclusive: true }, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((err) => (err ? reject(err) : port ? resolve(port) : reject(new Error("no port was assigned"))));
    });
  });
}

/** `http://host:port` for a port number. */
export function origin(port, scheme = "http", host = "127.0.0.1") {
  return `${scheme}://${host}:${port}`;
}

/**
 * `http://localhost:port` for the web and the API a browser opens. Never
 * 127.0.0.1: Next 16 `next dev` blocks /_next/hmr from any other host
 * (allowedDevOrigins), so a page opened on 127.0.0.1 is server-rendered but never
 * hydrates and a click on "Log in" is a native GET submit (G7-06 cloud round 1).
 * Web and API share the host so the refresh cookie the API sets is same-site for
 * the page, as in the e2e suite (localhost:3000 against localhost:8080).
 */
export function appOrigin(port, scheme = "http") {
  return origin(port, scheme, "localhost");
}

/**
 * The loopback origins a served client chunk inlines (`http://localhost:8080`,
 * `http://127.0.0.1:3000`), each as the build spells it. The sample AC compares
 * them with the run's API_ORIGIN, which is `localhost`; rewriting one spelling
 * into the other here made a correct build read as stale.
 * @param {string} body
 * @returns {string[]}
 */
export function loopbackOriginsIn(body) {
  return [...new Set(String(body).matchAll(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+/g).map((match) => match[0]))];
}

/**
 * The environment the D server is started with, on the command line. Everything
 * is derived from the run's ports, so a run can never talk to a stale server on
 * the default :8080. `apiOrigin` is also the value the web build inlines
 * (NEXT_PUBLIC_API_URL) and the origin the Electron app is pointed at
 * (UNIWORK_API_ORIGIN).
 */
export function buildServerEnv({
  apiPort,
  webPort,
  metricsPort,
  previewPort,
  databaseUrl,
  redisUrl,
  jwtSecret = "harness-dev-secret",
  uploadDir,
  previewCapabilitySecret = "harness-preview-capability-secret-32b",
  deploymentId = "default",
  verificationCode = "123456",
}) {
  const apiOrigin = appOrigin(apiPort);
  const webOrigin = appOrigin(webPort);
  return {
    PORT: String(apiPort),
    FRONTEND_ORIGIN: webOrigin,
    // The server refuses a PREVIEW_ORIGIN equal to FRONTEND_ORIGIN, so preview
    // gets its own port from the run's set rather than webPort + 1 (which could
    // land on the API or metrics port).
    PREVIEW_ORIGIN: origin(previewPort),
    PREVIEW_CAPABILITY_SECRET: previewCapabilitySecret,
    API_PUBLIC_URL: apiOrigin,
    // METRICS_ADDR is a bare host:port the server listens on, not an origin.
    METRICS_ADDR: `127.0.0.1:${metricsPort}`,
    NEXT_PUBLIC_API_URL: apiOrigin,
    NEXT_PUBLIC_WS_URL: appOrigin(apiPort, "ws"),
    NEXT_PUBLIC_APP_URL: webOrigin,
    E2E_BASE_URL: webOrigin,
    LOCAL_UPLOAD_BASE_URL: apiOrigin,
    STORAGE_BACKEND: "local",
    LOCAL_UPLOAD_DIR: uploadDir,
    JWT_SECRET: jwtSecret,
    APP_ENV: "development",
    DEV_VERIFICATION_CODE: verificationCode,
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    DESKTOP_AUTH_DEPLOYMENT_IDS: deploymentId,
    // The fork's dev channel registers `uniwork-office-dev` and the D server
    // addresses its launch links with that client id, so the dev client must be
    // allow-listed alongside the stable default (config.go:192-218; the office
    // launch service refuses a client id outside the allowlist, office_launch.go:76-82).
    // DESKTOP_AUTH_CLIENTS and the single-client pair are mutually exclusive at
    // startup (config.go:306-310), so the pair is cleared: the VM's .env may
    // carry it, and both together is a boot error.
    DESKTOP_AUTH_CLIENTS: `uniwork-office=uniwork-office://auth/callback,${DEV_CLIENT_ID}=${DEV_CLIENT_ID}://auth/callback`,
    DESKTOP_AUTH_CLIENT_ID: "",
    DESKTOP_AUTH_REDIRECT_URIS: "",
    // No LiveKit on the VM. The server wires a conference provider only when
    // LIVEKIT_URL/KEY/SECRET are all set (cmd/server/main.go:203); they are
    // cleared explicitly, because the VM's .env carries .env.example's
    // ws://localhost:7880 and this run must not inherit a setting that points
    // at a service the harness never starts.
    LIVEKIT_URL: "",
    LIVEKIT_API_KEY: "",
    LIVEKIT_API_SECRET: "",
  };
}

/**
 * The dev-channel client id the fork registers and the D server allow-lists
 * (`DESKTOP_AUTH_CLIENT_ID`/`DESKTOP_AUTH_CLIENTS`, config.go:232-234). A dev
 * build claims `uniwork-office-dev` and the server addresses its links with the
 * same id, so a dev run is never handed to the stable app's protocol handler
 * (server/internal/handler/office_launch.go:47-52, fork deployment.ts:19-33).
 */
export const DEV_CLIENT_ID = "uniwork-office-dev";

/** The deployment id the harness server is started with (buildServerEnv's default). */
export const HARNESS_DEPLOYMENT_ID = "default";

/**
 * The deep link D returns for a launch session: `<client_id>://open?ticket=…`
 * (server/internal/handler/office_launch.go:50). The ticket is percent-encoded,
 * so a ticket with any reserved character survives the round trip; the fork's
 * `parseOfficeDeepLink` reads the same query (apps/shell/src/main/uniwork-docs/launch.ts).
 */
export function officeDeepLink(clientId, ticket) {
  return `${String(clientId).trim()}://open?ticket=${encodeURIComponent(String(ticket))}`;
}

/**
 * Where the fork keeps one document's working copy:
 * `<userData>/uniwork-documents/<deploymentId>/<userId>/<documentKey>/<file>`
 * plus `binding.json` next to it (fork binding-store.ts:14-19,165-167). This is
 * the app's own record that it opened a UniWork document, which is why the
 * document step reads it instead of trusting a screenshot.
 */
export function workingCopyDir(userDataDir, deploymentId, userId, documentKey) {
  return join(userDataDir, "uniwork-documents", deploymentId, userId, documentKey);
}

/**
 * The launch ticket of a `uniwork-office[-dev]://open?ticket=…` deep link, or
 * null. The harness never assumes the shape: it reads the ticket the server
 * returned and only then builds the argv it hands to the app.
 */
export function ticketFromLaunchUrl(url) {
  try {
    const parsed = new URL(String(url));
    return parsed.searchParams.get("ticket");
  } catch {
    return null;
  }
}

/** How long `--wait-signin` waits for a desktop sign-in when it is given no number. */
const DEFAULT_SIGNIN_WAIT_SECONDS = 300;

/**
 * The seconds `--wait-signin [seconds]` asks for, or null when the flag is
 * absent. A flag without a (positive whole) number waits the default.
 */
export function parseWaitSignin(argv) {
  const at = argv.indexOf("--wait-signin");
  if (at < 0) return null;
  const next = argv[at + 1];
  return typeof next === "string" && /^[1-9][0-9]*$/.test(next) ? Number(next) : DEFAULT_SIGNIN_WAIT_SECONDS;
}

/**
 * The account's live native device session for one client and deployment, from
 * `GET /api/v1/auth/desktop/devices` (sdo.DesktopDeviceDTO), or null. "Live" is
 * what the server says: not revoked and not past `expires_at`. This is the
 * server's own record that the desktop app is signed in as that account — the
 * session itself sits encrypted in the app's userData and is never read.
 */
export function activeDesktopDevice(devices, { clientId, deploymentId, now = Date.now() }) {
  if (!Array.isArray(devices)) return null;
  return (
    devices.find(
      (device) =>
        device &&
        device.client_id === clientId &&
        device.deployment_id === deploymentId &&
        !device.revoked_at &&
        (!device.expires_at || Date.parse(device.expires_at) > now),
    ) ?? null
  );
}

/**
 * What the document step can conclude about one launch, given the ticket the D
 * server issued, the deep link it built, and whether the app left a working
 * copy. Kept pure so the three outcomes are pinned by a test without an app:
 *
 *   * no deep link / no ticket -> the D server refused the session: FAIL (the
 *     harness ran; the claim "D issues a ticket for a fixture document" is false)
 *   * a ticket but no working copy -> the app did not open it. `signedIn` says
 *     whether a desktop session existed at all: with no session the app had
 *     nothing to redeem with and the precondition is missing (BLOCKED, the same
 *     "no OS keyring" precondition the fork's own suite skips on); with a
 *     session the app was handed a ticket and did not open the document (FAIL).
 *   * a working copy naming the fixture document -> PASS.
 */
export function documentStepOutcome({ launchUrl, ticket, workingCopyDocumentId, documentId, signedIn }) {
  if (!launchUrl || !ticket) {
    return { result: "FAIL", blocker: null, detail: "the D server returned no launch ticket/deep link for the fixture document" };
  }
  if (workingCopyDocumentId === documentId) {
    return { result: "PASS", blocker: null, detail: `the app opened ${documentId}` };
  }
  if (!signedIn) {
    return {
      result: "BLOCKED",
      blocker: "the app is not signed in: it has no desktop session to redeem the launch ticket (the harness does not automate the sign-in, and a Linux VM without an OS keyring cannot keep one; the fork's own suite skips on the same precondition). Run G7-A01 on a signed-in desktop: see the README, 'Run it on a signed-in desktop'",
      detail: "no signed-in session in the app",
    };
  }
  return {
    result: "FAIL",
    blocker: null,
    detail: `the app was handed the deep link but left no working copy for ${documentId}${workingCopyDocumentId ? ` (it opened ${workingCopyDocumentId})` : ""}`,
  };
}

/**
 * Where the D server is started, and what it finds there. The server also reads
 * a local `.env` for every key that is empty or unset in its process
 * environment (server/cmd/server/envfile.go: tryLoadDevEnv looks in the cwd and
 * three levels up, and `os.Getenv(key) != ""` is its only "already set" test).
 * So clearing a key in server.env is not enough: an empty
 * `DESKTOP_AUTH_CLIENT_ID=` is refilled from the checkout's .env and collides
 * with DESKTOP_AUTH_CLIENTS at boot (cloud round 4), and the cleared LiveKit
 * settings came back the same way. The server therefore runs three directories
 * deep inside a directory of its own, where none of the four lookups reaches
 * the checkout's `.env`, and finds there a copy of that file WITHOUT the keys
 * the run owns (serverDotEnv). The VM's other settings (PREVIEW_ASSET_TTL, …)
 * still arrive; the run's own keys are the run's alone.
 */
export const SERVER_ENV_LOOKUPS = [".env", "../.env", "../../.env", "../../../.env"];
export function serverCwd(runDir) {
  return join(runDir, "server-cwd", "a", "b", "c");
}

/** `text` (a .env file) without the lines that set one of `ownedKeys`. */
export function serverDotEnv(text, ownedKeys) {
  const owned = new Set(ownedKeys);
  return String(text)
    .split("\n")
    .filter((line) => {
      const at = line.indexOf("=");
      return at < 0 || !owned.has(line.slice(0, at).trim());
    })
    .join("\n");
}

/** Every file a run writes, in one place so stop.sh and sample-ac.mjs agree with start.sh. */
export function harnessPaths(runDir) {
  return {
    runDir,
    envFile: join(runDir, "ports.env"),
    pidFile: join(runDir, "pids"),
    blockedFile: join(runDir, "blocked.json"),
    startStatus: join(runDir, "start-status.json"),
    docUser: join(runDir, "doc-user.json"),
    serverCwd: serverCwd(runDir),
    evidenceFile: join(runDir, "evidence.jsonl"),
    logDir: join(runDir, "logs"),
    userDataDir: join(runDir, "userdata"),
    appSettings: join(runDir, "userdata", "app-settings.json"),
  };
}

/**
 * The state start.sh recorded for a run (`start-status.json`): `starting`,
 * `up`, `failed` or `blocked`, with the reason. null when there is no such file
 * (a run from before the status existed, or one that never started).
 */
export function readStartStatus(runDir) {
  const file = harnessPaths(runDir).startStatus;
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed.state === "string" ? parsed : { state: "failed", reason: "start-status.json is not a status record" };
  } catch {
    return { state: "failed", reason: "start-status.json is unreadable" };
  }
}

/**
 * What a step after start.sh does with start.sh's own outcome. A start that
 * failed or never finished is a harness/config bug, so the step FAILs: only a
 * precondition start.sh itself recorded as missing (BLOCKED) may make a later
 * step BLOCKED. Cloud round 4 got this wrong: start.sh exited 1, the later steps
 * found no server and recorded BLOCKED, which reads as "the VM cannot do it".
 * `proceed` is also the answer for a run without a status file, so older runs
 * keep their behaviour.
 */
export function startGate(status) {
  if (!status || status.state === "up") return { gate: "proceed", reason: "" };
  const why = status.reason ? `: ${status.reason}` : "";
  if (status.state === "blocked") return { gate: "blocked", reason: `start.sh reported BLOCKED${why}` };
  if (status.state === "starting") return { gate: "fail", reason: "start.sh never finished (the run is still marked starting); the stack is not up" };
  return { gate: "fail", reason: `start.sh failed${why}; the stack is not up (see the run's logs)` };
}

/** The fork SHA start.sh wrote into a run's ports.env ("" when there is none). */
function forkShaOfRun(envFile) {
  if (!existsSync(envFile)) return "";
  return /^OFFICE_FORK_SHA=(.*)$/m.exec(readFileSync(envFile, "utf8"))?.[1]?.trim() ?? "";
}

/**
 * A step that cannot run because start.sh did not bring the stack up: prints
 * why, records the evidence line (unless the evidence runner owns the ledger)
 * and returns the exit code the step must end with, 1 for a failed start and 77
 * only for a precondition start.sh itself reported missing.
 */
export async function concludeAtStartGate(gate, { runDir, requirementId, fixtureId = "", command, checker, startedAt, argv }) {
  const blocked = gate.gate === "blocked";
  const result = blocked ? "BLOCKED" : "FAIL";
  const exitCode = blocked ? BLOCKED_EXIT : 1;
  console.error(`${blocked ? "BLOCKED" : "FAILED"}: ${gate.reason}`);
  const paths = harnessPaths(runDir);
  const record = evidenceLine({
    evidenceId: harnessEvidenceId(requirementId),
    ...(await ledgerIdentity()),
    fSha: process.env.OFFICE_FORK_SHA || forkShaOfRun(paths.envFile),
    requirementId,
    fixtureId,
    fixtureSha256: await fixtureSha256Of(fixtureId),
    platform: `${process.platform}-${process.arch}`,
    build: `node ${process.versions.node}`,
    command,
    argv,
    exitCode,
    result,
    artifact: writeStepArtifact(runDir, requirementId, command, [`${blocked ? "BLOCKED" : "FAILED"}: ${gate.reason}`]),
    checker,
    blocker: blocked ? gate.reason : "",
    startedAt,
    finishedAt: new Date().toISOString(),
  });
  if (blocked) appendFileSync(paths.blockedFile, `${JSON.stringify(record, null, 2)}\n`);
  if (!process.env.OFFICE_EVIDENCE_ID) appendFileSync(paths.evidenceFile, `${JSON.stringify(record)}\n`);
  return exitCode;
}

/**
 * The manifest hash of fixture `fixtureId` ("" when there is none or the id is
 * not in the manifest, which verify then reports for what it is). Read through
 * the runner's own manifest reader, so the hash never comes from a copy.
 */
export async function fixtureSha256Of(fixtureId) {
  if (!fixtureId) return "";
  const { readManifest } = await import("../evidence.mjs");
  try {
    return readManifest().fixtures.find((fixture) => fixture.id === fixtureId)?.sha256 ?? "";
  } catch {
    return "";
  }
}

/**
 * The artifact of a step that ended before it could produce one: a log under
 * the run's logs/ holding the command and why it stopped, so the ledger line
 * names a file that exists instead of "". Returns its absolute path.
 */
export function writeStepArtifact(runDir, requirementId, command, lines) {
  const logDir = harnessPaths(runDir).logDir;
  mkdirSync(logDir, { recursive: true });
  const file = join(logDir, `${requirementId}-step.log`);
  appendFileSync(file, `$ ${command}\n\n${lines.join("\n")}\n`);
  return file;
}

/** Where the fork is cloned for a pinned revision: one directory per SHA, reused across runs. */
export function forkCacheDir(cacheRoot, sha) {
  return join(cacheRoot, `uniwork-office-${sha}`);
}

/**
 * The variables the fork's Electron app may inherit from whoever started it: the
 * process basics, the locale, the session and display it opens on, and the
 * keyring bus its desktop session is kept in. Everything else of the harness's
 * environment is withheld, above all the server's: start.sh sources the VM's
 * `.env` (DATABASE_URL, REDIS_URL, JWT_SECRET, storage and provider keys, ...)
 * and an app that inherited it would hold every secret of the stack it is
 * only a client of (reviewer_be H1-8).
 */
export const APP_ENV_PASSTHROUGH = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  "DISPLAY",
  "XAUTHORITY",
  "WAYLAND_DISPLAY",
  "XDG_RUNTIME_DIR",
  "XDG_SESSION_TYPE",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "DBUS_SESSION_BUS_ADDRESS",
];

/**
 * The environment of the second instance that carries the deep link: the
 * allow-listed basics plus the run's own X display AND its auth file. Under
 * `xvfb-run` the display is protected by a private Xauthority; ports.env records
 * both (start.sh), and a second client that got only DISPLAY died with
 * "Authorization required ... Missing X server or $DISPLAY" (cloud round 6).
 * What the run recorded wins over the caller's own session.
 */
export function handoffEnv(ports, source = process.env) {
  return appEnv({
    source,
    apiOrigin: ports.API_ORIGIN,
    userDataDir: ports.UNIWORK_USER_DATA,
    extra: {
      UNIWORK_OFFICE_CHANNEL: "dev",
      ...(ports.DISPLAY ? { DISPLAY: ports.DISPLAY } : {}),
      ...(ports.XAUTHORITY ? { XAUTHORITY: ports.XAUTHORITY } : {}),
    },
  });
}

/** A child's end as words: `exited 1`, `was killed by SIGSEGV` (a null exit code means a signal, never "exited null"). */
export function describeExit(status, signal) {
  if (status !== null && status !== undefined) return `exited ${status}`;
  return signal ? `was killed by ${signal}` : "ended without an exit code or a signal";
}

/** Names that carry a secret or the server's own wiring; none may reach the app, whatever else changes. */
const SERVER_SECRET_NAME = /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL)|^(DATABASE|REDIS)_URL$/i;

/**
 * The whole environment of an Electron process the harness starts (the app
 * itself and the second instance that carries a deep link): the allow-listed
 * variables of `source`, then what the app needs — the D server's origin, its
 * userData dir and the few switches the fork reads — and the caller's `extra`.
 * It throws on a secret-looking name rather than passing it on.
 */
export function appEnv({ source = process.env, apiOrigin, userDataDir, extra = {} }) {
  const env = {};
  for (const key of APP_ENV_PASSTHROUGH) {
    if (source[key] !== undefined && source[key] !== "") env[key] = source[key];
  }
  Object.assign(env, {
    UNIWORK_API_ORIGIN: apiOrigin,
    GENOFFICE_USER_DATA: userDataDir,
    GENOFFICE_NO_SPARE_VIEW: "1",
    ELECTRON_DISABLE_SANDBOX: "1",
    ...extra,
  });
  for (const key of Object.keys(env)) {
    if (SERVER_SECRET_NAME.test(key)) throw new Error(`appEnv refuses ${key}: a server secret must not reach the Electron app`);
  }
  return env;
}

/**
 * The identity every ledger line carries: the D checkout's HEAD and the web
 * frame pin that is served, resolved the way the evidence runner resolves them
 * (resolveDSha / readPin). A harness-written line without them is rejected by
 * `evidence.mjs verify` ("has an empty dSha / pin", reviewer_be H1-3).
 */
export async function ledgerIdentity(env = process.env) {
  // Imported on use: start.sh runs lib.mjs on its own and never needs the runner.
  const { readPin, resolveDSha } = await import("../evidence.mjs");
  return { dSha: resolveDSha(), pin: readPin(env) };
}

/** A fresh evidence id for a line the harness writes itself (the runner owns ids under OFFICE_EVIDENCE_ID). */
export function harnessEvidenceId(requirementId) {
  return `${String(requirementId).toLowerCase()}-harness-${Date.now()}`;
}

/**
 * One evidence line in the shape the shared contract fixes
 * (scripts/office/g5g6g7/evidence.mjs). Missing fields stay empty strings rather
 * than being dropped, so the runner's field check sees them.
 */
export function evidenceLine(record) {
  // The exact argument vector of the command the line stands for. The caller
  // knows it; this function runs in whatever process writes the line, so it can
  // not guess without recording a vector that never ran (reviewer_be H1-6). An
  // empty one is an empty required field for the runner's verify (r2 N1).
  if (!Array.isArray(record.argv) || record.argv.length === 0) {
    throw new Error("evidenceLine needs the argv of the command the line stands for");
  }
  return {
    evidenceId: record.evidenceId ?? "",
    requirementId: record.requirementId ?? "",
    dSha: record.dSha ?? "",
    fSha: record.fSha ?? "",
    pin: record.pin ?? "",
    platform: record.platform ?? "",
    build: record.build ?? "",
    fixtureId: record.fixtureId ?? "",
    fixtureSha256: record.fixtureSha256 ?? "",
    command: record.command ?? "",
    // the exact argument vector, so an argument with a space survives the ledger
    argv: record.argv,
    exitCode: typeof record.exitCode === "number" ? record.exitCode : -1,
    result: record.result ?? "BLOCKED",
    artifact: record.artifact ?? "",
    checker: record.checker ?? "",
    blocker: record.blocker ?? "",
    startedAt: record.startedAt ?? "",
    finishedAt: record.finishedAt ?? "",
  };
}


/** The node flags that make an eval script the entry point instead of a file. */
const EVAL_FLAGS = new Set(["-e", "--eval", "-p", "--print"]);

/**
 * Whether this module is the entry point the process was started with, as
 * opposed to a module somebody imported. `node -e '<script>' path/lib.mjs`
 * leaves `path/lib.mjs` in `argv[1]`, which looks exactly like a direct
 * invocation, so an eval flag in `execArgv` means "not main" no matter what
 * `argv[1]` says. The r1 cloud round died because start.sh imported this file
 * from `node -e` and the guard below then ran the `--write` CLI with no
 * `--write` argument; keep the eval-flag check so that shape stays inert.
 */
export function isMainModule({ argv1 = process.argv[1], execArgv = process.execArgv, moduleUrl = import.meta.url } = {}) {
  if (!argv1) return false;
  if (execArgv.some((arg) => EVAL_FLAGS.has(arg) || arg.startsWith("--eval=") || arg.startsWith("--print="))) return false;
  try {
    return moduleUrl === pathToFileURL(argv1).href;
  } catch {
    return false;
  }
}


/**
 * Writes `text` to `file` readable by its owner only. The mode given to
 * writeFileSync is ignored for a file that already exists and masked by the
 * umask otherwise, so it is applied again after the write.
 */
function writePrivateFile(file, text) {
  writeFileSync(file, text, { mode: 0o600 });
  chmodSync(file, 0o600);
}

/**
 * Writes one run's files: `ports.env` (the ports, origins, SHAs and later the
 * display) and `server.env` (the server's environment, quoted so a URL with a
 * query still sources in bash). Called by start.sh as
 * `node lib.mjs --write <runDir>` (HARNESS_ENV_FILE names the VM's .env the
 * server's own copy is made from); kept here so the ports, the environment and
 * the test that pins them cannot drift apart.
 */
export async function writeRunEnv(runDir, { forkSha = DEFAULT_FORK_SHA, dSha = "", uploadDir, dotenvPath } = {}) {
  const [apiPort, webPort, metricsPort, previewPort] = await freePorts(4);
  const serverEnv = buildServerEnv({
    apiPort,
    webPort,
    metricsPort,
    previewPort,
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    uploadDir: uploadDir ?? join(runDir, "uploads"),
  });
  writeFileSync(
    join(runDir, "ports.env"),
    [
      "# Written by scripts/office/g5g6g7/harness/lib.mjs (start.sh) - one run's ports and origins.",
      `HARNESS_RUN_DIR=${runDir}`,
      `API_PORT=${apiPort}`,
      `WEB_PORT=${webPort}`,
      `METRICS_PORT=${metricsPort}`,
      `PREVIEW_PORT=${previewPort}`,
      `API_ORIGIN=${appOrigin(apiPort)}`,
      `WEB_ORIGIN=${appOrigin(webPort)}`,
      `OFFICE_FORK_SHA=${forkSha}`,
      `D_SHA=${dSha}`,
      "",
    ].join("\n"),
  );
  const quote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;
  writePrivateFile(
    join(runDir, "server.env"),
    `${Object.entries(serverEnv).map(([key, value]) => `${key}=${quote(value)}`).join("\n")}\n`,
  );
  // The server's own working directory and the .env it finds there (see serverCwd).
  // Both carry secrets the run does not own (the VM's database password, the
  // storage keys), so the directories are 0700 and the files 0600 (reviewer_be R2-2).
  const cwd = serverCwd(runDir);
  mkdirSync(cwd, { recursive: true, mode: 0o700 });
  // mkdir's mode is masked by the umask and ignored for a directory that exists
  for (let dir = cwd; ; dir = dirname(dir)) {
    chmodSync(dir, 0o700);
    if (dirname(dir) === runDir) break;
  }
  if (dotenvPath && existsSync(dotenvPath)) {
    writePrivateFile(join(cwd, ".env"), serverDotEnv(readFileSync(dotenvPath, "utf8"), Object.keys(serverEnv)));
  }
  return { apiPort, webPort, metricsPort, previewPort, apiOrigin: appOrigin(apiPort), webOrigin: appOrigin(webPort) };
}

// CLI: node lib.mjs --write <runDir> | node lib.mjs --fork-dir <cacheRoot> <sha>
// start.sh calls both modes directly (never through `node -e`), so a failure
// names the mode it asked for.
function usage(reason) {
  if (reason) console.error(`lib.mjs: ${reason}`);
  console.error("usage: lib.mjs --write <runDir>");
  console.error("       lib.mjs --fork-dir <cacheRoot> <sha>");
  console.error("       lib.mjs --app-env <apiOrigin> <userDataDir>");
  process.exit(2);
}

if (isMainModule()) {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === "--write") {
    const [runDir] = rest;
    if (!runDir) usage("--write needs a run dir");
    writeRunEnv(runDir, { forkSha: process.env.OFFICE_FORK_SHA, dSha: process.env.D_SHA, dotenvPath: process.env.HARNESS_ENV_FILE })
      .then((ports) => console.log(JSON.stringify(ports)))
      .catch((error) => {
        console.error(error.message);
        process.exit(1);
      });
  } else if (mode === "--app-env") {
    // NUL-delimited KEY=VALUE entries for `env -i` in start.sh
    const [apiOrigin, userDataDir] = rest;
    if (!apiOrigin || !userDataDir) usage("--app-env needs an API origin and a userData dir");
    const env = appEnv({ apiOrigin, userDataDir, extra: { UNIWORK_BRIDGE_SILENT: "1", GENOFFICE_LANG: "en" } });
    process.stdout.write(Object.entries(env).map(([key, value]) => `${key}=${value}\0`).join(""));
  } else if (mode === "--fork-dir") {
    const [cacheRoot, sha] = rest;
    if (!cacheRoot || !sha) usage("--fork-dir needs a cache root and a fork SHA");
    process.stdout.write(`${forkCacheDir(cacheRoot, sha)}\n`);
  } else {
    usage(mode ? `unknown argument ${mode}` : "no mode given");
  }
}
