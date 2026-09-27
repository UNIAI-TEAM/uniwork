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
