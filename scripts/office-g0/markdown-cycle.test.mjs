import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { MarkdownSourceBuffer } from './markdown-source-buffer.ts';
import { discoverMarkdownSources } from '../../e2e/office-g0/lab-markdown-sources.mjs';
import { createLabServer } from '../../e2e/office-g0/lab-server.mjs';

async function freePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

test('source bytes, failed saves and edits during save remain recoverable', () => {
  const buffer = new MarkdownSourceBuffer();
  const original = '\uFEFF---\r\ntitle: Ti\u1ebfng Vi\u1ec7t\r\n---\r\n\r\n| a | b |\r\n|---|---|\r\n| 1 | 2 |';
  buffer.set(original);
  assert.equal(buffer.read(() => 'normalized'), original);
  assert.equal(buffer.edit('first\nsecond'), 'first\r\nsecond');
  buffer.set(original);
  const pending = buffer.snapshot();
  buffer.set(original + '\r\n\n```js\nconst x = 1;\n```');
  assert.equal(buffer.unchanged(pending), false);
  assert.match(buffer.read(() => ''), /const x = 1/);
  const retry = buffer.snapshot();
  assert.equal(buffer.unchanged(retry), true);
  buffer.invalidate();
  assert.equal(buffer.read(() => 'rich edit'), 'rich edit');
});

test('relative images and attachment links resolve without including code or external authorities', () => {
  const text = '![a](assets/a.png) [notes](assets/notes.txt#section) [ref][n]\n[n]: <assets/more%20notes.txt>\n`[no](assets/no.txt)`\n```md\n[x](assets/code.txt)\n```\n[x](https://example.test/x.txt) [x](../escape.txt) [x](assets/%2e%2e/escape.txt)';
  assert.deepEqual(discoverMarkdownSources(text), ['assets/a.png', 'assets/notes.txt', 'assets/more notes.txt']);
});

test('disk save and distinct reopen preserve exact UTF-8, attachments and reject cross-view/path writes', async () => {
  const root = await mkdtemp(join(process.env.OFFICE_G0_TEST_TMP, 'markdown-'));
  await mkdir(join(root, 'fixtures', 'assets'), { recursive: true });
  await mkdir(join(root, 'builds'));
  const text = '# Ti\u1ebfng Vi\u1ec7t\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nconst n = 1;\n```\n\n[notes](assets/notes.txt)\n![image](assets/dot.png)\n';
  await writeFile(join(root, 'fixtures', 'sample.md'), text);
  await writeFile(join(root, 'fixtures', 'assets', 'notes.txt'), 'immutable attachment');
  await writeFile(join(root, 'fixtures', 'assets', 'dot.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  const port = await freePort();
  const previewPort = await freePort();
  const server = createLabServer({ port, previewPort, buildsDir: join(root, 'builds'), fixturesDir: join(root, 'fixtures'), labDir: join(root, 'lab') });
  await server.listen();
  server.dispatch = async (channel, payload) => {
    const response = await fetch(`http://127.0.0.1:${port}/lab/${channel}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${port}` }, body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error + ': ' + data.message);
    return data.result;
  };
  try {
    const a = await server.dispatch('lab:session-open', { app: 'markdown', path: join(root, 'fixtures', 'sample.md') });
    const saved = await server.dispatch('host:text-save', { viewId: a.viewId, text: text + '\nSaved \u0111\u1eb9p.\n', imageSources: [] });
    assert.equal(saved.ok, true);
    assert.equal(await readFile(saved.path, 'utf8'), text + '\nSaved \u0111\u1eb9p.\n');
    assert.equal(await readFile(join(resolve(saved.path, '..'), 'assets', 'notes.txt'), 'utf8'), 'immutable attachment');
    const current = server.sessions.requireView(a.viewId);
    current.savePath = join(saved.path, 'blocked.md');
    await assert.rejects(server.dispatch('host:text-save', { viewId: a.viewId, text: 'retry edit' }), /write|ENOTDIR|EEXIST/i);
    assert.equal(await readFile(saved.path, 'utf8'), text + '\nSaved \u0111\u1eb9p.\n');
    current.savePath = saved.path;
    const retried = await server.dispatch('host:text-save', { viewId: a.viewId, text: text + '\nSaved \u0111\u1eb9p.\n' });
    assert.equal(retried.sha256, saved.sha256);
    const opaque = await fetch(`http://127.0.0.1:${port}/lab/host:text-save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'null' },
      body: JSON.stringify({ viewId: a.viewId, text: 'forbidden' }),
    });
    assert.equal(opaque.status, 403);
    await server.dispatch('lab:session-close', { viewId: a.viewId });
    const b = await server.dispatch('lab:session-open', { app: 'markdown', path: saved.path });
    assert.notEqual(a.viewId, b.viewId);
    assert.equal(b.hash, saved.sha256);
    assert.deepEqual(await server.dispatch('host:markdown-read-link', { viewId: b.viewId, href: 'assets/notes.txt#section' }), { name: 'notes.txt', text: 'immutable attachment' });
    await assert.rejects(server.dispatch('host:markdown-read-link', { viewId: b.viewId, href: '../escape.txt' }), /travers|outside/i);
    const htmlView = await server.dispatch('lab:session-open', { app: 'html', path: null });
    await assert.rejects(server.dispatch('host:markdown-read-link', { viewId: htmlView.viewId, href: 'assets/notes.txt' }), /wrong_view/);
    const htmlFixture = join(root, 'fixtures', 'sample.html');
    await writeFile(htmlFixture, '<p>Existing HTML</p>');
    const htmlFileView = await server.dispatch('lab:session-open', { app: 'html', path: htmlFixture });
    const htmlSaved = await server.dispatch('host:text-save', { viewId: htmlFileView.viewId, text: '<img src="assets/dot.png">', imageSources: ['assets/notes.txt'] });
    assert.deepEqual(await readFile(join(resolve(htmlSaved.path, '..'), 'assets', 'dot.png')), Buffer.from('89504e470d0a1a0a', 'hex'));
    await assert.rejects(readFile(join(resolve(htmlSaved.path, '..'), 'assets', 'notes.txt')), /ENOENT/);
    for (const app of ['docs', 'pdf', 'slides', 'sheets']) {
      const other = await server.dispatch('lab:session-open', { app, path: null });
      await assert.rejects(server.dispatch('host:markdown-read-link', { viewId: other.viewId, href: 'assets/notes.txt' }), /wrong_view/);
      await assert.rejects(server.dispatch('host:text-save', { viewId: other.viewId, text: 'wrong channel' }), /wrong_view/);
    }
    assert.equal(await server.dispatch('host:text-read', { viewId: b.viewId, path: b.workingPath }), text + '\nSaved \u0111\u1eb9p.\n');
    const c = await server.dispatch('lab:session-open', { app: 'markdown', path: null });
    assert.throws(() => server.sessions.requireWriteGrant(c.viewId, saved.path), /grant|view|write/i);
    assert.throws(() => server.sessions.requireWriteGrant(b.viewId, join(root, 'escape.md')), /grant|root|write/i);
    await assert.rejects(server.dispatch('host:text-save', { viewId: a.viewId, text: 'stale' }), /view/i);
    assert.equal(await readFile(join(root, 'fixtures', 'sample.md'), 'utf8'), text);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
