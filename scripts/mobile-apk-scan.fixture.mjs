// Test fixture for scripts/mobile-apk-scan.mjs: dex files built in memory, so a test proves the dex check on
// archives it makes itself (a real release dex comes only from a Gradle or EAS build).

/**
 * A minimal dex file: the header fields the scan reads, string_ids, type_ids and one class_def per `defined`
 * descriptor; `referenced` descriptors get a type id and no class_def, as a class another one only calls.
 */
export function fakeDex(defined, referenced = []) {
  const strings = [...new Set([...defined, ...referenced])].sort();
  const stringIds = 0x70;
  const typeIds = stringIds + 4 * strings.length;
  const classDefs = typeIds + 4 * strings.length;
  let data = classDefs + 32 * defined.length;
  const chunks = [];
  const head = Buffer.alloc(data);
  head.write("dex\n035\0", 0, "latin1");
  head.writeUInt32LE(strings.length, 56);
  head.writeUInt32LE(stringIds, 60);
  head.writeUInt32LE(strings.length, 64);
  head.writeUInt32LE(typeIds, 68);
  head.writeUInt32LE(defined.length, 96);
  head.writeUInt32LE(classDefs, 100);
  strings.forEach((text, i) => {
    if (text.length >= 0x80) throw new Error(`${text}: one uleb128 byte holds lengths under 128`);
    head.writeUInt32LE(data, stringIds + 4 * i);
    head.writeUInt32LE(i, typeIds + 4 * i);
    const bytes = Buffer.concat([Buffer.from([text.length]), Buffer.from(text, "latin1"), Buffer.from([0])]);
    chunks.push(bytes);
    data += bytes.length;
  });
  defined.forEach((text, i) => head.writeUInt32LE(strings.indexOf(text), classDefs + 32 * i));
  return Buffer.concat([head, ...chunks]);
}

const ANDROID_NS = "http://schemas.android.com/apk/res/android";

const varint = (value) => {
  const out = [];
  let rest = value;
  do {
    const low = rest % 128;
    rest = Math.floor(rest / 128);
    out.push(rest > 0 ? low | 0x80 : low);
  } while (rest > 0);
  return Buffer.from(out);
};
const bytesField = (number, payload) => Buffer.concat([varint(number * 8 + 2), varint(payload.length), payload]);
const stringField = (number, text) => bytesField(number, Buffer.from(text, "utf8"));
const varintField = (number, value) => Buffer.concat([varint(number * 8), varint(value)]);

/**
 * An app bundle's base/manifest/AndroidManifest.xml: aapt2's XmlNode protobuf (frameworks/base/tools/aapt2/Resources.proto),
 * with the fields a real one carries around the ones the scan reads (source positions, resource ids, namespace
 * declarations). `element` is { tag, attrs, children }; an attribute named "android:x" sits in the android namespace.
 */
export function protoXml({ tag, attrs = {}, children = [] }) {
  const parts = [];
  if (tag === "manifest") parts.push(bytesField(1, Buffer.concat([stringField(1, "android"), stringField(2, ANDROID_NS)])));
  parts.push(stringField(3, tag));
  for (const [key, value] of Object.entries(attrs)) {
    const android = key.startsWith("android:");
    parts.push(
      bytesField(
        4,
        Buffer.concat([
          ...(android ? [stringField(1, ANDROID_NS)] : []),
          stringField(2, android ? key.slice("android:".length) : key),
          stringField(3, value),
          bytesField(4, varintField(1, 7)),
          ...(android ? [varintField(5, 0x01010003)] : []),
        ]),
      ),
    );
  }
  for (const child of children) parts.push(bytesField(5, protoXml(child)));
  return Buffer.concat([bytesField(1, Buffer.concat(parts)), bytesField(3, Buffer.concat([varintField(1, 1), varintField(2, 4)]))]);
}
