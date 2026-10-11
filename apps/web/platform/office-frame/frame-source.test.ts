import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { materialize, loadBundle } from "./frame-install.mjs";
import { parseSource, readSource, resolveSource, SOURCE_PATH } from "./frame-source.mjs";
import { writeBundle } from "./frame-fixture";

const good = { schema: 1, url: "https://github.com/UNIAI-TEAM/uniwork-office/releases/download/web-0.1.0-abc1234/dist-web-0.1.0-abc1234.tar.gz", sha256: "a".repeat(64) };
const scratch = () => mkdtempSync(join(tmpdir(), "frame-source-"));

describe("parseSource", () => {
  it("accepts an https .tar.gz url with a 64-digit sha256", () => {
    expect(parseSource(good)).toEqual({ url: good.url, sha256: good.sha256 });
  });
  it("refuses anything else, so a bad edit fails the build instead of installing unverified bytes", () => {
    expect(() => parseSource(null)).toThrow(/not an object/);
    expect(() => parseSource({ ...good, schema: 2 })).toThrow(/schema/);
    expect(() => parseSource({ ...good, url: "http://x/dist-web.tar.gz" })).toThrow(/https/);
    expect(() => parseSource({ ...good, url: "https://x/dist-web.zip" })).toThrow(/\.tar\.gz/);
    expect(() => parseSource({ ...good, sha256: "ABC" })).toThrow(/sha256/);
    expect(() => parseSource({ schema: 1, url: good.url })).toThrow(/sha256/);
  });
});

describe("readSource", () => {
  it("returns null for a missing file and parses the committed one", () => {
    expect(readSource(join(scratch(), "nope.json"))).toBeNull();
    expect(readSource(SOURCE_PATH)).toMatchObject({ url: expect.stringMatching(/^https:\/\//), sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });
});

describe("resolveSource", () => {
  const committed = { url: good.url, sha256: good.sha256 };
  it("uses the committed source, with its sha256, when there is no override", () => {
    expect(resolveSource(undefined, committed)).toEqual({ source: good.url, sha256: good.sha256, committed: true });
    expect(resolveSource("", committed)).toEqual({ source: good.url, sha256: good.sha256, committed: true });
  });
  it("lets an explicit override win, without the committed sha256", () => {
    expect(resolveSource("/srv/dist-web", committed)).toEqual({ source: "/srv/dist-web", committed: false });
  });
  it("is null with no override and no committed source", () => {
    expect(resolveSource(undefined, null)).toBeNull();
  });
});

describe("materialize with an expected sha256", () => {
  const pack = () => {
    const archive = join(scratch(), "bundle.tar.gz");
    execFileSync("tar", ["-czf", archive, "-C", writeBundle(), "."]);
    return archive;
  };
  const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
  it("unpacks an archive that hashes to it", async () => {
    const archive = pack();
    const out = await materialize(archive, scratch(), undefined, sha(archive));
    expect(loadBundle(out).manifest.version).toBe("0.1.0-abc1234");
  });
  it("refuses an archive that does not, before unpacking it", async () => {
    const archive = pack();
    const out = scratch();
    await expect(materialize(archive, out, undefined, "0".repeat(64))).rejects.toThrow(/sha256 differs from the committed source/);
    expect(existsSync(join(out, "unpacked"))).toBe(false);
  });
});
