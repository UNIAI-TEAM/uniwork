#!/usr/bin/env node
// G7-12-SCHEMA offline what-if (UNI-1964): validates every write call a recorded holdout run actually made against the
// REAL genoffice tool schemas, with no model call and no spend. It answers "what would the real schemas have said about
// the calls C6 made under the hollow name-only surface?" — it never re-grades model behaviour (the model saw hollow
// schemas, so its choices are the hollow-surface choices; a cross/other success rate derived offline would be a different
// measurement wearing the C6 numbers).
//
//   node scripts/office/g5g6g7/holdout-schema-whatif.mjs --runs <session dir> [--schemas <file>] [--groups other,cross] [--out <file>]
//
// Reads run-NN.json of one session folder, takes every ask whose group is in --groups, validates each `writeLog[]` entry's
// arguments against the schema the committed file carries for that tool, and prints counts only: entries, violating
// entries, ask-instances, case ids and the violated keys. Nothing of a case (question, expected answer, reply) is read
// or printed — only ids, counts and key names — so the holdout stays blind.
//
// The rule is the declared shape at the top level of the arguments: every `required` key of the tool's schema is present,
// and no key outside the schema's `properties` is sent (a key the schema does not declare). This is the rule the survey
// used (survey.md Q5) and it reproduces its finding exactly; a full JSON-Schema reading (recursive types, enums,
// minItems) finds a few more entries, and the report carries that count beside it for reference.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { TOOL_OPS } from './holdout-backend.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const DEFAULT_SCHEMAS_FILE = path.join(repoRoot, 'docs/office/g5g6g7/genoffice-tool-schemas.json');
export const DEFAULT_GROUPS = ['other', 'cross'];

/** The schema (function.parameters) the file carries for one module/tool, or null when the file does not offer it. */
export function schemaOf(schemasDoc, module, name) {
  const tools = schemasDoc?.[module] ?? [];
  return tools.find((t) => t.function?.name === name)?.function?.parameters ?? null;
}

/** The module a write call belongs to: the first module of the ask that maps the tool name, as the backend resolves it. */
export function moduleOfWrite(ask, name) {
  const modules = ask.modules ?? [];
  for (const module of modules) if (TOOL_OPS[module]?.[name]) return module;
  for (const module of Object.keys(TOOL_OPS)) if (TOOL_OPS[module][name]) return module;
  return modules[0] ?? null;
}

/** The declared-shape violations of one call: a missing required key, or a key the schema's properties do not declare. */
export function declaredShapeViolations(schema, args) {
  const out = [];
  if (!schema || typeof schema !== 'object' || args === null || typeof args !== 'object' || Array.isArray(args)) return out;
  const properties = schema.properties ?? {};
  for (const key of schema.required ?? []) if (!(key in args)) out.push({ kind: 'missing required', key });
  for (const key of Object.keys(args)) if (!(key in properties)) out.push({ kind: 'unexpected', key });
  return out;
}

const jsonType = (v) =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'boolean' ? 'boolean' : typeof v === 'number' ? 'number' : typeof v === 'string' ? 'string' : 'object';

/**
 * The strict JSON-Schema reading of one call (types, enums, minItems/maxItems, required, additionalProperties:false),
 * walked into declared properties. Reported beside the declared-shape count, never instead of it.
 */
export function strictViolations(schema, value, at = '$') {
  const out = [];
  if (!schema || typeof schema !== 'object') return out;
  const types = schema.type === undefined ? null : [].concat(schema.type);
  if (types && !types.some((t) => t === jsonType(value) || (t === 'number' && jsonType(value) === 'number'))) {
    return [{ kind: 'type', key: at }];
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) out.push({ kind: 'enum', key: at });
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) if (!(key in value)) out.push({ kind: 'missing required', key });
    for (const [key, child] of Object.entries(value)) {
      if (key in properties) out.push(...strictViolations(properties[key], child, `${at}.${key}`));
      else if (schema.additionalProperties === false) out.push({ kind: 'unexpected', key });
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') out.push(...strictViolations(schema.additionalProperties, child, `${at}.${key}`));
    }
  }
  if (Array.isArray(value)) {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) out.push({ kind: 'minItems', key: at });
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) out.push({ kind: 'maxItems', key: at });
    if (schema.items && typeof schema.items === 'object') value.forEach((item, i) => out.push(...strictViolations(schema.items, item, `${at}[${i}]`)));
  }
  return out;
}

const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);

/**
 * Validates every write call of the given groups in one session's run files. Returns counts only:
 * entries, violating entries, ask-instances (id + lang + run), case ids, and the violated keys per module/tool.
 */
