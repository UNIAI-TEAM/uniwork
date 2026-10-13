// The `golden` check (contract 2.3): every capture against the committed golden
// of the same host and fixture. Pixel regions listed as masks in
// goldens/manifest.json (a caret, a clock, a version label — each with a
// reason) are ignored; everything else is "untouched" and must match.
//
// The tolerances live in the manifest, not here: `channel` is how far one
// channel may differ before a pixel counts as different (default 16), `ratio`
// how large a share of the unmasked pixels may differ before the pair drifts
// (default 0.001). The golden's own sha256 must equal its manifest entry.
//
// The mask limits live there too (`maskLimits`, next to `tolerance`): every
// mask carries a reason and must stay inside the frame, at most 5% of the
// frame each and 10% for all masks of one entry (F-05, FS-3). A mask that
// breaks any of that fails the pair as `invalid_mask` — it is never clamped
// away, because a careless rectangle could blank the whole comparison.
//
// In `--update-goldens` mode the captures are copied into the goldens dir and
// the manifest is rewritten; masks are hand-owned and stay untouched.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sha256Hex } from "../../../../apps/web/platform/office-frame/frame-bundle.mjs";
import { VIEWPORTS } from "./capture/constants.mjs";
import { captureBrandHits, MIN_VISIBLE_CHARS, visibleChars } from "./brand-check.mjs";
import { capturePairBlocker, DEFAULT_GOLDENS_DIR, HOSTS, fixtureIds, loadPngjs, readJsonState, relativeToOut } from "./job-lib.mjs";

export const DEFAULT_TOLERANCE = Object.freeze({ channel: 16, ratio: 0.001 });
/** How much of the frame a mask may blank, per mask and per entry (F-05, FS-3). */
export const DEFAULT_MASK_LIMITS = Object.freeze({ maxAreaSharePerMask: 0.05, maxAreaSharePerEntry: 0.1 });

/** Tolerances come from the manifest; the defaults only fill an absent value. */
export function tolerancesOf(manifest) {
  return {
    channel: typeof manifest?.tolerance?.channel === "number" ? manifest.tolerance.channel : DEFAULT_TOLERANCE.channel,
    ratio: typeof manifest?.tolerance?.ratio === "number" ? manifest.tolerance.ratio : DEFAULT_TOLERANCE.ratio,
  };
}

/** Mask limits come from the manifest too; the defaults only fill an absent value. */
export function maskLimitsOf(manifest) {
  return {
    maxAreaSharePerMask:
      typeof manifest?.maskLimits?.maxAreaSharePerMask === "number" ? manifest.maskLimits.maxAreaSharePerMask : DEFAULT_MASK_LIMITS.maxAreaSharePerMask,
    maxAreaSharePerEntry:
      typeof manifest?.maskLimits?.maxAreaSharePerEntry === "number" ? manifest.maskLimits.maxAreaSharePerEntry : DEFAULT_MASK_LIMITS.maxAreaSharePerEntry,
  };
}

/**
 * The reason a pair's mask list cannot be trusted, or null when every mask is
 * a rectangle inside the frame that carries a reason and holds the manifest's
 * area caps. A mask the check cannot trust fails the pair (F-05, FS-3): it is
 * never clamped away, because one careless rectangle could blank the frame.
 * @param {unknown} masks
 * @param {{ width: number, height: number, pair: string, limits: { maxAreaSharePerMask: number, maxAreaSharePerEntry: number } }} layout
 */
