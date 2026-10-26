#!/usr/bin/env node
// UniChat mobile's screen as TalkBack and a thumb meet it, on the CI emulator
// (audit UX P3 "no-device-a11y-verification"): the screen the app is on is
// dumped with uiautomator and every control of the app is held to two rules
// Android's Accessibility Scanner also checks — it has a name a screen reader
// can read (its text, its content description, or a named child it speaks
// for), and its drawn bounds are at least 48 × 48 dp. Run after Maestro left
// the app on a screen, at the font scale and theme the step chose.
//
//   node scripts/mobile-a11y-audit.mjs --package <id> [--min-dp 48] [--out <file>] [--warn]
//       Exits 1 when a control breaks a rule, after printing each one; with
//       --warn it prints them as GitHub warnings and exits 0 (a screen whose
//       small controls are grown by hit slop, which this cannot see).
//
// What it cannot see: React Native's hitSlop grows a touch area without
// growing the view, so a control drawn smaller than the minimum on purpose
// (hit slop making up the rest) reads as too small here; pass --min-dp 44 for
// a screen that has one. Contrast is held on the tokens instead
// (apps/chat-mobile/lib/theme-contrast.test.ts).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const ATTR = /([\w-]+)="([^"]*)"/g;

/** The attributes of one `<node …>` tag. */
function attributes(tag) {
  const out = {};
  for (const [, name, value] of tag.matchAll(ATTR)) out[name] = value;
  return out;
}

/** uiautomator's XML as a tree of { attrs, children }. */
export function parseHierarchy(xml) {
  const root = { attrs: {}, children: [] };
  const stack = [root];
  for (const match of xml.matchAll(/<node\b([^>]*?)(\/?)>|<\/node>/g)) {
    if (match[0] === "</node>") {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const node = { attrs: attributes(match[1] ?? ""), children: [] };
    stack.at(-1).children.push(node);
    if (match[2] !== "/") stack.push(node);
  }
  return root;
}

/** `[x1,y1][x2,y2]` as a width and height in px; null when unreadable. */
export function boundsSize(bounds) {
  const match = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(bounds ?? "");
  if (!match) return null;
  const [x1, y1, x2, y2] = match.slice(1).map(Number);
  return { width: x2 - x1, height: y2 - y1 };
}

/** What TalkBack reads for a node: its own text or description, else the text of the children it speaks for. */
export function spokenName(node) {
  const own = (node.attrs["content-desc"] || node.attrs.text || "").trim();
  if (own) return own;
  return node.children
    .filter((child) => child.attrs.clickable !== "true")
    .map(spokenName)
    .filter(Boolean)
    .join(" ")
    .trim();
}

/**
 * Every control of `pkg` (clickable or long-clickable, enabled, on screen) that breaks a rule:
 * no name, or drawn smaller than `minDp` on either side at `density` (px per dp).
 */
export function auditHierarchy(xml, { pkg, density, minDp = 48 }) {
  const issues = [];
  const minPx = Math.floor(minDp * density);
  const visit = (node) => {
    const a = node.attrs;
    const control = (a.clickable === "true" || a["long-clickable"] === "true") && a.enabled !== "false" && a.package === pkg;
    const size = boundsSize(a.bounds);
    if (control && size && size.width > 0 && size.height > 0) {
      const where = `${a.class ?? "node"} ${a["resource-id"] || ""} ${a.bounds}`.replace(/\s+/g, " ").trim();
      const name = spokenName(node);
      if (!name) issues.push({ rule: "name", where, detail: "a control with no text or content description" });
      if (size.width < minPx || size.height < minPx) {
        const dp = (px) => Math.round(px / density);
        issues.push({ rule: "target", where, detail: `${name || "unnamed"}: ${dp(size.width)} × ${dp(size.height)} dp, under ${minDp} dp` });
      }
    }
    node.children.forEach(visit);
  };
  visit(parseHierarchy(xml));
  return issues;
}

/** `wm density` output: the density in px per dp (its override when one is set). */
export function parseDensity(text) {
  const override = /Override density:\s*(\d+)/.exec(text);
  const physical = /Physical density:\s*(\d+)/.exec(text);
  const dpi = Number((override ?? physical)?.[1]);
  return Number.isFinite(dpi) && dpi > 0 ? dpi / 160 : null;
}

function arg(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback;
}

function main(argv) {
  const pkg = arg(argv, "--package");
  if (!pkg) throw new Error("--package <application id> is required");
  const minDp = Number(arg(argv, "--min-dp", "48"));
  const out = arg(argv, "--out");
  const warn = argv.includes("--warn");
  const adb = (...args) => execFileSync("adb", args, { encoding: "utf8" });
  const density = parseDensity(adb("shell", "wm", "density"));
  if (!density) throw new Error("adb shell wm density gave no density");
  adb("shell", "uiautomator", "dump", "/sdcard/unichat-a11y.xml");
  const xml = adb("exec-out", "cat", "/sdcard/unichat-a11y.xml");
  const issues = auditHierarchy(xml, { pkg, density, minDp });
  if (out) fs.writeFileSync(out, `${JSON.stringify({ pkg, minDp, density, issues }, null, 2)}\n`);
  if (!xml.includes(`package="${pkg}"`)) {
    console.error(`✗ the screen holds nothing of ${pkg}: the app is not in front`);
    return 1;
  }
  for (const issue of issues) console.error(`${warn ? "::warning::" : "✗ "}${issue.rule}: ${issue.detail} (${issue.where})`);
  console.log(issues.length === 0 ? `✓ every control of ${pkg} is named and at least ${minDp} dp` : `${issues.length} accessibility issue(s)`);
  return issues.length === 0 || warn ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(main(process.argv.slice(2)));
