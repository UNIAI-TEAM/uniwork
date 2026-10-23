#!/usr/bin/env node
// The fake capture dir of the G7-06 job tests (contract section 3, "contract
// first"): tiny deterministic 64x48 PNGs plus the rendered-text files and one
// meta.json per host, in the same layout the real capture provider writes
// (<captures>/<host>/<fixture>.{png,txt}, <captures>/<host>/meta.json).
//
// It doubles as the generator of the checked-in fixture dir: run it with the
// target directory as its single argument. Every byte is a pure function of
// the host and fixture id, so a regenerated dir equals the committed one and
// tests can mutate a copy without ever touching the checkout.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { HOSTS, fixtureIds, loadPngjs } from "../job-lib.mjs";

export const FAKE_WIDTH = 64;
export const FAKE_HEIGHT = 48;
/** The region a fake "caret" sits in; the tests' mask points at it. */
export const FAKE_CARET = Object.freeze({ x: 4, y: 4, w: 8, h: 8, reason: "fake caret" });
/** The build the fake captures come from; tests pass it as the job's identity. */
export const FAKE_CAPTURE = Object.freeze({ forkSha: "cb76dde5", pinVersion: "0.1.0-cb76dde" });

/**
 * An RGBA PNG of 64x48: a per-fixture background, a white border and a 2px
 * diagonal. Deterministic: same inputs, same bytes.
 * @param {{ seed?: number, width?: number, height?: number }} [options]
 */
export function fakePngBuffer({ seed = 0, width = FAKE_WIDTH, height = FAKE_HEIGHT } = {}) {
  const { PNG } = loadPngjs();
  const png = new PNG({ width, height });
  const background = [(20 + seed * 17) % 200, (60 + seed * 23) % 200, (90 + seed * 31) % 200, 255];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const border = x < 2 || y < 2 || x >= width - 2 || y >= height - 2;
      const diagonal = Math.abs(x - y) < 2;
      const pixel = border ? [255, 255, 255, 255] : diagonal ? [10, 10, 10, 255] : background;
      png.data.set(pixel, at);
    }
  }
  return PNG.sync.write(png);
}

/** Clean, brand-free Vietnamese text long enough to pass the brand check. */
export function fakeText(host, fixture) {
  return [
    `Báo cáo doanh thu — ${fixture} (${host})`,
    "Bảng tổng hợp theo khu vực: Bắc, Trung, Nam.",
    "Số liệu tổng hợp từ sổ làm việc của kỳ này.",
    "Working notes for the teams reviewing the quarter.",
    "",
  ].join("\n");
}

/**
 * Write the whole fake capture dir (both hosts by default).
 * @param {string} dir
 * @param {{ hosts?: string[], fixtures?: string[], forkSha?: string, pinVersion?: string, statuses?: Record<string, "ok" | "blocked" | "failed"> }} [options]
 */
export function writeFakeCaptures(dir, { hosts = HOSTS, fixtures = fixtureIds(), forkSha = FAKE_CAPTURE.forkSha, pinVersion = FAKE_CAPTURE.pinVersion, statuses = {} } = {}) {
  for (const host of hosts) {
    mkdirSync(join(dir, host), { recursive: true });
    const entries = {};
    for (const [index, fixture] of fixtures.entries()) {
      const status = statuses[`${host}/${fixture}`] ?? "ok";
      // the web capture records the frame AI grant it saw (RFE5-202); the desktop records none
      entries[fixture] = { status, reason: status === "ok" ? "" : "fake capture provider said so", ...(host === "web" && status === "ok" ? { ai: true, uniworkAi: false } : {}) };
      writeFileSync(join(dir, host, `${fixture}.png`), fakePngBuffer({ seed: index + (host === "web" ? 7 : 0) }));
      writeFileSync(join(dir, host, `${fixture}.txt`), fakeText(host, fixture));
    }
    writeFileSync(
      join(dir, host, "meta.json"),
      `${JSON.stringify(
        {
          host,
          forkSha,
          pinVersion,
          viewport: { w: FAKE_WIDTH, h: FAKE_HEIGHT },
          deviceScaleFactor: 1,
          capturedAt: "2026-10-12T00:00:00.000Z",
          fixtures: entries,
        },
        null,
        2,
      )}\n`,
    );
  }
  return dir;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "captures");
  writeFakeCaptures(target);
  process.stdout.write(`fake captures written to ${target}\n`);
}