import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nativeTarget, rustTargetTriple } from './build-upstream.mjs';

// F-X2: the native record names the CPU cargo built for (the toolchain's host,
// or CARGO_BUILD_TARGET for a cross build), in Node's arch names, because
// packaging compares it with process.arch / --arch.
const rustc = (host) => () => `rustc 1.80.0 (abcdef 2026-01-01)\nbinary: rustc\nhost: ${host}\nrelease: 1.80.0\n`;

test('the recorded arch is the rustc host, whatever arch Node runs as', () => {
  assert.deepEqual(nativeTarget({}, rustc('aarch64-pc-windows-msvc')), { triple: 'aarch64-pc-windows-msvc', arch: 'arm64' });
  assert.deepEqual(nativeTarget({}, rustc('x86_64-unknown-linux-gnu')), { triple: 'x86_64-unknown-linux-gnu', arch: 'x64' });
  assert.equal(nativeTarget({}, rustc('i686-pc-windows-msvc')).arch, 'ia32');
});

test('CARGO_BUILD_TARGET wins over the host for a cross build', () => {
  assert.equal(rustTargetTriple({ CARGO_BUILD_TARGET: ' aarch64-apple-darwin ' }, rustc('x86_64-pc-windows-msvc')), 'aarch64-apple-darwin');
  assert.deepEqual(nativeTarget({ CARGO_BUILD_TARGET: 'aarch64-apple-darwin' }, rustc('x86_64-pc-windows-msvc')), { triple: 'aarch64-apple-darwin', arch: 'arm64' });
});

test('an unknown or unreadable triple records no arch instead of a guess', () => {
  assert.deepEqual(nativeTarget({}, rustc('riscv64gc-unknown-linux-gnu')), { triple: 'riscv64gc-unknown-linux-gnu', arch: null });
  assert.deepEqual(nativeTarget({}, () => ''), { triple: null, arch: null });
});