export function maskProblem(masks, { width, height, pair, limits }) {
  const frame = width * height;
  let covered = 0;
  for (const [index, mask] of (Array.isArray(masks) ? masks : []).entries()) {
    const at = `${pair}: mask ${index + 1}`;
    if (!mask || typeof mask !== "object") return `invalid_mask (${at}: not a rectangle)`;
    if (typeof mask.reason !== "string" || mask.reason.trim() === "") return `invalid_mask (${at}: no reason)`;
    const { x, y, w, h } = mask;
    if (![x, y, w, h].every((value) => Number.isInteger(value))) return `invalid_mask (${at}: x/y/w/h are not whole pixels)`;
    if (w <= 0 || h <= 0) return `invalid_mask (${at}: empty rectangle)`;
    if (x < 0 || y < 0 || x + w > width || y + h > height) return `invalid_mask (${at}: outside the ${width}x${height} frame)`;
    const share = (w * h) / frame;
    if (share > limits.maxAreaSharePerMask) {
      return `invalid_mask (${at}: ${(share * 100).toFixed(1)}% of the frame, over ${(limits.maxAreaSharePerMask * 100).toFixed(1)}%)`;
    }
    covered += w * h;
  }
  if (covered / frame > limits.maxAreaSharePerEntry) {
    return `invalid_mask (${pair}: the masks cover ${((covered / frame) * 100).toFixed(1)}% of the frame, over ${(limits.maxAreaSharePerEntry * 100).toFixed(1)}%)`;
  }
  return null;
}

const isSize = (value) => Boolean(value) && Number.isInteger(value.w) && Number.isInteger(value.h) && value.w > 0 && value.h > 0;

/**
 * The reason a manifest's viewport cannot be trusted, or null. Amendment 4: it
 * is one size per host, `{desktop:{w,h}, web:{w,h}}`. The old flat `{w,h}` is
 * not read as "the same for both hosts": it BLOCKS the run (invalid_manifest),
 * so a manifest written before the split cannot quietly compare a 1720 px web
 * capture against a 1440 px one.
 */
export function viewportProblem(manifest) {
  const viewport = manifest?.viewport;
  if (!viewport || typeof viewport !== "object") return "invalid_manifest (viewport is missing; it must be {desktop:{w,h}, web:{w,h}})";
  const bad = HOSTS.filter((host) => !isSize(viewport[host]));
  if (bad.length > 0) return `invalid_manifest (viewport must be {desktop:{w,h}, web:{w,h}} with whole-pixel sizes; ${bad.join(", ")} ${bad.length > 1 ? "are" : "is"} not)`;
  return null;
}

/**
 * BLOCKED reason when a capture was not taken at its host's manifest viewport (meta.json records the one really used), else null.
 * `expected` null (a manifest that does not declare the host yet) only asks for a whole-pixel size.
 */
function viewportBlocker(metaState, expected) {
  const used = metaState?.value?.viewport;
  if (!isSize(used)) return "captures_at_another_viewport";
  return expected && (used.w !== expected.w || used.h !== expected.h) ? "captures_at_another_viewport" : null;
}

/**
 * A pixel is masked when any mask rectangle covers it. The masks are validated
 * before the comparison (bounds, reason, area — `maskProblem`), so the clamp
 * here is only a safety net for a caller that skipped that check.
 */
function maskGrid(masks, width, height) {
  const grid = new Uint8Array(width * height);
  for (const mask of Array.isArray(masks) ? masks : []) {
    if (!mask || typeof mask !== "object") continue;
    const x0 = Math.max(0, Math.min(width, Number(mask.x) || 0));
    const y0 = Math.max(0, Math.min(height, Number(mask.y) || 0));
    const x1 = Math.max(0, Math.min(width, x0 + (Number(mask.w) || 0)));
    const y1 = Math.max(0, Math.min(height, y0 + (Number(mask.h) || 0)));
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) grid[y * width + x] = 1;
    }
  }
  return grid;
}

/**
 * Compare two decoded PNGs: the changed-pixel ratio over the pixels outside
 * the masks, plus the diff image (red on changed pixels, masks greyed).
 * @param {{ width: number, height: number, data: Buffer }} actual
 * @param {{ width: number, height: number, data: Buffer }} expected
 * @param {{ channel: number }} tolerance
 * @param {{ x: number, y: number, w: number, h: number }[]} masks
 */
