import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const FILES = ["packages/core/i18n/locales/vi.json", "packages/core/i18n/locales/en.json"];

/**
 * Hai khoá trùng tên trong cùng một object là hợp lệ với JSON.parse: bản sau
 * thắng, bản trước biến mất không một lời cảnh báo. Hậu quả là một chuỗi nằm
 * trong file, đọc thấy bằng mắt, sửa được bằng tay, mà không bao giờ hiện ra —
 * và không công cụ nào của repo nói cho bạn biết.
 *
 * `parity.test.ts` không bắt được: nó so sánh SAU khi JSON.parse đã gộp trùng,
 * và hai file thường trùng ở cùng một chỗ nên hai bên vẫn khớp nhau.
 *
 * Phải quét văn bản thô. Một reviver truyền cho JSON.parse cũng vô dụng: nó chỉ
 * chạy sau khi object đã dựng xong, tức là sau khi bản trùng đã bị nuốt.
 *
 * Một chuỗi là KHOÁ khi nó nằm trực tiếp trong một object và ký tự khác khoảng
 * trắng ngay sau nó là dấu hai chấm. Đếm theo từng object, không theo tên khoá
 * toàn cục, vì `title` xuất hiện dưới hàng chục object khác nhau là bình thường.
 */
export function duplicateKeys(source) {
  const stack = [];
  const dups = [];
  const line = (offset) => source.slice(0, offset).split("\n").length;
  let i = 0;

  const readString = (start) => {
    let j = start + 1;
    for (;;) {
      const c = source[j];
      if (c === "\\") {
        j += 2;
        continue;
      }
      if (c === '"') return [source.slice(start + 1, j), j + 1];
      if (j >= source.length) throw new Error("unterminated string");
      j += 1;
    }
  };

  while (i < source.length) {
    const c = source[i];
    if (c === '"') {
      const [text, end] = readString(i);
      let k = end;
      while (k < source.length && /\s/.test(source[k])) k += 1;
      const top = stack[stack.length - 1];
      if (source[k] === ":" && top?.type === "obj") {
        const path = stack.map((f) => f.key).filter(Boolean).join(".");
        const at = `${path ? `${path}.` : ""}${text}`;
        if (top.keys.has(text)) dups.push(`${at} (line ${line(i)}, first at line ${top.keys.get(text)})`);
        else top.keys.set(text, line(i));
        top.pendingKey = text;
        i = k + 1;
        continue;
      }
      i = end;
      continue;
    }
    if (c === "{") {
      const parent = stack[stack.length - 1];
      stack.push({ type: "obj", keys: new Map(), key: parent?.pendingKey });
      if (parent) parent.pendingKey = undefined;
      i += 1;
      continue;
    }
    if (c === "[") {
      const parent = stack[stack.length - 1];
      stack.push({ type: "arr", key: parent?.pendingKey });
      if (parent) parent.pendingKey = undefined;
      i += 1;
      continue;
    }
    if (c === "}" || c === "]") {
      stack.pop();
      i += 1;
      continue;
    }
    i += 1;
  }
  return dups;
}

for (const file of FILES) {
  test(`${file} has no duplicate keys`, () => {
    const dups = duplicateKeys(readFileSync(file, "utf8"));
    assert.deepEqual(dups, [], `duplicate keys in ${file} — the earlier value is silently discarded:\n  ${dups.join("\n  ")}`);
  });
}

/** Một guard chỉ đáng tin khi nó biết kêu. Đây là chỗ chứng minh điều đó. */
test("the scanner reports real duplicates and only those", () => {
  assert.equal(duplicateKeys('{"a":{"x":1,"x":2}}').length, 1, "same object, same key");
  assert.equal(duplicateKeys('{"a":{"b":{"k":1,"k":2}}}').length, 1, "nested object");
  assert.deepEqual(duplicateKeys('{"a":{"x":1},"b":{"x":2}}'), [], "different parents are fine");
  assert.deepEqual(duplicateKeys('{"a":[{"x":1},{"x":2}]}'), [], "sibling array items are fine");
  assert.deepEqual(duplicateKeys('{"a":"x: 1","b":"x: 2"}'), [], "a colon inside a value is not a key");
  assert.deepEqual(duplicateKeys('{"a":"say \\"x\\": no","b":1}'), [], "an escaped quote does not end the string");
});
