#!/usr/bin/env node
// G7-12 spot-check sheet (UNI-1384, G7-D1 D1.c amendment 2026-10-16): lists the graded items the user must check and writes the
// spotCheck skeleton to fill in.
//
//   node scripts/office/g5g6g7/holdout-spotcheck.mjs --reviews <file> --seed <n> [--packet <review-packet.json>] [--cases <dir>] [--out <dir>]
//   node scripts/office/g5g6g7/holdout-spotcheck.mjs --reviews <file> --merge <filled spotcheck file> --out <dir>
//
// The sheet (spotcheck-sheet.md, Vietnamese / English, also printed) holds every fail, every borderline, every injection item and
// RANDOM_PASSES random passes drawn from the seed. spotcheck-skeleton.json is the file the user fills (verdict pass | fail, date,
// optional note). --merge writes reviews-spot-checked.json: the reviews file with those spot-checks added (it never overwrites the
// reviews file), validated by the same parser the report uses.
// Which items are injection items comes from the case set (read at runtime, like the export): a grader file that dropped or
// falsified the flag cannot push an injection item off the sheet (G712-29). The case set itself is checked: a --cases set whose
// caseSetSha256 differs from the reviews file's (or the packet's) is refused, and so is a run nothing ties to a case set, so a
// wrong case set cannot drop an injection item either (G712-51).

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseReviews } from './holdout-report.mjs';
import { GRADING_WORDING, RANDOM_PASSES, SPOTCHECK_KIND, itemKey, parseSeed, pickSpotChecks, validateSpotCheck } from './holdout-review.mjs';
import { DEFAULT_CASES_DIR, caseSetSha256, isInsideRepo } from './holdout-run.mjs';
import { loadCases } from './holdout-score.mjs';

export const SHEET_FILE = 'spotcheck-sheet.md';
export const SKELETON_FILE = 'spotcheck-skeleton.json';
export const MERGED_FILE = 'reviews-spot-checked.json';

const BECAUSE = { fail: 'fail', borderline: 'khó phân định / borderline', injection: 'tiêm lệnh / injection', 'random pass': 'pass ngẫu nhiên / random pass' };

/** The items to check (not yet spot-checked) with the reason each is on the list; `injectionIds` comes from the case set. */
export function spotCheckList(reviews, seed, injectionIds = null) {
  return pickSpotChecks(reviews.reviews, seed, RANDOM_PASSES, injectionIds).filter(({ entry }) => entry.spotCheck === undefined);
}

export function renderSheet(reviews, list, seed, packet = null) {
  const out = [];
  const w = (line = '') => out.push(line);
  const items = new Map((packet?.items ?? []).map((i) => [itemKey(i), i]));
  const checked = reviews.reviews.filter((r) => r.spotCheck !== undefined).length;
  w('# Phiếu kiểm mẫu / Spot-check sheet (G7-12)');
  w();
  w(`${GRADING_WORDING.vi} (${GRADING_WORDING.en}). Phiên / session ${reviews.sessionId}, seed ${seed}.`);
  w();
  w(`Cần kiểm ${list.length} mục: mọi fail, mọi borderline, mọi ca tiêm lệnh, ${RANDOM_PASSES} pass ngẫu nhiên. Đã kiểm trước đó: ${checked}. / ${list.length} item(s) to check: every fail, every borderline, every injection item, ${RANDOM_PASSES} random passes. Already checked: ${checked}.`);
  w('Với mỗi mục: đọc câu trả lời, so với lý do và đoạn trích của grader, rồi ghi pass hoặc fail trong spotcheck-skeleton.json. / For each item read the answer against the grader\'s reason and quote, then write pass or fail in spotcheck-skeleton.json.');
  w();
  w('| # | Ca | Ngôn ngữ | Lần | Vì sao | Grader | Lý do của grader | Đoạn trích |');
  w('| ---: | --- | --- | ---: | --- | --- | --- | --- |');
  const cell = (text) => String(text).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
  list.forEach(({ entry, because }, i) => w(`| ${i + 1} | ${entry.id} | ${entry.lang} | ${entry.run} | ${because.map((b) => BECAUSE[b]).join('; ')} | ${entry.verdict} | ${cell(entry.reason)} | "${cell(entry.quote)}" |`));
  if (packet) {
    w();
    w('## Câu hỏi và câu trả lời / Question and answer');
    list.forEach(({ entry }, i) => {
      const item = items.get(itemKey(entry));
      w();
      w(`### ${i + 1}. ${entry.id} (${entry.lang}, run ${entry.run})`);
      if (!item) { w('(không có trong gói / not in the packet)'); return; }
      w(`- Câu hỏi / question: ${cell(item.question)}`);
      w(`- Đáp án tham chiếu / reference: ${cell(item.reference.text)}`);
      w(`- Câu trả lời / answer: ${cell(item.answer)}`);
    });
  }
  return `${out.join('\n')}\n`;
}

export function buildSkeleton(reviews, list, seed) {
  return {
    schemaVersion: 1, kind: SPOTCHECK_KIND, sessionId: reviews.sessionId, manifestSha256: reviews.manifestSha256, seed,
    items: list.map(({ entry, because }) => ({ id: entry.id, lang: entry.lang, run: entry.run, because, graderVerdict: entry.verdict, spotCheck: { by: 'user', date: '', verdict: '', note: '' } })),
  };
}

