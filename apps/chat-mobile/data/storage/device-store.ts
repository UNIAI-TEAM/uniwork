// The phone's durable key-value store for what must outlive the process: the
// unsent messages (stores/chat-send-store.ts), the queued reads, reactions and
// votes (stores/pending-ops-store.ts) and the cached rooms and messages
// (query-persister.ts). The encrypted MMKV behind it (native-device-store.ts)
// is installed at boot by app/_layout.tsx, so this module, and every store
// built on it, stays importable by the node tests; until it is installed (and
// in those tests) the store lives in memory and nothing persists.

export interface DeviceStore {
  /** False for a store that keeps nothing past this launch: what is queued on it is lost on a kill. */
  readonly durable: boolean;
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): boolean;
  /** Every key the store holds (the query cache sweeps the timelines it no longer keeps). */
  keys(): string[];
}

/** A store that keeps nothing past this launch. */
export function memoryDeviceStore(): DeviceStore {
  const values = new Map<string, string>();
  return {
    durable: false,
    getString: (key) => values.get(key),
    set: (key, value) => void values.set(key, value),
    remove: (key) => values.delete(key),
    keys: () => [...values.keys()],
  };
}

let open: () => Promise<DeviceStore> = () => Promise.resolve(memoryDeviceStore());
let opening: Promise<DeviceStore> | null = null;

/** Boot (or a test): where the store comes from. Must run before the first read. */
export function installDeviceStore(opener: () => Promise<DeviceStore>): void {
  open = opener;
  opening = null;
}

/** The one store of this launch; every caller shares it. */
export function openDeviceStore(): Promise<DeviceStore> {
  opening ??= open();
  return opening;
}

/** zustand's persist storage over the device store (stores/chat-send-store.ts, stores/pending-ops-store.ts). */
export const deviceStateStorage = {
  getItem: async (name: string): Promise<string | null> => (await openDeviceStore()).getString(name) ?? null,
  setItem: async (name: string, value: string): Promise<void> => (await openDeviceStore()).set(name, value),
  removeItem: async (name: string): Promise<void> => void (await openDeviceStore()).remove(name),
};
