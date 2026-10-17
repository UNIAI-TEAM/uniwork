import { describe, expect, it, vi } from "vitest";
import {
  expectBoolean,
  expectCount,
  expectString,
  expectUrl,
  guard,
  IpcRejected,
  isTrustedSender,
  MAX_IPC_BYTES,
  type IpcSender,
} from "./schema";

const APP = "https://app.uniworkos.com";
const trusted: IpcSender = { senderFrame: { url: `${APP}/acme/chat` } };

describe("isTrustedSender", () => {
  it("accepts only a frame whose URL has the app origin", () => {
    expect(isTrustedSender(trusted, APP)).toBe(true);
    expect(isTrustedSender({ senderFrame: { url: "https://evil.example/" } }, APP)).toBe(false);
    expect(isTrustedSender({ senderFrame: { url: "https://app.uniworkos.com:444/" } }, APP)).toBe(false);
    expect(isTrustedSender({ senderFrame: { url: "about:blank" } }, APP)).toBe(false);
    expect(isTrustedSender({ senderFrame: { url: "" } }, APP)).toBe(false);
  });

  it("rejects a destroyed frame", () => {
    expect(isTrustedSender({ senderFrame: null }, APP)).toBe(false);
  });
});

describe("validators", () => {
  it("expectString accepts a string up to the cap and rejects the rest", () => {
    expect(expectString("abc")).toBe("abc");
    expect(expectString("")).toBe("");
    expect(expectString("a".repeat(MAX_IPC_BYTES))).toHaveLength(MAX_IPC_BYTES);
    expect(() => expectString("a".repeat(MAX_IPC_BYTES + 1))).toThrow(IpcRejected);
    // The cap is in bytes, not code units.
    expect(() => expectString("é".repeat(MAX_IPC_BYTES / 2 + 1))).toThrow(IpcRejected);
    expect(() => expectString("abcd", 3)).toThrow(IpcRejected);
    expect(() => expectString(42)).toThrow(IpcRejected);
    expect(() => expectString(undefined)).toThrow(IpcRejected);
    expect(() => expectString({ toString: () => "x" })).toThrow(IpcRejected);
  });

  it("expectUrl accepts an absolute URL string only", () => {
    expect(expectUrl("https://uniworkos.com/x")).toBe("https://uniworkos.com/x");
    expect(() => expectUrl("/relative")).toThrow(IpcRejected);
    expect(() => expectUrl("not a url")).toThrow(IpcRejected);
    expect(() => expectUrl(null)).toThrow(IpcRejected);
    expect(() => expectUrl(`https://x.example/${"a".repeat(MAX_IPC_BYTES)}`)).toThrow(IpcRejected);
  });

  it("expectCount accepts a non-negative safe integer", () => {
    expect(expectCount(0)).toBe(0);
    expect(expectCount(12)).toBe(12);
    for (const bad of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "3", null]) {
      expect(() => expectCount(bad)).toThrow(IpcRejected);
    }
  });

  it("expectBoolean accepts true and false only", () => {
    expect(expectBoolean(true)).toBe(true);
    expect(expectBoolean(false)).toBe(false);
    expect(() => expectBoolean("true")).toThrow(IpcRejected);
    expect(() => expectBoolean(1)).toThrow(IpcRejected);
  });

  it("IpcRejected names the reason without echoing the payload", () => {
    const err = new IpcRejected("not_string");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("IpcRejected");
    expect(err.message).toBe("ipc rejected: not_string");
    expect(err.reason).toBe("not_string");
  });
});

describe("guard", () => {
  it("validates then calls the handler with the typed payload and the event", async () => {
    const handler = vi.fn().mockResolvedValue("ok");
    const listener = guard(APP, expectString, handler);
    await expect(listener(trusted, "hello")).resolves.toBe("ok");
    expect(handler).toHaveBeenCalledWith("hello", trusted);
  });

  it("passes a synchronous handler result through", async () => {
    const listener = guard(APP, expectCount, (n) => n * 2);
    await expect(listener(trusted, 4)).resolves.toBe(8);
  });

  it("refuses a frame from another origin without calling the handler", async () => {
    const handler = vi.fn();
    const listener = guard(APP, expectString, handler);
    await expect(listener({ senderFrame: { url: "https://evil.example/" } }, "x")).rejects.toThrow(IpcRejected);
    await expect(listener({ senderFrame: null }, "x")).rejects.toThrow(/untrusted_sender/);
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses an oversized or malformed payload without calling the handler", async () => {
    const handler = vi.fn();
    const listener = guard(APP, expectString, handler);
    await expect(listener(trusted, "a".repeat(MAX_IPC_BYTES + 1))).rejects.toThrow(/too_large/);
    await expect(listener(trusted, 7)).rejects.toThrow(/not_string/);
    expect(handler).not.toHaveBeenCalled();
  });
});
