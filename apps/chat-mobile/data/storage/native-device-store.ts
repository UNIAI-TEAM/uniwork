// The device store on the phone (device-store.ts): MMKV, encrypted with
// AES-256 under a random key kept in the Keychain / Keystore (after first
// unlock, this device only), so the file alone, a backup or another phone
// reads nothing. Opening never fails: without a key or the native module the
// store lives in memory for this launch and nothing persists (logged), which
// is the app as it was before the outbox was durable.
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { createMMKV } from "react-native-mmkv";
import { createLogger } from "../logger";
import { memoryDeviceStore, type DeviceStore } from "./device-store";

const KEY_NAME = "uniwork_chat_store_key";
const ACCESS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
/** 32 characters: AES-256 reads the first 32 bytes of the key. */
const KEY_LENGTH = 32;
const KEY_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const log = createLogger("device-store");

async function encryptionKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY_NAME, ACCESS);
  if (existing?.length === KEY_LENGTH) return existing;
  // 6 random bits per character: 192 bits of key.
  const bytes = await Crypto.getRandomBytesAsync(KEY_LENGTH);
  const key = Array.from(bytes, (byte) => KEY_ALPHABET[byte & 63]).join("");
  await SecureStore.setItemAsync(KEY_NAME, key, ACCESS);
  return key;
}

export async function openNativeDeviceStore(): Promise<DeviceStore> {
  try {
    const key = await encryptionKey();
    return createMMKV({ id: "uniwork-chat", encryptionKey: key, encryptionType: "AES-256" });
  } catch (error) {
    log.warn("device store unavailable, nothing persists this launch", { error: error instanceof Error ? error.name : typeof error });
    return memoryDeviceStore();
  }
}
