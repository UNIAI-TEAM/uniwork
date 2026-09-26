import fs from 'node:fs';
import path from 'node:path';

export const TEST_SCRATCH_ROOT_ENV = 'OFFICE_G0_LAB_TEST_SCRATCH_ROOT';
export const TEST_SCRATCH_OWNER_ENV = 'OFFICE_G0_LAB_TEST_SCRATCH_OWNER_ROOT';
export const TEST_AUTHORIZED_ROOT_ENV = 'OFFICE_G0_LAB_TEST_AUTHORIZED_ROOT';

function physicalPath(target, fsImpl) {
  let existing = path.resolve(target);
  const missing = [];
  while (!fsImpl.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return path.resolve(target);
    missing.unshift(path.basename(existing));
    existing = parent;
  }
  return path.resolve(fsImpl.realpathSync(existing), ...missing);
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}

export function resolveTestScratchRoot({ repoRoot, workspaceRoot, env = process.env, fsImpl = fs } = {}) {
  if (!repoRoot || !workspaceRoot) throw new Error('test repository and discovered workspace roots are required');
  const override = String(env[TEST_SCRATCH_ROOT_ENV] || '').trim();
  const explicitOwner = String(env[TEST_SCRATCH_OWNER_ENV] || '').trim();
  if (Boolean(override) !== Boolean(explicitOwner)) {
    throw new Error(TEST_SCRATCH_ROOT_ENV + ' and ' + TEST_SCRATCH_OWNER_ENV + ' must be set together');
  }

  // Discovery selects launcher layout; this separate root grants test write scope.
  const authorizedRoot = path.resolve(String(env[TEST_AUTHORIZED_ROOT_ENV] || repoRoot));
  const authorizedReal = physicalPath(authorizedRoot, fsImpl);
  const discovered = path.resolve(workspaceRoot);
  const discoveredReal = physicalPath(discovered, fsImpl);
  if (!isInside(authorizedRoot, discovered) || !isInside(authorizedReal, discoveredReal)) {
    throw new Error(
      'refusing test scratch before mutation: discovered workspace root ' + discovered +
      ' is outside authorized root ' + authorizedRoot +
      '; use an isolated replica inside the authorized root and set ' + TEST_AUTHORIZED_ROOT_ENV,
    );
  }

  const owner = path.resolve(explicitOwner || authorizedRoot);
  const root = override
    ? path.resolve(override)
    : path.join(discovered, '.uniwork-dev', 'uni-668-lab-test');
  if (!fsImpl.existsSync(owner) || !fsImpl.statSync(owner).isDirectory()) {
    throw new Error('test scratch owner must be an existing directory: ' + owner);
  }

  const ownerReal = physicalPath(owner, fsImpl);
  const rootReal = physicalPath(root, fsImpl);
  if (!isInside(authorizedRoot, owner) || !isInside(authorizedReal, ownerReal) ||
      root === owner || !isInside(owner, root) || rootReal === ownerReal || !isInside(ownerReal, rootReal)) {
    throw new Error('test scratch root must be a strict child of its authorized owner: ' + root);
  }
  return root;
}