export function validateSession({ runsDir, schemasDoc, groups = DEFAULT_GROUPS }) {
  const wanted = new Set(groups);
  const files = fs.readdirSync(runsDir).filter((f) => /^run-\d+\.json$/.test(f)).sort();
  const byTool = new Map();
  const violatedKeys = new Map();
  const askInstances = new Set();
  const caseIds = new Set();
  const strictInstances = new Set();
  let entries = 0;
  let violations = 0;
  let strictEntries = 0;
  for (const file of files) {
    const doc = JSON.parse(fs.readFileSync(path.join(runsDir, file), 'utf8'));
    for (const ask of doc.asks ?? []) {
      if (!wanted.has(ask.group)) continue;
      for (const entry of ask.writeLog ?? []) {
        entries += 1;
        const module = moduleOfWrite(ask, entry.name);
        const schema = schemaOf(schemasDoc, module, entry.name);
        const found = declaredShapeViolations(schema, entry.args);
        const strict = strictViolations(schema, entry.args);
        if (strict.length > 0) {
          strictEntries += 1;
          strictInstances.add(`${ask.id}/${ask.lang}/${doc.runIndex ?? file}`);
        }
        if (found.length === 0) continue;
        violations += 1;
        const toolKey = `${module}/${entry.name}`;
        bump(byTool, toolKey);
        for (const v of found) bump(violatedKeys, `${toolKey} ${v.kind} ${v.key}`);
        askInstances.add(`${ask.id}/${ask.lang}/${doc.runIndex ?? file}`);
        caseIds.add(ask.id);
      }
    }
  }
  return {
    files: files.length, entries, violations, askInstances: askInstances.size, caseIds: [...caseIds].sort(),
    strict: { entries: strictEntries, askInstances: strictInstances.size },
    byTool: Object.fromEntries([...byTool.entries()].sort()),
    violatedKeys: Object.fromEntries([...violatedKeys.entries()].sort()),
  };
}

/** The markdown the report reads: counts only, no case text. */
export function renderWhatif(result, { runsDir, schemasFile, groups, schemasSha256 }) {
  const out = [];
  const w = (line = '') => out.push(line);
  w('# G7-12-SCHEMA offline what-if');
  w();
  w('> **Trạng thái:** in-progress (G7-12-SCHEMA step 5, UNI-1964). No paid model run: this validates recorded C6 calls offline.');
  w();
  w('Validates every write call the recorded C6 runs made in the `other` and `cross` groups against the real genoffice');
  w('tool schemas, with no model call and no spend. It shows what the hollow name-only surface let through; it is **not** a');
  w('re-grade of model behaviour.');
  w();
  w('| what | value |');
  w('| --- | --- |');
  w(`| runs dir | \`${runsDir}\` |`);
  w(`| schemas file | \`${schemasFile}\` |`);
  w(`| schemas sha256 | \`${schemasSha256}\` |`);
  w(`| groups | ${groups.join(', ')} |`);
  w(`| run files | ${result.files} |`);
  w();
  w('## Result (declared shape)');
  w();
  w('Rule: every `required` key of the tool schema is present, and no key outside the schema\'s `properties` is sent.');
  w();
  w('| measure | count |');
  w('| --- | ---: |');
  w(`| write-log entries | ${result.entries} |`);
  w(`| entries that violate the real schema | ${result.violations} |`);
  w(`| ask-instances (id + lang + run) | ${result.askInstances} |`);
  w(`| case ids | ${result.caseIds.length} |`);
  w();
  w(`Case ids: ${result.caseIds.map((id) => `\`${id}\``).join(', ')}`);
  w();
  w('| module/tool | violating entries |');
  w('| --- | ---: |');
  for (const [key, count] of Object.entries(result.byTool)) w(`| \`${key}\` | ${count} |`);
  w();
  w('| violated key | count |');
  w('| --- | ---: |');
  for (const [key, count] of Object.entries(result.violatedKeys)) w(`| \`${key}\` | ${count} |`);
  w();
  w('## Strict JSON-Schema reading (for reference)');
  w();
  w(`A full reading (recursive types, enums, minItems/maxItems) finds ${result.strict.entries} violating entries in ${result.strict.askInstances} ask-instances, a little more than the declared-shape rule; the declared-shape figure is the one the survey reported.`);
  w();
  return `${out.join('\n')}\n`;
}

export function parseArgs(argv) {
  const args = { groups: DEFAULT_GROUPS, schemas: DEFAULT_SCHEMAS_FILE };
  const need = (i) => { if (argv[i + 1] === undefined) throw new Error(`${argv[i]} needs a value`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--runs') args.runs = path.resolve(need(i++));
    else if (flag === '--schemas') args.schemas = path.resolve(need(i++));
    else if (flag === '--groups') args.groups = need(i++).split(',').filter(Boolean);
    else if (flag === '--out') args.out = path.resolve(need(i++));
    else if (flag === '--help' || flag === '-h') args.help = true;
    else throw new Error(`unknown argument ${flag}`);
  }
  if (args.help) return args;
  if (!args.runs) throw new Error('--runs <session dir> is required (the folder holding run-NN.json)');
  return args;
}

const HELP = `Usage: node scripts/office/g5g6g7/holdout-schema-whatif.mjs --runs <session dir> [--schemas <file>] [--groups other,cross] [--out <file>]
Validates every write call of the given groups in the recorded run files against the real genoffice tool schemas, offline.
Prints counts only (entries, violations, ask-instances, case ids, violated keys); --out writes the markdown report.
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(HELP); return; }
  const schemasBytes = fs.readFileSync(args.schemas);
  const schemasDoc = JSON.parse(schemasBytes.toString('utf8'));
  const schemasSha256 = (await import('node:crypto')).createHash('sha256').update(schemasBytes).digest('hex');
  const result = validateSession({ runsDir: args.runs, schemasDoc, groups: args.groups });
  const md = renderWhatif(result, { runsDir: args.runs, schemasFile: args.schemas, groups: args.groups, schemasSha256 });
  if (args.out) fs.writeFileSync(args.out, md, 'utf8');
  process.stdout.write(`${JSON.stringify({ entries: result.entries, violations: result.violations, askInstances: result.askInstances, caseIds: result.caseIds, byTool: result.byTool, violatedKeys: result.violatedKeys })}\n`);
  if (args.out) process.stdout.write(`what-if written to ${args.out}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`${err?.stack ?? err}\n`);
    process.exit(1);
  });
}
