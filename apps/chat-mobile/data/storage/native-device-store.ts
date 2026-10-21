// The device store on the phone (device-store.ts): MMKV, encrypted with
// AES-256 under a random key kept in the Keychain / Keystore (after first
// unlock, this device only), so the file alone, a backup or another phone
// reads nothing. Opening never fails, but it never loses data in silence
// either (audit "device-store-key-fallback"):
//   - a Keychain read that throws (the phone not unlocked since boot, a
//     Keystore hiccup) is tried again before anything else happens;
//   - a key that is gone while the store's file is still there (a restore
//     onto another phone, a cleared Keystore) can never decrypt that file:
//     it is deleted on purpose, reported, and a new key starts an empty store,
//     instead of a new key opened over unreadable bytes;
//   - without a key or the native module at all, the launch runs on memory
//     (device-store.ts › memoryDeviceStore, `durable: false`): what is queued
//     this launch is lost on a kill, so it is reported, not only logged.
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { createMMKV, deleteMMKV, existsMMKV, type MMKV } from "react-native-mmkv";
import { createLogger } from "../logger";
import { reportError } from "../report";
import { memoryDeviceStore, type DeviceStore } from "./device-store";

const KEY_NAME = "uniwork_chat_store_key";
const STORE_ID = "uniwork-chat";
const ACCESS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
/** 32 characters: AES-256 reads the first 32 bytes of the key. */
const KEY_LENGTH = 32;
const KEY_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
/** Keychain reads before the launch gives up on the disk: 0.5 s, then 1 s between them (the splash holds up to 8 s). */
export const KEY_READ_ATTEMPTS = 3;
const KEY_RETRY_MS = 500;

const log = createLogger("device-store");

export interface NativeStoreDeps {
  wait: (ms: number) => Promise<void>;
}

const defaultDeps: NativeStoreDeps = { wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };

/** The stored key, read again on a throw; the last error is rethrown. */
async function readKey(deps: NativeStoreDeps): Promise<string | null> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await SecureStore.getItemAsync(KEY_NAME, ACCESS);
    } catch (error) {
      if (attempt >= KEY_READ_ATTEMPTS) throw error;
      log.warn("device store key not read, trying again", { attempt });
      await deps.wait(KEY_RETRY_MS * attempt);
    }
  }
}

async function newKey(): Promise<string> {
  // 6 random bits per character: 192 bits of key.
  const bytes = await Crypto.getRandomBytesAsync(KEY_LENGTH);
  const key = Array.from(bytes, (byte) => KEY_ALPHABET[byte & 63]).join("");
  await SecureStore.setItemAsync(KEY_NAME, key, ACCESS);
  return key;
}

/** The key that opens the store's file; a file no key can open any more is removed first, and said so. */
async function encryptionKey(deps: NativeStoreDeps): Promise<string> {
  const existing = await readKey(deps);
  if (existing?.length === KEY_LENGTH) return existing;
  if (existsMMKV(STORE_ID)) {
    deleteMMKV(STORE_ID);
    reportError(new Error("device_store_key_lost"), { source: "device-store", tags: { outcome: "file_deleted" } });
  }
  return newKey();
}

function mmkvStore(mmkv: MMKV): DeviceStore {
  return {
    durable: true,
    getString: (key) => mmkv.getString(key),
    set: (key, value) => mmkv.set(key, value),
    remove: (key) => mmkv.remove(key),
    keys: () => mmkv.getAllKeys(),
  };
}

export async function openNativeDeviceStore(deps: NativeStoreDeps = defaultDeps): Promise<DeviceStore> {
  try {
    const key = await encryptionKey(deps);
    return mmkvStore(createMMKV({ id: STORE_ID, encryptionKey: key, encryptionType: "AES-256" }));
  } catch (error) {
    log.warn("device store unavailable, nothing persists this launch", { error: error instanceof Error ? error.name : typeof error });
    reportError(error instanceof Error ? error : new Error("device_store_unavailable"), { source: "device-store", tags: { outcome: "memory" } });
    return memoryDeviceStore();
  }
}
