import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { parseWithFallback, setSchemaLogger } from "./schema";

/**
 * `parseWithFallback` is the boundary defence that turns "the API contract
 * drifted" from a white-screen incident into a degraded-but-rendering page.
 * The usf suite that shipped with this file tested that repo's endpoints
 * rather than the guard itself, so it stayed behind; this covers the guard.
 */
afterEach(() => setSchemaLogger({ warn: () => {}, error: () => {} }));

const User = z.object({ id: z.string(), name: z.string() });

describe("parseWithFallback", () => {
  it("returns the parsed value when the response matches", () => {
    const out = parseWithFallback(
      { id: "1", name: "Quang" },
      User,
      { id: "", name: "" },
      { endpoint: "GET /me" },
    );
    expect(out).toEqual({ id: "1", name: "Quang" });
  });

  it("returns the fallback instead of throwing when the response drifts", () => {
    // The whole point: a malformed payload must not reach the render path as
    // an exception. Callers keep rendering with the fallback.
    const fallback = { id: "", name: "" };
    const out = parseWithFallback(
      { id: 42 },
      User,
      fallback,
      { endpoint: "GET /me" },
    );
    expect(out).toBe(fallback);
  });

  it("reports the endpoint and the zod issues so drift is greppable", () => {
    const warn = vi.fn();
    setSchemaLogger({ warn, error: () => {} });
    parseWithFallback({}, User, { id: "", name: "" }, { endpoint: "GET /me" });
    expect(warn).toHaveBeenCalledTimes(1);
    const [message, context] = warn.mock.calls[0] as [
      string,
      { endpoint: string; issues: unknown[] },
    ];
    expect(message).toContain("GET /me");
    expect(context.endpoint).toBe("GET /me");
    expect(context.issues.length).toBeGreaterThan(0);
  });

  it("stays silent on success", () => {
    const warn = vi.fn();
    setSchemaLogger({ warn, error: () => {} });
    parseWithFallback(
      { id: "1", name: "Quang" },
      User,
      { id: "", name: "" },
      { endpoint: "GET /me" },
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("lets a lenient schema pass a value wider than the strict type", () => {
    // Schemas are intentionally lenient — string enums stay z.string() so an
    // unknown enum value still parses. Downstream switches carry a default.
    const Status = z.object({ status: z.string() });
    const out = parseWithFallback<{ status: "open" | "done" }>(
      { status: "archived" },
      Status,
      { status: "open" },
      { endpoint: "GET /task" },
    );
    expect(out.status).toBe("archived");
  });
});