export function comparePixels(actual, expected, tolerance, masks) {
  const { width, height } = actual;
  const masksGrid = maskGrid(masks, width, height);
  const diff = new Uint8Array(width * height * 4);
  let outside = 0;
  let changed = 0;
  for (let i = 0; i < width * height; i += 1) {
    const at = i * 4;
    const masked = masksGrid[i] === 1;
    let differs = false;
    if (!masked) {
      outside += 1;
      for (let channel = 0; channel < 4; channel += 1) {
        if (Math.abs(actual.data[at + channel] - expected.data[at + channel]) > tolerance.channel) {
          differs = true;
          break;
        }
      }
      if (differs) changed += 1;
    }
    if (masked) diff.set([0x80, 0x80, 0x80, 0xff], at);
    else if (differs) diff.set([0xff, 0x00, 0x00, 0xff], at);
    else diff.set(actual.data.subarray(at, at + 4), at);
  }
  return { outside, changed, ratio: outside > 0 ? changed / outside : 0, diff };
}

/** A pair's report: pass/fail/blocked, named reasons, the numbers behind them. */
function pairBlocked(pair, reason) {
  return { ...pair, status: "BLOCKED", reasons: [reason] };
}

/**
 * Run the check and write <out>/golden/summary.json plus, per pair,
 * .actual.png / .expected.png / .diff.png under <out>/golden/<host>/.
 *
 * `forkSha` / `pinVersion` are the build the comparisons are about: a capture
 * whose meta.json names another build is blocked (F-04), never compared.
 * @param {{ capturesDir: string | null, goldensDir?: string, outDir: string, fixtures?: string[], hosts?: string[], forkSha?: string | null, pinVersion?: string | null }} options
 */
export function runGoldenCheck({ capturesDir, goldensDir = DEFAULT_GOLDENS_DIR, outDir, fixtures = fixtureIds(), hosts = HOSTS, forkSha = null, pinVersion = null }) {
  if (!capturesDir || !existsSync(capturesDir)) {
    return { status: "BLOCKED", reasons: ["captures_missing"], artifacts: [] };
  }
  const { PNG } = loadPngjs();
  const manifestPath = join(goldensDir, "manifest.json");
  const manifestState = readJsonState(manifestPath);
  // A goldens dir without a manifest is a setup blocker, not a drift (F-08):
  // nothing was captured, so nothing can be compared.
  if (manifestState.missing) {
    return { status: "BLOCKED", reasons: ["goldens_manifest_missing"], artifacts: [] };
  }
  if (manifestState.error) {
    return { status: "BLOCKED", reasons: [`goldens_manifest_unreadable (${manifestState.error})`], artifacts: [] };
  }
  const manifest = manifestState.value ?? {};
  const manifestProblem = viewportProblem(manifest);
  if (manifestProblem) return { status: "BLOCKED", reasons: [manifestProblem], artifacts: [] };
  const tolerance = tolerancesOf(manifest);
  const maskLimits = maskLimitsOf(manifest);
  const entries = manifest.entries ?? {};
  const pairs = [];
  const artifacts = [];

  for (const host of hosts) {
    const metaState = readJsonState(join(capturesDir, host, "meta.json"));
    for (const fixture of fixtures) {
      const pair = { host, fixture };
      const capturePath = join(capturesDir, host, `${fixture}.png`);
      const goldenPath = join(goldensDir, host, `${fixture}.png`);
      const entry = entries[`${host}/${fixture}`] ?? null;
      const blocker = capturePairBlocker(metaState, fixture, { forkSha, pinVersion }) ?? viewportBlocker(metaState, manifest.viewport[host]);
      let report;
      if (blocker) report = pairBlocked(pair, blocker);
      else if (!existsSync(capturePath)) report = pairBlocked(pair, "capture_missing");
      else if (!entry || !existsSync(goldenPath)) report = { ...pair, status: "FAIL", reasons: ["golden_missing"] };
      else {
        const outDirForPair = join(outDir, "golden", host);
        mkdirSync(outDirForPair, { recursive: true });
        const actualPath = join(outDirForPair, `${fixture}.actual.png`);
        const expectedPath = join(outDirForPair, `${fixture}.expected.png`);
        copyFileSync(capturePath, actualPath);
        copyFileSync(goldenPath, expectedPath);
        artifacts.push(relativeToOut(outDir, actualPath), relativeToOut(outDir, expectedPath));
        const actualBytes = readFileSync(capturePath);
        const goldenBytes = readFileSync(goldenPath);
        if (sha256Hex(goldenBytes) !== entry.sha256) {
          report = { ...pair, status: "FAIL", reasons: ["golden_tampered"] };
        } else {
          let actual;
          let expected;
          try {
            actual = PNG.sync.read(actualBytes);
            expected = PNG.sync.read(goldenBytes);
          } catch (error) {
            report = { ...pair, status: "FAIL", reasons: [`png_unreadable (${error.message})`] };
          }
          if (actual && expected) {
            if (actual.width !== expected.width || actual.height !== expected.height) {
              report = { ...pair, status: "FAIL", reasons: ["size_mismatch"], size: { actual: [actual.width, actual.height], expected: [expected.width, expected.height] } };
            } else {
              const maskIssue = maskProblem(entry.masks ?? [], { width: actual.width, height: actual.height, pair: `${host}/${fixture}`, limits: maskLimits });
              if (maskIssue) {
                report = { ...pair, status: "FAIL", reasons: [maskIssue] };
              } else {
                const result = comparePixels(actual, expected, tolerance, entry.masks ?? []);
                const drift = result.ratio > tolerance.ratio;
                report = {
                  ...pair,
                  status: drift ? "FAIL" : "PASS",
                  reasons: drift ? ["golden_drift"] : [],
                  pixels: { outside: result.outside, changed: result.changed, ratio: result.ratio },
                };
                const diffPath = join(outDirForPair, `${fixture}.diff.png`);
                const image = new PNG({ width: actual.width, height: actual.height });
                Buffer.from(result.diff).copy(image.data);
                writeFileSync(diffPath, PNG.sync.write(image));
                artifacts.push(relativeToOut(outDir, diffPath));
              }
            }
          }
        }
      }
      pairs.push(report);
    }
  }

  const fail = [...new Set(pairs.filter((pair) => pair.status === "FAIL").flatMap((pair) => pair.reasons))];
  const blocked = [...new Set(pairs.filter((pair) => pair.status === "BLOCKED").flatMap((pair) => pair.reasons))];
  const status = fail.length > 0 ? "FAIL" : blocked.length > 0 ? "BLOCKED" : "PASS";
  const summaryPath = join(outDir, "golden", "summary.json");
  mkdirSync(dirname(summaryPath), { recursive: true });
  writeFileSync(summaryPath, `${JSON.stringify({ status, tolerances: tolerance, pinVersion: manifest.pinVersion ?? null, pairs }, null, 2)}\n`);
  artifacts.unshift(relativeToOut(outDir, summaryPath));
  return { status, reasons: status === "FAIL" ? fail : status === "BLOCKED" ? blocked : [], artifacts };
}

