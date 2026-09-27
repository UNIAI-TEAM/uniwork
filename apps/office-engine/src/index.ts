// apps/office-engine - the private UniWork Office engine service (G2-02).
//
// createEngineService wires the pieces: the job manager (bounded pool and
// queue, per-job limits, process-tree ownership), the HTTP surface Go calls,
// and the startup sweep of temp dirs a crashed predecessor left behind. The
// service is ready only after one worker process has started and answered, so
// a broken worker entry shows up in /readyz instead of on the first job.

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { sweepStaleJobDirs, createJobDir, removeJobDir } from "./cleanup.ts";
import type { EngineServiceConfig } from "./config.ts";
import { JobManager } from "./jobs.ts";
import { resolveLimits } from "./limits.ts";
import { Metrics } from "./metrics.ts";
import { createHttpServer } from "./server.ts";
import { Supervisor } from "./supervisor.ts";
import type { ServiceGrant } from "./grants.ts";

export { loadConfig, ConfigError, PROVISIONAL_LIMITS, type EngineServiceConfig, type JobLimits } from "./config.ts";
export { signGrant, GRANT_TAG, type ServiceGrant, type GrantOutput, type GrantInput } from "./grants.ts";

export interface EngineService {
  readonly server: Server;
  readonly jobs: JobManager;
  listen(): Promise<number>;
  close(): Promise<void>;
  ready(): boolean;
}

const SELF_TEST_GRANT = { deadline_at: Number.MAX_SAFE_INTEGER, output: null } as unknown as ServiceGrant;

/** Start one worker with an operation no handler binds: an
 * unsupported_operation answer proves the process, the handler thread and the
 * IPC channel all work. */
async function selfTest(config: EngineServiceConfig): Promise<boolean> {
  const dir = await createJobDir(config.tempRoot);
  try {
    const result = await new Supervisor().run({
      entry: config.workerEntry,
      operation: "self-test",
      format: "none",
      inputPath: null,
      outputPath: dir + "/self-test.out",
      tempDir: dir,
      limits: resolveLimits({ ...config.limits, maxJobMs: Math.min(config.limits.maxJobMs, 30_000) }, SELF_TEST_GRANT, null, Date.now()),
      sampleMs: config.sampleMs,
      faults: false,
      signal: new AbortController().signal,
    });
    return result.kind === "fail" && result.code === "unsupported_operation";
  } finally {
    await removeJobDir(dir);
  }
}

export function createEngineService(config: EngineServiceConfig): EngineService {
  const metrics = new Metrics();
  const jobs = new JobManager(config, metrics);
  let isReady = false;
  const server = createHttpServer({ config, jobs, metrics, isReady: () => isReady });
  return {
    server,
    jobs,
    ready: () => isReady,
    async listen() {
      await sweepStaleJobDirs(config.tempRoot);
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, () => resolve());
      });
      isReady = await selfTest(config).catch(() => false);
      return (server.address() as AddressInfo).port;
    },
    async close() {
      isReady = false;
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      await jobs.shutdown(config.shutdownGraceMs);
      server.closeIdleConnections();
      const force = setTimeout(() => server.closeAllConnections(), config.shutdownGraceMs);
      force.unref();
      await closed;
      clearTimeout(force);
      await sweepStaleJobDirs(config.tempRoot);
    },
  };
}
