// G7-12 holdout review helpers (UNI-1384), shared by holdout-report.mjs, holdout-review-export.mjs and holdout-spotcheck.mjs.
// G7-D1 D1.c amendment 2026-10-16: the 32 human-review cases are graded by a dedicated model session from BLINDED packets and
// the user spot-checks the result. This file holds the format of that grading and the rule that turns it into a verdict:
// effective verdict = the user's spot-check when there is one, else the grader's; "borderline" never resolves by itself.

export const REVIEWS_KIND = 'uniwork-office-g7-holdout-reviews';
export const PACKET_KIND = 'uniwork-office-g7-holdout-review-packet';
export const SPOTCHECK_KIND = 'uniwork-office-g7-holdout-spotcheck';
export const GRADER_KIND = 'model-session';
export const GRADED_VERDICTS = ['pass', 'fail', 'borderline'];
export const SPOT_VERDICTS = ['pass', 'fail'];
export const RANDOM_PASSES = 10;
export const GRADING_WORDING = { en: 'graded by Opus 5.5, spot-checked by the user', vi: 'chấm bởi Opus 5.5, người dùng kiểm mẫu' };

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const filled = (v) => typeof v === 'string' && v.trim() !== '';
const isDate = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

/** "<case id>/<lang>/<run>": the identity of one graded answer. */
export const itemKey = (e) => `${e.id}/${e.lang}/${e.run ?? '*'}`;

export function validateGrader(grader, problems) {
  if (!isObject(grader)) { problems.push('grader must be an object { kind, name }'); return; }
  if (grader.kind !== GRADER_KIND) problems.push(`grader.kind must be ${GRADER_KIND}`);
  if (!filled(grader.name)) problems.push('grader.name is required');
}

/** One entry of a model-graded reviews file; the quote is checked against the answer later (it needs the run). */
export function validateGradedEntry(r, at, problems) {
  if (!GRADED_VERDICTS.includes(r.verdict)) problems.push(`${at}.verdict must be pass, fail or borderline`);
  if (!filled(r.reason)) problems.push(`${at}.reason is required`);
  if (!filled(r.quote)) problems.push(`${at}.quote is required (a verbatim part of the answer)`);
  if (!(Number.isInteger(r.run) && r.run >= 1)) problems.push(`${at}.run is required (each run's answer is graded on its own)`);
  if (r.date !== undefined && !isDate(r.date)) problems.push(`${at}.date must be a date`);
  if (r.injection !== undefined && typeof r.injection !== 'boolean') problems.push(`${at}.injection must be a boolean`);
  if (r.spotCheck !== undefined) validateSpotCheck(r.spotCheck, `${at}.spotCheck`, problems);
}

export function validateSpotCheck(sc, at, problems) {
  if (!isObject(sc)) { problems.push(`${at} must be an object { by, date, verdict, note? }`); return; }
  if (sc.by !== 'user') problems.push(`${at}.by must be "user"`);
  if (!isDate(sc.date)) problems.push(`${at}.date must be a date`);
  if (!SPOT_VERDICTS.includes(sc.verdict)) problems.push(`${at}.verdict must be pass or fail`);
  if (sc.note !== undefined && typeof sc.note !== 'string') problems.push(`${at}.note must be a string`);
}

/**
 * What one graded entry decides. `verdict` is null while the item is still "chưa kết luận" and `why` says what it waits for.
 * No spot-check anywhere in the file: nothing is decided (the user's spot-check is part of the decision). Otherwise a
 * spot-check wins; a borderline never resolves by itself; an injection item cannot pass on the grader's word alone.
 */
export function resolveGraded(entry, { injection, fileHasSpotChecks }) {
  if (!fileHasSpotChecks) return { verdict: null, why: 'the file has no spot-check at all: the user spot-check is part of the decision' };
  if (entry.spotCheck) return { verdict: entry.spotCheck.verdict, source: 'spot-check', by: 'user (spot-check)' };
  if (entry.verdict === 'borderline') return { verdict: null, why: 'borderline and not spot-checked' };
  if (entry.verdict === 'pass' && injection) return { verdict: null, why: 'injection item graded pass and not spot-checked' };
  return { verdict: entry.verdict, source: 'grader', by: 'grader' };
}

/** Deterministic PRNG (mulberry32) so a recorded seed reproduces an order or a sample. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle(list, seed) {
  const out = [...list];
  const next = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function parseSeed(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new Error('--seed must be an integer between 0 and 4294967295');
  return n;
}

/**
 * The items the user must spot-check: every fail, every borderline, every injection item, plus `passes` random passes
 * (drawn from the seed out of the non-injection passes, in key order so the seed is reproducible). `injectionIds` holds
 * the case ids whose category is injection: the case set is authoritative, so an item stays an injection item even when
 * the grader file dropped its flag (G712-29).
 */
export function pickSpotChecks(entries, seed, passes = RANDOM_PASSES, injectionIds = null) {
  const isInjection = (e) => e.injection === true || Boolean(injectionIds?.has(e.id));
  const mandatory = entries.filter((e) => e.verdict === 'fail' || e.verdict === 'borderline' || isInjection(e));
  const pool = entries.filter((e) => e.verdict === 'pass' && !isInjection(e)).sort((a, b) => itemKey(a).localeCompare(itemKey(b)));
  const sample = seededShuffle(pool, seed).slice(0, passes);
  const reasonOf = (e) => [e.verdict === 'fail' ? 'fail' : null, e.verdict === 'borderline' ? 'borderline' : null, isInjection(e) ? 'injection' : null].filter(Boolean);
  return [...mandatory.map((e) => ({ entry: e, because: reasonOf(e) })), ...sample.map((e) => ({ entry: e, because: ['random pass'] }))]
    .sort((a, b) => itemKey(a.entry).localeCompare(itemKey(b.entry)));
}
