/* global process, Buffer */
// Pure helpers for the G7-01 app harness (UNI-1376): fresh port picking and the
// environment a run is started with. Nothing here touches the network beyond
// binding a throwaway listener to port 0, so the node --test file can pin the
// behaviour without starting the stack.
import net from "node:net";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
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
  deploymentId = "harness",
  verificationCode = "123456",
}) {
  const apiOrigin = origin(apiPort);
  const webOrigin = origin(webPort);
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
    NEXT_PUBLIC_WS_URL: `ws://127.0.0.1:${apiPort}`,
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

/** Every file a run writes, in one place so stop.sh and sample-ac.mjs agree with start.sh. */
export function harnessPaths(runDir) {
  return {
    runDir,
    envFile: join(runDir, "ports.env"),
    pidFile: join(runDir, "pids"),
    blockedFile: join(runDir, "BLOCKED"),
    evidenceFile: join(runDir, "evidence.jsonl"),
    logDir: join(runDir, "logs"),
    userDataDir: join(runDir, "userdata"),
    appSettings: join(runDir, "userdata", "app-settings.json"),
  };
}

/** Where the fork is cloned for a pinned revision: one directory per SHA, reused across runs. */
export function forkCacheDir(cacheRoot, sha) {
  return join(cacheRoot, `uniwork-office-${sha}`);
}

/**
 * One evidence line in the shape the shared contract fixes
 * (scripts/office/g5g6g7/evidence.mjs). Missing fields stay empty strings rather
 * than being dropped, so the runner's field check sees them.
 */
export function evidenceLine(record) {
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
    exitCode: typeof record.exitCode === "number" ? record.exitCode : -1,
    result: record.result ?? "BLOCKED",
    artifact: record.artifact ?? "",
    checker: record.checker ?? "",
    blocker: record.blocker ?? "",
    startedAt: record.startedAt ?? "",
    finishedAt: record.finishedAt ?? "",
  };
}


/**
 * Writes one run's files: `ports.env` (the ports, origins, SHAs and later the
 * display) and `server.env` (the server's environment, quoted so a URL with a
 * query still sources in bash). Called by start.sh as
 * `node lib.mjs --write <runDir>`; kept here so the ports, the environment and
 * the test that pins them cannot drift apart.
 */
export async function writeRunEnv(runDir, { forkSha = DEFAULT_FORK_SHA, dSha = "", uploadDir } = {}) {
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
      `API_ORIGIN=${origin(apiPort)}`,
      `WEB_ORIGIN=${origin(webPort)}`,
      `OFFICE_FORK_SHA=${forkSha}`,
      `D_SHA=${dSha}`,
      "",
    ].join("\n"),
  );
  const quote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;
  writeFileSync(
    join(runDir, "server.env"),
    `${Object.entries(serverEnv).map(([key, value]) => `${key}=${quote(value)}`).join("\n")}\n`,
  );
  return { apiPort, webPort, metricsPort, previewPort, apiOrigin: origin(apiPort), webOrigin: origin(webPort) };
}

// CLI: node lib.mjs --write <runDir>
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const writeIndex = process.argv.indexOf("--write");
  if (writeIndex === -1 || !process.argv[writeIndex + 1]) {
    console.error("usage: lib.mjs --write <runDir>");
    process.exit(2);
  }
  writeRunEnv(process.argv[writeIndex + 1], { forkSha: process.env.OFFICE_FORK_SHA, dSha: process.env.D_SHA })
    .then((ports) => console.log(JSON.stringify(ports)))
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
