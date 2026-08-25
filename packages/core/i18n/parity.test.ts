import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import vi from "./locales/vi.json";

type Dict = { [k: string]: string | Dict };

function flatten(obj: Dict, prefix = "", out: Record<string, string> = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else flatten(v, key, out);
  }
  return out;
}

const VI = flatten(vi as Dict);
const EN = flatten(en as Dict);

/** i18next JSON v4: một khoá đếm được có thể tồn tại dưới dạng `_one`/`_other`. */
const PLURAL = ["_one", "_other", "_zero", "_two", "_few", "_many"];
const stem = (key: string) => {
  const hit = PLURAL.find((s) => key.endsWith(s));
  return hit ? key.slice(0, -hit.length) : key;
};
const stems = (keys: string[]) => new Set(keys.map(stem));

/**
 * PRODUCT.md hứa hai ngôn ngữ ngang nhau. Một khoá thiếu không làm app vỡ — nó
 * lặng lẽ rơi về tiếng Việt giữa một màn hình tiếng Anh, và không ai thấy cho
 * đến khi người dùng thấy. Đây là chỗ duy nhất bắt được điều đó.
 */
describe("vi/en parity", () => {
  const viStems = stems(Object.keys(VI));
  const enStems = stems(Object.keys(EN));

  it("mọi khoá tiếng Việt đều có bản tiếng Anh", () => {
    expect([...viStems].filter((k) => !enStems.has(k)).sort()).toEqual([]);
  });

  it("không có khoá tiếng Anh mồ côi", () => {
    expect([...enStems].filter((k) => !viStems.has(k)).sort()).toEqual([]);
  });

  it("hai bên nội suy cùng một bộ biến", () => {
    const vars = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(",");
    const mismatched: string[] = [];
    for (const [key, viText] of Object.entries(VI)) {
      // So theo stem: `sent_title` (vi) đối với `sent_title_one` (en).
      const enText = EN[key] ?? EN[`${stem(key)}_other`] ?? EN[`${stem(key)}_one`];
      if (enText === undefined) continue;
      if (vars(viText) !== vars(enText)) mismatched.push(`${key}: vi(${vars(viText)}) en(${vars(enText)})`);
    }
    expect(mismatched).toEqual([]);
  });

  it("không có chuỗi tiếng Anh nào bị bỏ trống", () => {
    expect(Object.entries(EN).filter(([, v]) => v.trim() === "").map(([k]) => k)).toEqual([]);
  });
});
