#!/usr/bin/env node
// Store metadata as code (audit "store-assets-absent"), generated from the one source of the store copy,
// store/listing.md, so the listing reviewed in a PR is the listing the stores get:
//
// - store/apple/store.config.json — EAS Metadata for App Store Connect (`eas metadata:push`, the path is
//   eas.json › submit.production.ios.metadataPath): title, subtitle, description, keywords and URLs in vi
//   and en-US, the categories, the reviewer's notes. The iOS description leaves out the calls line while
//   calls are off on iPhone (listing.md › Quyền: Apple 2.3.1, metadata matches the app). The demo account's
//   password never lives here: App Store Connect holds it.
// - store/play/<locale>/{title,short_description,full_description}.txt — Play Console's main store listing
//   per language, in fastlane supply's layout (Play Console › Main store listing, or `fastlane supply`).
//
// Store limits are checked as it writes: App Store title and subtitle ≤ 30, keywords ≤ 100, description
// ≤ 4000; Play title ≤ 30, short description ≤ 80, full description ≤ 4000.
//   node apps/chat-mobile/scripts/store-metadata.mjs           # writes the files
//   node apps/chat-mobile/scripts/store-metadata.mjs --check   # fails when they are stale (store-listing.test.ts)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const storeDir = path.resolve(here, "../store");
const SITE = "https://app.uniworkos.com";
const TITLE = "UniChat";
// What the iOS copy drops while calls are off on iPhone (unichat_mobile_calls_ios): the description's
// calls line and the review notes' calls paragraph.
const CALLS_LINE = { vi: /^- Gọi thoại và video/, en: /^- Voice and video calls/ };
const CALLS_NOTE = /^To test a call/;
const CALLS_KEYWORD = /gọi|call/i;

function fail(message) {
  throw new Error(`store-metadata: ${message}`);
}

/** The value after a bold label on one line: `**label** value`. */
function labelled(listing, label) {
  const line = listing.split("\n").find((l) => l.startsWith(`**${label}`));
  if (!line) fail(`listing.md has no "**${label}" line`);
  return line.slice(line.indexOf("**", 2) + 2).trim();
}

/** The quoted block under a bold label, as plain text paragraphs and bullet lines. */
function quoted(listing, label) {
  const lines = listing.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`**${label}`));
  if (start < 0) fail(`listing.md has no "**${label}" block`);
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "" && body.length === 0) continue;
    if (!line.startsWith(">")) break;
    body.push(line.replace(/^> ?/, ""));
  }
  // A wrapped bullet or sentence continues on an indented line.
  const joined = [];
  for (const line of body) {
    if (/^\s{2,}\S/.test(line) && joined.length > 0) joined[joined.length - 1] += ` ${line.trim()}`;
    else joined.push(line.trimEnd());
  }
  const text = joined.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  // A sentence wrapped without a bullet joins its paragraph.
  return text
    .split("\n\n")
    .map((paragraph) => (paragraph.startsWith("- ") ? paragraph : paragraph.replace(/\n(?!- )/g, " ")))
    .join("\n\n");
}

function limit(value, max, what) {
  if ([...value].length > max) fail(`${what} is ${[...value].length} characters, the store takes ${max}`);
  return value;
}

export function storeMetadata(listing) {
  const copy = {
    vi: {
      subtitle: labelled(listing, "vi — phụ đề (≤ 30 ký tự):**"),
      iosSubtitle: labelled(listing, "vi — phụ đề iPhone (khi gọi còn tắt trên iPhone):**"),
      description: quoted(listing, "vi — mô tả:**"),
    },
    en: {
      subtitle: labelled(listing, "en — subtitle:**"),
      iosSubtitle: labelled(listing, "en — iPhone subtitle (while calls are off on iPhone):**"),
      description: quoted(listing, "en — description:**"),
    },
  };
  const keywords = labelled(listing, "Từ khoá (≤ 100 ký tự):**").replace(/`/g, "").trim();
  limit(keywords, 100, "keywords");
  const reviewNote = quoted(listing, "Review notes (en):**")
    .split("\n\n")
    .filter((paragraph) => !CALLS_NOTE.test(paragraph))
    .join("\n\n");
  const ios = (lang) =>
    copy[lang].description
      .split("\n")
      .filter((line) => !CALLS_LINE[lang].test(line))
      .join("\n");
  const page = (lang, route) => `${SITE}${lang === "vi" ? `/vi${route}` : route}`;
  const info = (lang) => ({
    title: limit(TITLE, 30, "title"),
    subtitle: limit(copy[lang].iosSubtitle, 30, `${lang} App Store subtitle`),
    description: limit(ios(lang), 4000, `${lang} App Store description`),
    keywords: keywords
      .split(",")
      .map((k) => k.trim())
      .filter((k) => !CALLS_KEYWORD.test(k)),
    marketingUrl: page(lang, "/apps/unichat"),
    supportUrl: page(lang, "/privacy"),
    privacyPolicyUrl: page(lang, "/privacy"),
  });
  const apple = {
    configVersion: 0,
    apple: {
      copyright: "Unicom Technology Solutions Company Limited",
      categories: ["BUSINESS", "PRODUCTIVITY"],
      info: { vi: info("vi"), "en-US": info("en") },
      review: { demoRequired: true, notes: limit(reviewNote, 4000, "review notes") },
    },
  };
  const play = Object.fromEntries(
    [
      ["vi-VN", "vi"],
      ["en-US", "en"],
    ].map(([locale, lang]) => [
      locale,
      {
        "title.txt": limit(TITLE, 30, "Play title"),
        "short_description.txt": limit(limit(copy[lang].subtitle, 30, `${lang} subtitle`), 80, `${lang} Play short description`),
        "full_description.txt": limit(copy[lang].description, 4000, `${lang} Play full description`),
      },
    ]),
  );
  return { apple, play };
}

/** Every file this script owns under store/, path → content. */
function storeFiles(listing) {
  const { apple, play } = storeMetadata(listing);
  const files = { "apple/store.config.json": `${JSON.stringify(apple, null, 2)}\n` };
  for (const [locale, texts] of Object.entries(play)) {
    for (const [name, text] of Object.entries(texts)) files[`play/${locale}/${name}`] = `${text}\n`;
  }
  return files;
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const files = storeFiles(fs.readFileSync(path.join(storeDir, "listing.md"), "utf8"));
  const check = process.argv.includes("--check");
  const stale = [];
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(storeDir, rel);
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    if (current === content) continue;
    if (check) stale.push(rel);
    else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
      process.stdout.write(`wrote store/${rel}\n`);
    }
  }
  if (stale.length > 0) {
    process.stderr.write(`stale: ${stale.join(", ")}; run node apps/chat-mobile/scripts/store-metadata.mjs\n`);
    process.exit(1);
  }
}
