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
