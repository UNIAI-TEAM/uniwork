// scripts/mobile-ftl-devices.mjs: the weekly device farm picks real phones by maker from Test Lab's own catalogue.
import assert from "node:assert/strict";
import test from "node:test";
import { deviceFlag, MAX_DEVICES, pickDevices } from "./mobile-ftl-devices.mjs";

const phone = (id, manufacturer, versions, extra = {}) => ({
  id,
  manufacturer,
  form: "PHYSICAL",
  formFactor: "PHONE",
  supportedVersionIds: versions,
  supportedAbis: ["arm64-v8a", "armeabi-v7a", "armeabi"],
  ...extra,
});

test("one phone per maker in market order, each at its newest Android, then the oldest-Android phone", () => {
  const devices = pickDevices([
    phone("a15", "Samsung", ["33", "34"]),
    phone("a05", "samsung", ["31"]),
    phone("redmi", "Xiaomi", ["30", "33"]),
    phone("cph", "OPPO", ["28", "30"]),
    phone("pixel", "Google", ["34", "35"]),
    phone("old", "Motorola", ["23", "26"]),
    phone("tab", "Samsung", ["35"], { formFactor: "TABLET" }),
    phone("emu", "Google", ["35"], { form: "VIRTUAL" }),
    phone("gone", "Vivo", ["33"], { tags: ["deprecated"] }),
  ]);
  assert.deepEqual(devices, [
    { model: "a15", version: "34", maker: "samsung" },
    { model: "redmi", version: "33", maker: "xiaomi" },
    { model: "cph", version: "30", maker: "oppo" },
    { model: "pixel", version: "35", maker: "google" },
    { model: "old", version: "26", maker: "motorola" },
  ]);
});

test("never below the app's floor, never a model twice, never more than the cap", () => {
  assert.deepEqual(pickDevices([phone("ancient", "Samsung", ["21", "23"])]), []);
  const many = ["samsung", "xiaomi", "oppo", "vivo", "google"].map((maker, i) => phone(`${maker}1`, maker, [String(28 + i)]));
  const devices = pickDevices([...many, phone("older", "Nokia", ["26"])]);
  assert.equal(devices.length, MAX_DEVICES);
  assert.equal(new Set(devices.map((d) => d.model)).size, devices.length);
  // The oldest-Android pick is a phone already chosen when it is one: no duplicate.
  assert.deepEqual(pickDevices([phone("only", "Samsung", ["26", "34"])]), [{ model: "only", version: "34", maker: "samsung" }]);
});

// Review P2: the device farm builds arm64-v8a only, and the oldest-Android pick is where the catalogue's 32-bit-only
// low-end and Android Go phones live; one of those would fail the install (INSTALL_FAILED_NO_MATCHING_ABIS) and turn the
// week red for a reason that is not the app's.
test("never a phone that cannot run the arm64-only APKs", () => {
  const devices = pickDevices([
    phone("a15", "Samsung", ["34"]),
    phone("go", "Samsung", ["35"], { supportedAbis: ["armeabi-v7a", "armeabi"] }),
    phone("old32", "Nokia", ["24"], { supportedAbis: ["armeabi-v7a"] }),
    phone("unknown", "Xiaomi", ["35"], { supportedAbis: undefined }),
    phone("old64", "Motorola", ["26"]),
  ]);
  assert.deepEqual(devices, [
    { model: "a15", version: "34", maker: "samsung" },
    { model: "old64", version: "26", maker: "motorola" },
  ]);
});

test("each device is one gcloud flag, in Vietnamese and portrait", () => {
  assert.equal(deviceFlag({ model: "a15", version: "34" }), "--device=model=a15,version=34,locale=vi,orientation=portrait");
});
