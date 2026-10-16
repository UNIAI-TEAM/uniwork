import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, PROVISIONAL_LIMITS } from "./config.ts";
import { GrantLedger, type ServiceGrant } from "./grants.ts";
import { resolveLimits } from "./limits.ts";

const defaults = { tempRoot: "/tmp/x", workerEntry: "/w.mjs" };
const base = {
  OFFICE_ENGINE_SERVICE_TOKEN: "s".repeat(32),
  OFFICE_ENGINE_GRANT_KEY: "g".repeat(32),
};

describe("loadConfig", () => {
  it("refuses to start without both secrets, or with one secret used twice", () => {
    expect(() => loadConfig({}, defaults)).toThrow(ConfigError);
    expect(() => loadConfig({ OFFICE_ENGINE_SERVICE_TOKEN: "s".repeat(32) }, defaults)).toThrow(/GRANT_KEY/);
    expect(() => loadConfig({ ...base, OFFICE_ENGINE_GRANT_KEY: "short" }, defaults)).toThrow(/32/);
    expect(() => loadConfig({ ...base, OFFICE_ENGINE_GRANT_KEY: base.OFFICE_ENGINE_SERVICE_TOKEN }, defaults)).toThrow(/differ/);
  });

  it("uses finite provisional limits and fault operations off by default", () => {
    const config = loadConfig(base, defaults);
    expect(config.limits).toEqual(PROVISIONAL_LIMITS);
    expect(config.faultOperations).toBe(false);
    expect(config.outputOrigins).toEqual([]);
    expect(config.maxWorkers).toBeGreaterThan(0);
    expect(Number.isFinite(config.limits.maxJobMs)).toBe(true);
  });

  it("parses limits and rejects values outside their bounds", () => {
    const config = loadConfig({ ...base, OFFICE_ENGINE_MAX_WORKERS: "3", OFFICE_ENGINE_MEMORY_MB: "256", OFFICE_ENGINE_OUTPUT_ORIGINS: "http://minio:9000, https://s3.example.com" }, defaults);
    expect(config.maxWorkers).toBe(3);
    expect(config.limits.memoryBytes).toBe(256 * 1024 * 1024);
    expect(config.outputOrigins).toEqual(["http://minio:9000", "https://s3.example.com"]);
    expect(() => loadConfig({ ...base, OFFICE_ENGINE_MAX_JOB_MS: "0" }, defaults)).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, OFFICE_ENGINE_MAX_JOB_MS: "600001" }, defaults)).toThrow(/at most/);
    expect(() => loadConfig({ ...base, OFFICE_ENGINE_MAX_WORKERS: "two" }, defaults)).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, OFFICE_ENGINE_OUTPUT_ORIGINS: "http://minio:9000/bucket" }, defaults)).toThrow(/bare/);
    expect(() => loadConfig({ ...base, OFFICE_ENGINE_OUTPUT_ORIGINS: "not a url" }, defaults)).toThrow(/not a URL/);
    expect(() => loadConfig({ ...base, OFFICE_ENGINE_OUTPUT_ORIGINS: "file://x" }, defaults)).toThrow(ConfigError);
  });

  it("defaults the byte bounds to the 200 MiB document cap with temp sized for input + output on disk", () => {
    // SIZE-S1 (UNI-1859): the engine must not refuse a document the server
    // accepts. 200 MiB is the DOCUMENT_MAX_BYTES default; temp holds the
    // job's input and output files at once plus headroom (2 x cap + 64 MiB
    // rounds to 512 MiB).
    const config = loadConfig(base, defaults);
    expect(config.limits.maxInputBytes).toBe(200 * 1024 * 1024);
    expect(config.limits.maxOutputBytes).toBe(200 * 1024 * 1024);
    expect(config.limits.tempBytes).toBe(512 * 1024 * 1024);
    expect(config.limits.memoryBytes).toBe(512 * 1024 * 1024);
  });

  it("lets DOCUMENT_MAX_BYTES drive the caps so one value matches the server", () => {
    const config = loadConfig({ ...base, DOCUMENT_MAX_BYTES: String(250 * 1024 * 1024) }, defaults);
    expect(config.limits.maxInputBytes).toBe(250 * 1024 * 1024);
    expect(config.limits.maxOutputBytes).toBe(250 * 1024 * 1024);
    // in + out + 64 MiB headroom: 250 + 250 + 64 = 564 MiB, above the floor.
    expect(config.limits.tempBytes).toBe(564 * 1024 * 1024);
    // A small cap keeps the 512 MiB default temp budget.
    expect(loadConfig({ ...base, DOCUMENT_MAX_BYTES: String(1 * 1024 * 1024) }, defaults).limits.tempBytes).toBe(512 * 1024 * 1024);
    // The engine-specific names stay the overrides when both are set.
    const overridden = loadConfig(
      { ...base, DOCUMENT_MAX_BYTES: String(250 * 1024 * 1024), OFFICE_ENGINE_MAX_INPUT_BYTES: String(100 * 1024 * 1024), OFFICE_ENGINE_MAX_OUTPUT_BYTES: String(120 * 1024 * 1024) },
      defaults,
    );
    expect(overridden.limits.maxInputBytes).toBe(100 * 1024 * 1024);
    expect(overridden.limits.maxOutputBytes).toBe(120 * 1024 * 1024);
    // Temp unset -> provisional 512 MiB (floor 100 + 120 + 64 = 284 is lower).
    expect(overridden.limits.tempBytes).toBe(512 * 1024 * 1024);
    // Temp set at exactly the floor passes; one MiB under it refuses to boot.
    expect(
      loadConfig({ ...base, OFFICE_ENGINE_MAX_INPUT_BYTES: "104857600", OFFICE_ENGINE_MAX_OUTPUT_BYTES: "125829120", OFFICE_ENGINE_TEMP_MB: "284" }, defaults).limits.tempBytes,
    ).toBe(284 * 1024 * 1024);
    expect(() => loadConfig({ ...base, OFFICE_ENGINE_MAX_INPUT_BYTES: "104857600", OFFICE_ENGINE_MAX_OUTPUT_BYTES: "125829120", OFFICE_ENGINE_TEMP_MB: "283" }, defaults)).toThrow(/at least 284/);
  });

  it("refuses a shared DOCUMENT_MAX_BYTES under the server's 1 MiB minimum", () => {
    // R2-3 (SIZE-S1): the server refuses DOCUMENT_MAX_BYTES outside
    // [1 MiB, 2 GiB] (config.go MinDocumentMaxBytes); an engine that booted on
    // a smaller shared cap would disagree with the very server driving it.
    expect(() => loadConfig({ ...base, DOCUMENT_MAX_BYTES: "1048575" }, defaults)).toThrow(/DOCUMENT_MAX_BYTES.*1 MiB/);
    expect(() => loadConfig({ ...base, DOCUMENT_MAX_BYTES: "0" }, defaults)).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, DOCUMENT_MAX_BYTES: "abc" }, defaults)).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, DOCUMENT_MAX_BYTES: String(3 * 1024 * 1024 * 1024) }, defaults)).toThrow(/at most/);
    // The minimum itself is legal — the server's own floor.
    expect(loadConfig({ ...base, DOCUMENT_MAX_BYTES: "1048576" }, defaults).limits.maxInputBytes).toBe(1048576);
    // The floor binds only the shared fallback: with BOTH engine-specific
    // names set the shared value is never consulted, so it may not trip us.
    expect(
      loadConfig(
        { ...base, DOCUMENT_MAX_BYTES: "1", OFFICE_ENGINE_MAX_INPUT_BYTES: "4096", OFFICE_ENGINE_MAX_OUTPUT_BYTES: "4096" },
        defaults,
      ).limits.maxInputBytes,
    ).toBe(4096);
  });

  it("clamps the shared input cap to the engine transport ceiling but refuses an explicit override past it", () => {
    // size-cap:005 (UNI-1859): the JSON transport can't carry a base64 input
    // above 401604608 bytes, so the shared DOCUMENT_MAX_BYTES is clamped for
    // input only — output keeps the server's byte-for-byte cap.
    const clamped = loadConfig({ ...base, DOCUMENT_MAX_BYTES: "536870912" }, defaults);
    expect(clamped.limits.maxInputBytes).toBe(401604608);
    expect(clamped.limits.maxOutputBytes).toBe(536870912);
    // The temp floor is computed from the clamped input: 383 MiB + 512 MiB + 64 MiB.
    expect(clamped.limits.tempBytes).toBe(959 * 1024 * 1024);
    expect(() => loadConfig({ ...base, OFFICE_ENGINE_MAX_INPUT_BYTES: "401604609" }, defaults)).toThrow(/OFFICE_ENGINE_MAX_INPUT_BYTES.*401604608/);
    expect(loadConfig({ ...base, OFFICE_ENGINE_MAX_INPUT_BYTES: "401604608" }, defaults).limits.maxInputBytes).toBe(401604608);
    // A shared cap under the ceiling is untouched.
    expect(loadConfig({ ...base, DOCUMENT_MAX_BYTES: "209715200" }, defaults).limits.maxInputBytes).toBe(209715200);
  });

  it("rejects a temp budget that cannot hold one job's input and output, and bad byte values", () => {
    // 256 MiB temp under the 200 MiB default caps (400 MiB of files + headroom)
    // would make every large job fail temp_limit: refuse at start, not mid-job.
    expect(() => loadConfig({ ...base, OFFICE_ENGINE_TEMP_MB: "256" }, defaults)).toThrow(ConfigError);
    const smallCaps = {
      OFFICE_ENGINE_MAX_INPUT_BYTES: String(50 * 1024 * 1024),
      OFFICE_ENGINE_MAX_OUTPUT_BYTES: String(50 * 1024 * 1024),
    };
    // 50 + 50 + 64 = 164 MiB exactly fits.
    expect(loadConfig({ ...base, ...smallCaps, OFFICE_ENGINE_TEMP_MB: "164" }, defaults).limits.tempBytes).toBe(164 * 1024 * 1024);
    expect(() => loadConfig({ ...base, ...smallCaps, OFFICE_ENGINE_TEMP_MB: "163" }, defaults)).toThrow(/at least/);
    expect(() => loadConfig({ ...base, OFFICE_ENGINE_MAX_INPUT_BYTES: "abc" }, defaults)).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, DOCUMENT_MAX_BYTES: "-1" }, defaults)).toThrow(ConfigError);
    // The shared contract ceiling keeps a configured value inside the 2 GiB
    // bound DOCUMENT_MAX_BYTES itself may take on the server.
    expect(() => loadConfig({ ...base, OFFICE_ENGINE_MAX_INPUT_BYTES: String(3 * 1024 * 1024 * 1024) }, defaults)).toThrow(/at most/);
  });

  it("parses the worker sandbox config and refuses privileged or overflowing uid pools", () => {
    const config = loadConfig(base, defaults);
    expect(config.sandbox).toMatchObject({ mode: "auto" });
    expect(config.sandbox.uidBase).toBeGreaterThanOrEqual(1000);
    expect(config.sandbox.uidBase).toBe(config.sandbox.gidBase);
    expect(
      loadConfig({ ...base, OFFICE_ENGINE_SANDBOX: "required", OFFICE_ENGINE_WORKER_UID_BASE: "61000" }, defaults).sandbox,
    ).toMatchObject({ mode: "required", uidBase: 61000, gidBase: 61000 });
    for (const env of [
      { OFFICE_ENGINE_SANDBOX: "maybe" },
      { OFFICE_ENGINE_WORKER_UID_BASE: "42" },
      { OFFICE_ENGINE_WORKER_UID_BASE: "70000" },
      { OFFICE_ENGINE_WORKER_GID_BASE: "0" },
    ]) {
      expect(() => loadConfig({ ...base, ...env }, defaults), JSON.stringify(env)).toThrow(ConfigError);
    }
  });
});