/** The reviews file with the filled spot-checks added; an item that is not in the file, or a bad spot-check, is an error. */
export function mergeSpotChecks(reviews, filled) {
  const problems = [];
  if (filled?.kind !== SPOTCHECK_KIND) problems.push(`the spot-check file kind must be ${SPOTCHECK_KIND}`);
  if (filled?.sessionId !== reviews.sessionId || filled?.manifestSha256 !== reviews.manifestSha256) problems.push('the spot-check file is for another session or manifest than the reviews file');
  const byKey = new Map((filled?.items ?? []).map((i) => [itemKey(i), i]));
  const merged = reviews.reviews.map((r) => {
    const item = byKey.get(itemKey(r));
    if (!item) return r;
    byKey.delete(itemKey(r));
    const sc = { ...item.spotCheck };
    if (sc.note === '') delete sc.note;
    validateSpotCheck(sc, `spotCheck of ${itemKey(r)}`, problems);
    return { ...r, spotCheck: sc };
  });
  for (const key of byKey.keys()) problems.push(`${key} is not an item of the reviews file`);
  if (problems.length > 0) throw new Error(`cannot merge the spot-checks:\n- ${problems.join('\n- ')}`);
  return parseReviews({ ...reviews, reviews: merged });
}

const HELP = `Usage: node scripts/office/g5g6g7/holdout-spotcheck.mjs --reviews <file> --seed <n> [--packet <review-packet.json>] [--cases <dir>] [--out <dir>]
       node scripts/office/g5g6g7/holdout-spotcheck.mjs --reviews <file> --merge <filled ${SKELETON_FILE}> --out <dir>
Lists every fail, every borderline, every injection item and ${RANDOM_PASSES} random passes (from the seed) of a model-graded reviews file, and writes
${SHEET_FILE} + ${SKELETON_FILE} to fill in. --merge adds the filled spot-checks and writes ${MERGED_FILE}.
--cases      the case set the injection flag is read from (default ${DEFAULT_CASES_DIR}); the case set, not the reviews file, decides,
             and it must be the case set the session ran over: caseSetSha256 is checked against the reviews file (or --packet), and a
             set that differs — or that neither names — is refused (G712-51)
`;

export function parseArgs(argv) {
  const args = { cases: DEFAULT_CASES_DIR };
  const need = (i) => { if (argv[i + 1] === undefined) throw new Error(`${argv[i]} needs a value`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--reviews') args.reviews = path.resolve(need(i++));
    else if (argv[i] === '--seed') args.seed = parseSeed(need(i++));
    else if (argv[i] === '--packet') args.packet = path.resolve(need(i++));
    else if (argv[i] === '--cases') args.cases = path.resolve(need(i++));
    else if (argv[i] === '--out') args.out = path.resolve(need(i++));
    else if (argv[i] === '--merge') args.merge = path.resolve(need(i++));
    else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (args.help) return args;
  if (!args.reviews) throw new Error('--reviews <file> is required');
  if (args.merge ? !args.out : args.seed === undefined) throw new Error(args.merge ? '--merge needs --out <dir>' : '--seed <n> is required (the random passes come from it)');
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(HELP); return; }
  const reviews = parseReviews(JSON.parse(fs.readFileSync(args.reviews, 'utf8')));
  if (!reviews.grader) throw new Error('the reviews file is not model-graded (no grader): there is nothing to spot-check');
  if (args.out && isInsideRepo(args.out)) throw new Error(`--out ${args.out} is inside the repo: the sheet quotes answers, keep it outside`);
  if (args.merge) {
    const merged = mergeSpotChecks(reviews, JSON.parse(fs.readFileSync(args.merge, 'utf8')));
    fs.mkdirSync(args.out, { recursive: true });
    fs.writeFileSync(path.join(args.out, MERGED_FILE), `${JSON.stringify(merged, null, 2)}\n`);
    process.stdout.write(`${merged.reviews.filter((r) => r.spotCheck).length} spot-check(s) in ${path.join(args.out, MERGED_FILE)}\n`);
    return;
  }
  const packet = args.packet ? JSON.parse(fs.readFileSync(args.packet, 'utf8')) : null;
  const { cases } = loadCases(args.cases);
  // G712-51: the sheet reads its injection flags from --cases, so that set must be the one the session ran over. The export
  // records caseSetSha256 in the reviews skeleton and in the packet; a differing set — or a run nothing ties to a set — is
  // refused, so a wrong case set can never drop an injection item.
  const named = [['the reviews file', reviews.caseSetSha256], ['--packet', packet?.caseSetSha256]].filter(([, sha]) => sha !== undefined);
  if (named.length === 0) throw new Error('neither the reviews file nor --packet names the case set (caseSetSha256 is missing from both): pass --packet <review-packet.json> or re-export the packet');
  const caseSha = caseSetSha256(cases);
  for (const [what, sha] of named) if (sha !== caseSha) throw new Error(`${what} names case set ${String(sha).slice(0, 12)} while --cases holds ${caseSha.slice(0, 12)} (caseSetSha256 differs): a wrong case set could drop an injection item (G712-51)`);
  const list = spotCheckList(reviews, args.seed, new Set(cases.filter((c) => c.category === 'injection').map((c) => c.id)));
  const sheet = renderSheet(reviews, list, args.seed, packet);
  if (args.out) {
    fs.mkdirSync(args.out, { recursive: true });
    fs.writeFileSync(path.join(args.out, SHEET_FILE), sheet);
    fs.writeFileSync(path.join(args.out, SKELETON_FILE), `${JSON.stringify(buildSkeleton(reviews, list, args.seed), null, 2)}\n`);
  }
  process.stdout.write(sheet);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`${err?.message ?? err}\n`);
    process.exit(4);
  }
}
