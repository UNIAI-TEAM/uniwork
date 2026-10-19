import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
}));

import { shell, type BrowserWindow } from "electron";
import { downloadURLSafely, isSafeExternalUrl, openExternalSafely } from "./external-url";

const PROD = { allowHttpLoopback: false };
const DEV = { allowHttpLoopback: true };

describe("isSafeExternalUrl", () => {
  it("allows https URLs", () => {
    expect(isSafeExternalUrl("https://uniworkos.com", PROD)).toBe(true);
    expect(isSafeExternalUrl("https://user:pass@example.com", PROD)).toBe(true);
    // The WHATWG parser lowercases the scheme, so casing cannot bypass the check.
    expect(isSafeExternalUrl("HTTPS://example.com", PROD)).toBe(true);
  });

  it("rejects plain http unless it is loopback in dev", () => {
    expect(isSafeExternalUrl("http://example.com", PROD)).toBe(false);
    expect(isSafeExternalUrl("http://example.com", DEV)).toBe(false);
    expect(isSafeExternalUrl("http://localhost:3000/auth", PROD)).toBe(false);
    expect(isSafeExternalUrl("http://localhost:3000/auth", DEV)).toBe(true);
    expect(isSafeExternalUrl("http://127.0.0.1:8080/x", DEV)).toBe(true);
    expect(isSafeExternalUrl("http://[::1]:8080/x", DEV)).toBe(true);
    // A lookalike host is not loopback.
    expect(isSafeExternalUrl("http://localhost.evil.example/", DEV)).toBe(false);
  });

  it("rejects dangerous pseudo-schemes and local handlers", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "FILE:///etc/passwd",
      "ftp://example.com/x",
      "smb://share/x",
      "vscode://file/test",
      "ms-msdt:/id%20PCWDiagnostic",
      "mailto:test@example.com",
      "tel:+15551234567",
    ]) {
      expect(isSafeExternalUrl(url, DEV)).toBe(false);
    }
  });

  it("rejects empty, whitespace and malformed input", () => {
    expect(isSafeExternalUrl("", DEV)).toBe(false);
    expect(isSafeExternalUrl(" ", DEV)).toBe(false);
    expect(isSafeExternalUrl("not a url", DEV)).toBe(false);
    expect(isSafeExternalUrl("https://", DEV)).toBe(false);
  });
});

describe("openExternalSafely", () => {
  beforeEach(() => {
    vi.mocked(shell.openExternal).mockClear();
    vi.spyOn(console, "warn").mockImplementation(() => {}).mockClear();
  });

  it("forwards an https URL to shell.openExternal", async () => {
    await openExternalSafely("https://uniworkos.com/docs", PROD);
    expect(shell.openExternal).toHaveBeenCalledWith("https://uniworkos.com/docs");
  });

  it("does not call shell.openExternal for rejected URLs and logs only the origin", async () => {
    await openExternalSafely("file:///etc/passwd", DEV);
    await openExternalSafely("javascript:alert(1)", DEV);
    await openExternalSafely("http://example.com/secret", DEV);
    await openExternalSafely("not a url", DEV);
    expect(shell.openExternal).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(4);
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining("secret"));
  });
});

describe("downloadURLSafely", () => {
  const downloadURL = vi.fn();
  const win = { webContents: { downloadURL } } as unknown as BrowserWindow;

  beforeEach(() => {
    downloadURL.mockClear();
    vi.spyOn(console, "warn").mockImplementation(() => {}).mockClear();
  });

  it("forwards an allowed URL to webContents.downloadURL", () => {
    downloadURLSafely(win, "https://files.uniworkos.com/a.pdf", PROD);
    downloadURLSafely(win, "http://localhost:3000/a.pdf", DEV);
    expect(downloadURL).toHaveBeenCalledTimes(2);
    expect(downloadURL).toHaveBeenLastCalledWith("http://localhost:3000/a.pdf");
  });

  it("drops a rejected URL without touching the window", () => {
    downloadURLSafely(win, "file:///etc/passwd", DEV);
    downloadURLSafely(win, "http://localhost:3000/a.pdf", PROD);
    expect(downloadURL).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(2);
  });
});