/**
 * `--update-goldens`: copy the captures into the goldens dir and rewrite
 * <goldensDir>/manifest.json. Masks stay hand-owned: an entry keeps the masks
 * it had. Only a pair that could pass the checks may be blessed (FS-2): the
 * capture must be `ok`, its text must carry no brand hit and must have enough
 * visible characters. A pair that fails any of that keeps its old entry (or
 * none) and blocks the run — a screenshot never waives a missing render.
 * @param {{ capturesDir: string | null, goldensDir?: string, fixtures?: string[], hosts?: string[], pinVersion?: string | null, forkSha?: string | null, outDir: string }} options
 */
export function updateGoldens({ capturesDir, goldensDir = DEFAULT_GOLDENS_DIR, fixtures = fixtureIds(), hosts = HOSTS, pinVersion = null, forkSha = null, outDir }) {
  if (!capturesDir || !existsSync(capturesDir)) {
    return { status: "BLOCKED", reasons: ["captures_missing"], artifacts: [] };
  }
  const manifestPath = join(goldensDir, "manifest.json");
  const previousState = readJsonState(manifestPath);
  if (previousState.error) {
    return { status: "BLOCKED", reasons: [`goldens_manifest_unreadable (${previousState.error})`], artifacts: [] };
  }
  const previous = previousState.value ?? {};
  const entries = { ...(previous.entries ?? {}) };
  const blocked = [];
  const blessedHosts = new Set();
  const metaStates = new Map(hosts.map((host) => [host, readJsonState(join(capturesDir, host, "meta.json"))]));
  for (const host of hosts) {
    for (const fixture of fixtures) {
      const metaState = metaStates.get(host);
      if (metaState.error) {
        blocked.push(`capture_meta_unreadable:${host}/${fixture}`);
        continue;
      }
      if (metaState.missing) {
        blocked.push(`capture_meta_missing:${host}/${fixture}`);
        continue;
      }
      const capturePath = join(capturesDir, host, `${fixture}.png`);
      if (!existsSync(capturePath)) {
        blocked.push(`capture_missing:${host}/${fixture}`);
        continue;
      }
      // the compare path's own check: a capture of another fork/pin than the one being blessed is never copied in (N-2)
      const blocker = capturePairBlocker(metaState, fixture, { forkSha, pinVersion });
      if (blocker) {
        blocked.push(`${blocker}:${host}/${fixture}`);
        continue;
      }
      // the compare path's viewport check too (R3-1): a meta that proves no viewport, or another one than the manifest's for this host, is never blessed
      const viewportBlock = viewportBlocker(metaState, viewportProblem(previous) ? null : previous.viewport[host]);
      if (viewportBlock) {
        blocked.push(`${viewportBlock}:${host}/${fixture}`);
        continue;
      }
      const textPath = join(capturesDir, host, `${fixture}.txt`);
      if (!existsSync(textPath)) {
        blocked.push(`rendered_text_missing:${host}/${fixture}`);
        continue;
      }
      const text = readFileSync(textPath, "utf8");
      if (visibleChars(text) < MIN_VISIBLE_CHARS) {
        blocked.push(`no_rendered_text:${host}/${fixture}`);
        continue;
      }
      const brandFiles = [...new Set(captureBrandHits(join(capturesDir, host), fixture, text).map((hit) => hit.file))];
      if (brandFiles.length > 0) {
        blocked.push(...brandFiles.map((file) => `brand_text:${host}/${fixture}/${file}`));
        continue;
      }
      const target = join(goldensDir, host, `${fixture}.png`);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(capturePath, target);
      entries[`${host}/${fixture}`] = { sha256: sha256Hex(readFileSync(target)), masks: entries[`${host}/${fixture}`]?.masks ?? [] };
      blessedHosts.add(host);
    }
  }
  const meta = [...metaStates.values()].map((state) => state.value).find((value) => value && value.viewport) ?? {};
  // one viewport per host: this run's capture of that host when one of its pairs was blessed (R3-2), else the previous manifest's, else the provider's fixed one
  const viewport = Object.fromEntries(
    HOSTS.map((host) => {
      const used = blessedHosts.has(host) ? metaStates.get(host).value.viewport : null;
      const before = viewportProblem(previous) ? null : previous.viewport[host];
      return [host, isSize(used) ? { w: used.w, h: used.h } : before ?? { ...VIEWPORTS[host] }];
    }),
  );
  const manifest = {
    schema: 1,
    pinVersion: pinVersion ?? meta.pinVersion ?? previous.pinVersion ?? null,
    forkSha: forkSha ?? meta.forkSha ?? previous.forkSha ?? null,
    capturedOn: meta.capturedAt ?? previous.capturedOn ?? new Date().toISOString(),
    viewport,
    deviceScaleFactor: meta.deviceScaleFactor ?? previous.deviceScaleFactor ?? 1,
    tolerance: tolerancesOf(previous),
    maskLimits: maskLimitsOf(previous),
    entries,
  };
  mkdirSync(goldensDir, { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const summaryPath = join(outDir, "golden", "update.json");
  mkdirSync(dirname(summaryPath), { recursive: true });
  writeFileSync(summaryPath, `${JSON.stringify({ entries: Object.keys(entries).length, blocked }, null, 2)}\n`);
  return {
    status: blocked.length > 0 ? "BLOCKED" : "PASS",
    reasons: blocked,
    artifacts: [relativeToOut(outDir, summaryPath), relativeToOut(outDir, manifestPath)],
  };
}