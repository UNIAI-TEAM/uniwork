// Per-job uid sandbox (G2-05). The supervisor forks every worker under one uid
// from a fixed pool - one uid per worker slot, so at most one live worker ever
// runs as a given uid - and the job's temp dir is chowned to that uid with
// mode 0700 before the worker starts. A compromised worker can then read or
// write only its own job dir: a sibling job's dir is another uid's 0700 dir,
// and the temp root (owned by the service uid, never world-writable) grants
// it nothing outside.
//
// This needs setuid: it engages only on Linux as uid 0 (the image runs the
// supervisor as root for exactly this; the compose profile then drops every
// capability the supervisor does not need). OFFICE_ENGINE_SANDBOX=required
// makes a host that cannot honour it refuse to start. On Windows dev hosts it
// stays off and the suite skips - the container test stage is the evidence.

import { chmod, chown, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { ConfigError, type SandboxConfig } from "./config.ts";

export interface WorkerIdentity {
  /** 0..maxWorkers-1; uid = uidBase + slot. */
  slot: number;
  uid: number;
  gid: number;
}

export class WorkerSandbox {
  private readonly free: number[] = [];
  private readonly used = new Set<number>();

  private constructor(
    private readonly config: SandboxConfig,
    slots: number,
    private readonly on: boolean,
  ) {
    for (let slot = slots - 1; slot >= 0; slot--) this.free.push(slot);
  }

  static create(config: SandboxConfig, slots: number): WorkerSandbox {
    const on =
      config.mode !== "off" &&
      process.platform === "linux" &&
      typeof process.geteuid === "function" &&
      process.geteuid() === 0;
    if (config.mode === "required" && !on) {
      throw new ConfigError("OFFICE_ENGINE_SANDBOX=required but the uid pool cannot engage (needs Linux and uid 0)");
    }
    return new WorkerSandbox(config, slots, on);
  }

  /** Whether the uid drop engages on this host. */
  get active(): boolean {
    return this.on;
  }

  /** Take the slot this job's worker will run as. Null when the sandbox is
   * off; callers pass undefined uid/gid to fork then. The dispatch gate
   * (active < maxWorkers) keeps the pool from ever running dry. */
  acquire(): WorkerIdentity | null {
    if (!this.on) return null;
    const slot = this.free.pop();
    if (slot === undefined) throw new Error("worker slot pool exhausted");
    this.used.add(slot);
    return { slot, uid: this.config.uidBase + slot, gid: this.config.gidBase + slot };
  }

  release(identity: WorkerIdentity | null): void {
    if (!identity || !this.used.delete(identity.slot)) return;
    this.free.push(identity.slot);
  }

  /** The temp root stays service-owned but must let a slot uid traverse to its
   * own dir: 0711 = crossable, not listable, never writable. */
  async prepareRoot(root: string): Promise<void> {
    if (!this.on) return;
    await mkdir(root, { recursive: true });
    await chmod(root, 0o711);
  }

  /** Hand a fresh job dir (created by the supervisor as root) to the slot uid:
   * 0700 owned by the worker before its process is spawned. */
  async adopt(dir: string, identity: WorkerIdentity): Promise<void> {
    await chmod(dir, 0o700);
    await chown(dir, identity.uid, identity.gid);
    for (const name of await readdir(dir)) {
      await chown(join(dir, name), identity.uid, identity.gid);
    }
  }
}
