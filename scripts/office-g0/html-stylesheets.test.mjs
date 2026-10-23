import test, { after } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createLabServer } from '../../e2e/office-g0/lab-server.mjs';
import { previewCsp } from '../../e2e/office-g0/lab-preview.mjs';
import { discoverHtmlStylesheets } from '../../e2e/office-g0/lab-html-stylesheets.mjs';

const q = mkdtempSync(path.join(process.env.OFFICE_G0_TEST_TMP ?? tmpdir(), 'html-stylesheets-'));
mkdirSync(path.join(q, 'fixtures/text/assets'), { recursive: true });
mkdirSync(path.join(q, 'builds'), { recursive: true });
const fixture = '<!DOCTYPE html><html><head><link rel="stylesheet" href="assets/site.css"></head><body><h1>HTML \u0110</h1><img src="assets/fixture-image.png"></body></html>\n';
for (const name of ['html-local-asset.html', 'html-single-file.html']) writeFileSync(path.join(q, 'fixtures/text', name), fixture);
writeFileSync(path.join(q, 'fixtures/text/assets/site.css'), 'body { color: #1f2328; }');
writeFileSync(path.join(q, 'fixtures/text/assets/notes.txt'), 'not an allowed copied stylesheet');
writeFileSync(path.join(q, 'fixtures/text/assets/fixture-image.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
after(() => fs.rm(q, { recursive: true, force: true }));
const lab = createLabServer({ buildsDir: path.join(q, 'builds'), labDir: path.join(q, 'test-runtime'), fixturesDir: path.join(q, 'fixtures'), port: 5676, previewPort: 5677 });
const open = async (fixture) => lab.handlers['lab:session-open'](null, { app: 'html', path: path.join(q, 'fixtures/text', fixture) });
const ctx = (view) => ({ viewId: view.viewId, session: lab.sessions.requireView(view.viewId), app: 'html' });
test('save and distinct reopen preserve exact UTF8 source and required local assets', async () => {
  const view = await open('html-local-asset.html');
  const source = await fs.readFile(path.join(q, 'fixtures/text/html-local-asset.html'), 'utf8');
  const edited = source.replace('</h1>', ' G48</h1>');
  const saved = await lab.handlers['host:text-save'](ctx(view), { text: edited, imageSources: [], mode: 'save' });
  assert.equal(await fs.readFile(saved.path, 'utf8'), edited);
  assert.deepEqual(await fs.readFile(path.join(path.dirname(saved.path), 'assets/fixture-image.png')), await fs.readFile(path.join(q, 'fixtures/text/assets/fixture-image.png')));
  assert.deepEqual(await fs.readFile(path.join(path.dirname(saved.path), 'assets/site.css')), await fs.readFile(path.join(q, 'fixtures/text/assets/site.css')));
  await lab.handlers['lab:session-close'](ctx(view));
  const reopened = await lab.handlers['lab:session-open'](null, { app: 'html', path: saved.path });
  assert.notEqual(reopened.viewId, view.viewId);
  assert.equal(reopened.hash, saved.sha256);
  assert.equal(await fs.readFile(reopened.workingPath, 'utf8'), edited);
});
test('preview permits styles only from its own asset prefix', () => {
  const csp = previewCsp('http://127.0.0.1:5676', 'http://127.0.0.1:5677/token/');
  assert.match(csp, /style-src 'unsafe-inline' http:\/\/127\.0\.0\.1:5677\/token\//);
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /script-src 'unsafe-inline' 'unsafe-eval'/);
});
test('view ownership and traversal reject cross-view and escaped output writes', async () => {
  const a = await open('html-single-file.html'), b = await open('html-single-file.html');
  const target = path.join(lab.sessions.requireView(b.viewId).outputDir, 'other.html');
  assert.throws(() => lab.sessions.requireWriteGrant(a.viewId, target), /view|grant/);
  assert.throws(() => lab.sessions.requireReadAsset(a.viewId, '../../fixture-manifest.json'), /traverse/);
  const before = await fs.readFile(a.workingPath);
  await assert.rejects(lab.handlers['host:text-save'](ctx(a), { text: 42 }), /serialized document/);
  assert.deepEqual(await fs.readFile(a.workingPath), before);
});
test('stylesheet discovery ignores inert markup and preserves first attribute semantics', () => {
  const html = `<!-- <link rel="stylesheet" href="comment.css"> -->
    <script>const s = '<link rel="stylesheet" href="script.css">';</script>
    <style>/* <link rel="stylesheet" href="style.css"> */</style>
    <textarea><link rel="stylesheet" href="textarea.css"></textarea>
    <div title='<link rel="stylesheet" href="attribute.css">'></div>
    <LINK HREF='assets/a&amp;b.css' REL='alternate stylesheet'>
    <link rel=stylesheet href=assets/site.css>
    <link rel="icon" href="favicon.css">
    <link rel="stylesheet" href="first.css" href="second.css">
    <link rel="stylesheet" href="first.css">`;
  assert.deepEqual(discoverHtmlStylesheets(html), ['assets/a&b.css', 'assets/site.css', 'first.css']);
  assert.deepEqual(discoverHtmlStylesheets('<script>unclosed <link rel=stylesheet href=x.css>'), []);
  assert.deepEqual(discoverHtmlStylesheets('<plaintext><link rel=stylesheet href=x.css>'), []);
});
test('HTML CSS support cannot copy arbitrary types or traversal and does not extend Markdown', async () => {
  const view = await open('html-local-asset.html');
  const source = '<link rel="stylesheet" href="../escape.css"><link rel="stylesheet" href="assets/notes.txt">';
  const saved = await lab.handlers['host:text-save'](ctx(view), { text: source, mode: 'save' });
  assert.equal(saved.assets.preserved.length, 0);
  assert.equal(saved.assets.skipped.length, 2);
  assert.equal(await fs.readFile(saved.path, 'utf8'), source);
  const markdown = await lab.handlers['lab:session-open'](null, { app: 'markdown', path: path.join(q, 'fixtures/text/html-local-asset.html') });
  const md = await lab.handlers['host:text-save']({ ...ctx(markdown), app: 'markdown' }, { text: '<link rel="stylesheet" href="assets/site.css">', imageSources: ['assets/site.css'] });
  assert.equal(md.assets.preserved.length, 0);
  assert.equal(md.assets.skipped[0].reason, 'not_an_image');
});
