// Apache-2.0. Uses the pinned GenOffice builders; never synthesizes feature XML.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export const upstreamCommit = '09485f884dc845cf3bf27fb7edfe489f9d457aad';
export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
export const inputs = JSON.parse(fs.readFileSync(new URL('./advanced-docx-inputs.json', import.meta.url), 'utf8'));

// JSZip assigns wall-clock timestamps, including inside the embedded workbook.
// Canonical packaging changes no XML, relationships, workbook values or feature data.
export async function canonicalZip(bytes, JSZip) {
  const source = await JSZip.loadAsync(bytes);
  const output = new JSZip();
  for (const name of Object.keys(source.files).sort()) {
    const part = source.files[name];
    if (part.dir) continue;
    let content = await part.async('uint8array');
    if (name.endsWith('.xlsx')) content = await canonicalZip(content, JSZip);
    output.file(name, content, { date: new Date(inputs.savedAt), createFolders: false });
  }
  return output.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 }, platform: 'DOS' });
}

export function paragraph(text, options = {}) {
  return { kind: 'generated', block: { type: 'paragraph', runs: [{ text }], ...options } };
}

export async function generate(engine) {
  const { buildBlankDocx, parseDocx, saveDocx, JSZip } = engine;
  const blank = await parseDocx(await buildBlankDocx());
  const chart = await saveDocx(blank, [
    paragraph(inputs.chartBody[0], { type: 'heading', level: 1 }),
    paragraph(inputs.chartBody[1]),
    { kind: 'chart', chart: inputs.chart, extentPx: { w: 480, h: 288 } },
    paragraph(inputs.chartBody[2]),
  ], { savedAt: inputs.savedAt });
  const watermark = await saveDocx(blank, [
    paragraph(inputs.watermarkBody[0], { type: 'heading', level: 1 }),
    paragraph(inputs.watermarkBody[1]),
    paragraph(inputs.watermarkBody[2], { type: 'heading', level: 1, format: { pageBreakBefore: true } }),
    paragraph(inputs.watermarkBody[3]),
  ], { savedAt: inputs.savedAt, watermark: inputs.watermark });
  return {
    'docx-chart.docx': await canonicalZip(chart, JSZip),
    'docx-watermark.docx': await canonicalZip(watermark, JSZip),
  };
}

export async function main(argv) {
  if (argv.length !== 6) throw new Error('Expected three named arguments');
  const args = Object.fromEntries(Array.from({ length: argv.length / 2 }, (_, i) => [argv[i * 2], argv[i * 2 + 1]]));
  if (!args['--engine'] || !args['--record'] || !args['--out'] || Object.keys(args).some((k) => !['--engine', '--record', '--out'].includes(k))) {
    throw new Error('Usage: --engine <verified-engine.cjs> --record <build.json> --out <owned-output-directory>');
  }
  const enginePath = path.resolve(args['--engine']);
  const build = JSON.parse(fs.readFileSync(path.resolve(args['--record']), 'utf8'));
  if (build.pin !== upstreamCommit || build.bundleSha256 !== sha256(fs.readFileSync(enginePath)) ||
      build.lockSha256 !== 'DE782E49A1006FAC7287A41C748C696EFD9FB3C3038EAE893EF82DFCA57F9FE5' ||
      !Array.isArray(build.inputs) || !build.inputs.some((i) => i.path.endsWith('docx-engine/src/patch.ts')) ||
      build.inputs.some((i) => !i.path.startsWith('node_modules/') && i.pinnedSha256 !== i.sha256)) {
    throw new Error('Engine bundle does not match the pinned build record');
  }
  const engine = createRequire(import.meta.url)(enginePath);
  const output = path.resolve(args['--out']);
  const fixtures = await generate(engine);
  fs.mkdirSync(output, { recursive: true });
  const records = [];
  for (const [name, bytes] of Object.entries(fixtures)) {
    const target = path.join(output, name);
    if (fs.existsSync(target) && sha256(fs.readFileSync(target)) !== sha256(bytes)) {
      throw new Error(`Refusing to overwrite different fixture bytes: ${target}`);
    }
    fs.writeFileSync(target, bytes);
    records.push({ name, bytes: bytes.length, sha256: sha256(bytes), upstreamCommit });
  }
  console.log(JSON.stringify(records, null, 2));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main(process.argv.slice(2));
