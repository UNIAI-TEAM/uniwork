// Lab-only fault boundary. Original host, transport and pinned engine are unchanged.
import { resolve } from 'node:path';
import { createHost, startServer } from './engine-host.mts';

const args = process.argv.slice(2);
const arg = (name: string): string => { const i = args.indexOf('--' + name); if (i < 0 || !args[i + 1]) throw new Error('missing ' + name); return args[i + 1]; };
const source = resolve(arg('source'));
const lab = resolve(arg('lab'));
const prebundle = resolve(arg('prebundle'));
const host = createHost(source, lab, prebundle);
const held = new Map<string, { result: Record<string, unknown>; release: () => void }>();

startServer({
  async handle(route, input) {
    if (route === '/fault/status') {
      const item = held.get(String(input.viewId));
      return { held: Boolean(item), result: item?.result ?? null, pid: process.pid };
    }
    if (route === '/fault/release') {
      const item = held.get(String(input.viewId));
      if (!item) throw new Error('no held result');
      held.delete(String(input.viewId));
      item.release();
      return { released: true, pid: process.pid };
    }
    const result = await host.handle(route, input) as Record<string, unknown>;
    if (route === '/engine/ping') return { ...result, g48: { pid: process.pid, started: startedAt, seam: 'after-real-DOCX-result-before-HTTP-response' } };
    if (route !== '/engine/docx-edit') return result;
    if (input.__g48_fault === 'hold') {
      await new Promise<void>((done) => { held.set(String(input.viewId), { result, release: done }); });
    }
    if (input.__g48_fault === 'checksum') {
      const checksum = String(result.persistedHash);
      return { ...result, persistedHash: (checksum[0] === '0' ? '1' : '0') + checksum.slice(1) };
    }
    return result;
  },
  close: () => host.close(),
}, Number(arg('port')));
const startedAt = new Date().toISOString();
