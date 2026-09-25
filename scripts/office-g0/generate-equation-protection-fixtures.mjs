// Apache-2.0. Synthetic inputs; feature XML is produced by the pinned GenOffice engine.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export const upstreamCommit = '09485f884dc845cf3bf27fb7edfe489f9d457aad';
export const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
export const inputs = JSON.parse(fs.readFileSync(new URL('./equation-protection-inputs.json', import.meta.url), 'utf8'));
export const paragraph = (text, options = {}) => ({ kind: 'generated', block: { type: 'paragraph', runs: [{ text }], ...options } });

export function protectionOf(input = inputs.protection) {
  const { edit, enforced, hash, salt, spinCount, algorithmSid } = input;
  return { edit, enforced, hash, salt, spinCount, algorithmSid };
}

// Normalize ZIP order/timestamps only; all engine-generated part contents stay intact.
export async function canonicalZip(bytes, JSZip) {
  const source = await JSZip.loadAsync(bytes);
  const output = new JSZip();
  for (const name of Object.keys(source.files).sort()) {
    if (source.files[name].dir) continue;
    output.file(name, await source.files[name].async('uint8array'), { date: new Date(inputs.savedAt), createFolders: false });
  }
  return output.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 }, platform: 'DOS' });
}

export async function generate(engine) {
  const { buildBlankDocx, parseDocx, saveDocx, latexToOmml, mathParagraphXml, verifyProtectionPassword, JSZip } = engine;
  const protection = protectionOf();
  if (!protection.hash || !protection.salt || protection.spinCount !== 100000 || protection.algorithmSid !== 14 ||
      !(await verifyProtectionPassword(inputs.protection.password, protection))) throw new Error('Invalid retained protection input');
  const blank = await parseDocx(await buildBlankDocx());
  const [eqTitle, eqBefore, eqAfter] = inputs.equation.body;
  const equation = await saveDocx(blank, [
    paragraph(eqTitle, { type: 'heading', level: 1 }), paragraph(eqBefore),
    { kind: 'xml', xml: mathParagraphXml(latexToOmml(inputs.equation.latex), inputs.equation.alignment) },
    paragraph(eqAfter),
  ], { savedAt: inputs.savedAt });
  const protectedDoc = await saveDocx(blank, inputs.protection.body.map((text, i) => paragraph(text, i === 0 ? { type: 'heading', level: 1 } : {})), {
    savedAt: inputs.savedAt, protection,
  });
  return { 'docx-equation.docx': await canonicalZip(equation, JSZip), 'docx-protected.docx': await canonicalZip(protectedDoc, JSZip) };
}

export function loadEngine(engineFile, recordFile) {
  const build = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
  const required = ['parse.ts', 'patch.ts', 'math.ts', 'protection.ts', 'blank.ts'];
  if (build.pin !== upstreamCommit || build.bundleSha256 !== sha256(fs.readFileSync(engineFile)) ||
      build.lockSha256 !== 'DE782E49A1006FAC7287A41C748C696EFD9FB3C3038EAE893EF82DFCA57F9FE5' ||
      !Array.isArray(build.inputs) || required.some((name) => !build.inputs.some((item) => item.path === `packages/docx-engine/src/${name}`)) ||
      build.inputs.some((item) => !item.path.startsWith('node_modules/') && item.pinnedSha256 !== item.sha256)) {
    throw new Error('Engine bundle does not match pinned build record');
  }
  return createRequire(import.meta.url)(path.resolve(engineFile));
}

export async function main(argv) {
  const names = ['--engine', '--record', '--out'];
  if (argv.length !== 6 || new Set([argv[0], argv[2], argv[4]]).size !== 3 ||
      [argv[0], argv[2], argv[4]].some((arg) => !names.includes(arg))) throw new Error('Usage: --engine <bundle> --record <build.json> --out <owned-directory>');
  const args = Object.fromEntries([[argv[0], argv[1]], [argv[2], argv[3]], [argv[4], argv[5]]]);
  const engine = loadEngine(args['--engine'], args['--record']);
  const output = path.resolve(args['--out']);
  const fixtures = await generate(engine);
  // Check every target first to prevent a conflict from leaving a partial batch.
  for (const [name, bytes] of Object.entries(fixtures)) {
    const target = path.join(output, name);
    if (fs.existsSync(target) && sha256(fs.readFileSync(target)) !== sha256(bytes)) throw new Error(`Refusing to overwrite different fixture bytes: ${target}`);
  }
  fs.mkdirSync(output, { recursive: true });
  const result = [];
  for (const [name, bytes] of Object.entries(fixtures)) {
    fs.writeFileSync(path.join(output, name), bytes);
    result.push({ name, bytes: bytes.length, sha256: sha256(bytes), upstreamCommit });
  }
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main(process.argv.slice(2));
