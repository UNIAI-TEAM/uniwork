#!/usr/bin/env node
// DOC-002 (UNI-666) - build the verified engine bundle used by engine-backed fixtures.
//
// The pinned GenOffice checkout carries no node_modules on this machine, so the
// bundle is built from a source tree that is byte-identical to the pin
// (bootstrap-source) with dependencies resolved from that frozen tree. Every
// bundled input that belongs to the repository is compared against the pinned
// checkout before its hash is recorded, so a drifted build tree cannot mint a
// "pinned" record.
//
//   node scripts/office-g0/engine-bundle-build.mjs \
//     --pinned <pinned-genoffice> --deps-source <frozen-tree-with-node_modules> \
//     --entry packages/docx-engine/src/index.ts --out <bundle.cjs> --record <build.json>
//
// Exports are checked so a bundle that cannot serve the fixture generators fails
// here instead of at fixture time.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
const sha256File = (file) => sha256(fs.readFileSync(file));

function parseArgs(argv) {
  const out = { entry: null, requireExport: [] };
  const takesValue = ['--pinned', '--deps-source', '--entry', '--out', '--record', '--require-export'];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!takesValue.includes(a)) {
      if (a === '--help' || a === '-h') { out.help = true; continue; }
      throw new Error('unknown argument: ' + a);
    }
    const value = argv[++i];
    if (a === '--require-export') out.requireExport.push(value);
    else out[a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }
  return out;
}

/** Repository-relative inputs of the esbuild metafile, dependencies excluded. */
export function repoInputsOf(metafile, depsSource) {
  const root = path.resolve(depsSource);
  const inputs = [];
  for (const key of Object.keys(metafile.inputs)) {
    const abs = path.resolve(root, key);
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (rel.startsWith('..') || rel.includes('node_modules/') || key.startsWith('<')) continue;
    inputs.push({ abs, rel });
  }
  return inputs.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

/** Every bundled repository input must be byte-identical to the pinned checkout. */
export function checkPinnedMatch(inputs, pinnedRoot) {
  const problems = [];
  const records = [];
  for (const input of inputs) {
    const pinnedFile = path.join(pinnedRoot, input.rel);
    if (!fs.existsSync(pinnedFile)) {
      problems.push('bundled input ' + input.rel + ' has no file at the pinned checkout');
      continue;
    }
    const buildHash = sha256File(input.abs);
    const pinnedHash = sha256File(pinnedFile);
    if (buildHash !== pinnedHash) problems.push('bundled input ' + input.rel + ' differs from the pinned checkout');
    records.push({ path: input.rel, sha256: buildHash, pinnedSha256: pinnedHash });
  }
  return { problems, records };
}

export function pinOf(pinnedDir) {
  return execFileSync('git', ['-C', pinnedDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

export async function buildEngineBundle({ pinned, depsSource, entry, out, record, requireExport }) {
  if (fs.existsSync(out) || fs.existsSync(record)) throw new Error('refusing to overwrite an existing bundle or record: ' + out);
  const sourceRequire = createRequire(path.join(depsSource, 'package.json'));
  const { build } = sourceRequire('esbuild');
  const result = await build({
    absWorkingDir: depsSource,
    ...(entry
      ? { entryPoints: [entry] }
      : {
          // The repository index does not re-export its zip dependency, and the
          // fixture generators canonicalise ZIP metadata through it, so the
          // bundle is minted from a synthetic entry that re-exports both.
          stdin: {
            contents: "export * from './packages/docx-engine/src/index.ts';\nexport { default as JSZip } from 'jszip';\n",
            resolveDir: depsSource,
            sourcefile: '<docx-engine-with-jszip>',
            loader: 'ts',
          },
        }),
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    write: false,
    logLevel: 'warning',
    external: ['electron'],
    nodePaths: [path.join(depsSource, 'node_modules')],
    metafile: true,
  });
  const output = result.outputFiles[0];
  for (const name of requireExport) {
    if (!output.text.includes(name)) throw new Error('bundle does not contain the required export: ' + name);
  }
  const { problems, records } = checkPinnedMatch(repoInputsOf(result.metafile, depsSource), pinned);
  if (problems.length) throw new Error('bundle inputs do not match the pinned checkout:\n' + problems.join('\n'));
  const lock = path.join(pinned, 'package-lock.json');
  if (!fs.existsSync(lock)) throw new Error('pinned checkout has no package-lock.json at ' + lock);

  const buildRecord = {
    schemaVersion: 1,
    kind: 'uniwork-office-engine-bundle-build',
    issue: 'UNI-666',
    pin: pinOf(pinned),
    entry,
    builtFrom: path.basename(depsSource),
    bundleSha256: sha256(output.contents),
    lockSha256: sha256File(lock),
    inputs: records,
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.mkdirSync(path.dirname(record), { recursive: true });
  fs.writeFileSync(out, output.contents);
  fs.writeFileSync(record, JSON.stringify(buildRecord, null, 2) + '\n');
  return { out, record, bytes: output.contents.length, bundleSha256: buildRecord.bundleSha256, lockSha256: buildRecord.lockSha256, inputs: records.length, pin: buildRecord.pin };
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help || !args.pinned || !args.depsSource || !args.out || !args.record) {
    process.stdout.write('usage: node engine-bundle-build.mjs --pinned <dir> --deps-source <dir> --out <bundle> --record <json> [--entry <rel>] [--require-export <name>]\n');
    process.exit(args.help ? 0 : 2);
  }
  const summary = await buildEngineBundle({
    pinned: path.resolve(args.pinned),
    depsSource: path.resolve(args.depsSource),
    entry: args.entry,
    out: path.resolve(args.out),
    record: path.resolve(args.record),
    requireExport: args.requireExport,
  });
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main(process.argv.slice(2));
