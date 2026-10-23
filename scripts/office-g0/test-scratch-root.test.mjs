import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveTestScratchRoot,
  TEST_AUTHORIZED_ROOT_ENV,
  TEST_SCRATCH_OWNER_ENV,
  TEST_SCRATCH_ROOT_ENV,
} from './test-scratch-root.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function identityFs() {
  return {
    existsSync: () => true,
    statSync: () => ({ isDirectory: () => true }),
    realpathSync: (value) => path.resolve(value),
  };
}

test('default refuses an ordinary or nested discovered parent outside authorization before mkdir', () => {
  const authorized = path.resolve('D:/owned/checkout');
  for (const discovered of [path.resolve('D:/owned'), path.resolve('D:/owned/workspace')]) {
    let mkdirCalls = 0;
    assert.throws(() => resolveTestScratchRoot({
      repoRoot: authorized,
      workspaceRoot: discovered,
      env: {},
      fsImpl: { ...identityFs(), mkdirSync: () => { mkdirCalls++; } },
    }), /refusing test scratch before mutation/);
    assert.equal(mkdirCalls, 0);
  }
});

test('a discovered workspace inside explicit authorization has an in-root default scratch path', () => {
  const authorized = path.resolve('D:/owned/isolated');
  const discovered = path.join(authorized, 'workspace');
  assert.equal(resolveTestScratchRoot({
    repoRoot: path.join(discovered, 'checkout'),
    workspaceRoot: discovered,
    env: { [TEST_AUTHORIZED_ROOT_ENV]: authorized },
    fsImpl: identityFs(),
  }), path.join(discovered, '.uniwork-dev', 'uni-668-lab-test'));
});

test('a paired explicit scratch override must remain beneath its authorized owner', () => {
  const authorized = path.resolve('D:/owned/isolated');
  const owner = path.join(authorized, 'workspace');
  const repoRoot = path.join(owner, 'checkout');
  const common = { repoRoot, workspaceRoot: owner, fsImpl: identityFs() };
  const env = {
    [TEST_AUTHORIZED_ROOT_ENV]: authorized,
    [TEST_SCRATCH_ROOT_ENV]: path.join(owner, 'scratch'),
    [TEST_SCRATCH_OWNER_ENV]: owner,
  };
  assert.equal(resolveTestScratchRoot({ ...common, env }), env[TEST_SCRATCH_ROOT_ENV]);
  assert.throws(() => resolveTestScratchRoot({
    ...common,
    env: { ...env, [TEST_SCRATCH_ROOT_ENV]: path.resolve(authorized, '..', 'escape') },
  }), /strict child/);
  assert.throws(() => resolveTestScratchRoot({
    ...common,
    env: { [TEST_AUTHORIZED_ROOT_ENV]: authorized, [TEST_SCRATCH_ROOT_ENV]: path.join(owner, 'scratch') },
  }), /must be set together/);
});

test('real junction and lexical escapes are refused; an authorized child remains valid', (t) => {
  const root = fs.mkdtempSync(path.join(HERE, '.uni668-v4-owner-'));
  const outside = fs.mkdtempSync(path.join(HERE, '.uni668-v4-outside-'));
  const junction = path.join(root, 'junction');
  try {
    try {
      fs.symlinkSync(outside, junction, 'junction');
    } catch (error) {
      if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
        t.skip('junction creation is unavailable for this account');
        return;
      }
      throw error;
    }
    const repoRoot = path.join(root, 'workspace', 'checkout');
    fs.mkdirSync(repoRoot, { recursive: true });
    const common = { repoRoot, workspaceRoot: path.dirname(repoRoot) };
    const baseEnv = { [TEST_AUTHORIZED_ROOT_ENV]: root };
    assert.throws(() => resolveTestScratchRoot({
      ...common,
      env: { ...baseEnv, [TEST_SCRATCH_ROOT_ENV]: path.join(junction, 'scratch'), [TEST_SCRATCH_OWNER_ENV]: root },
    }), /strict child/);
    assert.throws(() => resolveTestScratchRoot({
      ...common,
      env: { ...baseEnv, [TEST_SCRATCH_ROOT_ENV]: path.join(root, '..', 'escape'), [TEST_SCRATCH_OWNER_ENV]: root },
    }), /strict child/);
    assert.equal(resolveTestScratchRoot({ ...common, env: baseEnv }), path.join(root, 'workspace', '.uniwork-dev', 'uni-668-lab-test'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