describe("resolveLimits", () => {
  const grant = { deadline_at: 10_000, output: { max_bytes: 100 } } as unknown as ServiceGrant;
  it("takes the tightest deadline and output bound, never one the request raises", () => {
    const limits = resolveLimits(PROVISIONAL_LIMITS, grant, 999_999, 0);
    expect(limits.deadlineAt).toBe(10_000);
    expect(limits.maxOutputBytes).toBe(100);
    expect(resolveLimits(PROVISIONAL_LIMITS, { ...grant, deadline_at: 10_000_000 }, null, 0).deadlineAt).toBe(PROVISIONAL_LIMITS.maxJobMs);
    expect(resolveLimits(PROVISIONAL_LIMITS, { ...grant, deadline_at: 10_000_000 }, 500, 0).deadlineAt).toBe(500);
  });
});

describe("GrantLedger", () => {
  it("remembers a grant until it could no longer start a job, and is bounded", () => {
    const ledger = new GrantLedger(2);
    const g = (id: string, until: number) => ({ grant_id: id, job_id: "j" + id, expires_at: until, deadline_at: until }) as ServiceGrant;
    ledger.consume(g("a", 100), "fa", 0);
    ledger.consume(g("b", 200), "fb", 0);
    expect(ledger.lookup("a")?.fingerprint).toBe("fa");
    expect(() => ledger.consume(g("c", 300), "fc", 50)).toThrow(/engine_overloaded/);
    ledger.consume(g("c", 300), "fc", 150);
    expect(ledger.lookup("a")).toBeUndefined();
    expect(ledger.size).toBe(2);
  });
});
