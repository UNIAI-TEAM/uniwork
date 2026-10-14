import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

function walkGo(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "vendor" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkGo(p, out);
    else if (e.name.endsWith(".go") && !e.name.endsWith("_test.go")) out.push(p);
  }
  return out;
}

function goSourceWithoutComments(src) {
  const clean = src.split("");
  const codeAt = new Uint8Array(src.length);
  let state = "code";

  for (let i = 0; i < src.length; i += 1) {
    const current = src[i];
    const next = src[i + 1];

    if (state === "line-comment") {
      if (current === "\n") {
        state = "code";
      } else {
        clean[i] = " ";
      }
      continue;
    }
    if (state === "block-comment") {
      if (current === "*" && next === "/") {
        clean[i] = " ";
        clean[i + 1] = " ";
        i += 1;
        state = "code";
      } else if (current !== "\n") {
        clean[i] = " ";
      }
      continue;
    }
    if (state !== "code") {
      if (state !== "raw-string" && current === "\\") {
        codeAt[i + 1] = 0;
        i += 1;
      } else if (
        (state === "string" && current === '"') ||
        (state === "rune" && current === "'") ||
        (state === "raw-string" && current === "`")
      ) {
        state = "code";
      }
      continue;
    }

    if (current === "/" && next === "/") {
      clean[i] = " ";
      clean[i + 1] = " ";
      i += 1;
      state = "line-comment";
    } else if (current === "/" && next === "*") {
      clean[i] = " ";
      clean[i + 1] = " ";
      i += 1;
      state = "block-comment";
    } else if (current === '"') {
      state = "string";
    } else if (current === "'") {
      state = "rune";
    } else if (current === "`") {
      state = "raw-string";
    } else {
      codeAt[i] = 1;
    }
  }

  return { clean: clean.join(""), codeAt };
}

function skipWhitespace(src, start) {
  let i = start;
  while (i < src.length && /\s/.test(src[i])) i += 1;
  return i;
}

function keyLiteralAt(src, start) {
  if (src[start] === "`") {
    const end = src.indexOf("`", start + 1);
    return end === -1 ? null : { value: src.slice(start + 1, end), end: end + 1 };
  }
  if (src[start] !== '"') return null;
  for (let i = start + 1; i < src.length; i += 1) {
    if (src[i] === "\\") {
      i += 1;
    } else if (src[i] === '"') {
      return { value: src.slice(start + 1, i), end: i + 1 };
    } else if (src[i] === "\n" || src[i] === "\r") {
      return null;
    }
  }
  return null;
}

function hasOneDefaultArgument(src, codeAt, start) {
  const stack = [];
  const topLevelCommas = [];
  const pairs = { "(": ")", "[": "]", "{": "}" };

  for (let i = start; i < src.length; i += 1) {
    if (codeAt[i] !== 1) continue;
    const current = src[i];
    if (current in pairs) {
      stack.push(pairs[current]);
    } else if (current === ")" && stack.length === 0) {
      let end = i;
      if (topLevelCommas.length > 1) return false;
      if (topLevelCommas.length === 1) {
        const trailingComma = topLevelCommas[0];
        if (src.slice(trailingComma + 1, end).trim() !== "") return false;
        end = trailingComma;
      }
      return src.slice(start, end).trim() !== "";
    } else if (current === ")" || current === "]" || current === "}") {
      if (stack.pop() !== current) return false;
    } else if (current === "," && stack.length === 0) {
      topLevelCommas.push(i);
    }
  }
  return false;
}

function isUnqualifiedAt(src, codeAt, start) {
  let i = start - 1;
  while (i >= 0 && /\s/.test(src[i])) i -= 1;
  return i < 0 || codeAt[i] !== 1 || src[i] !== ".";
}

function envKeysFromGo(src) {
  const { clean, codeAt } = goSourceWithoutComments(src);
  const reader = /(?<![A-Za-z0-9_.])(?:os\s*\.\s*(?:Getenv|LookupEnv)|getenv|envInt)(?![A-Za-z0-9_])/g;
  const keys = new Set();
  for (const match of clean.matchAll(reader)) {
    if (codeAt[match.index] !== 1 || !isUnqualifiedAt(clean, codeAt, match.index)) continue;

    const readerName = match[0].replaceAll(/\s/g, "");
    let cursor = skipWhitespace(clean, match.index + match[0].length);
    if (clean[cursor] !== "(") continue;
    cursor = skipWhitespace(clean, cursor + 1);

    const key = keyLiteralAt(clean, cursor);
    if (!key || !/^[A-Z][A-Z0-9_]{2,}$/.test(key.value)) continue;
    cursor = skipWhitespace(clean, key.end);

    if (readerName === "getenv") {
      if (clean[cursor] !== ",") continue;
      cursor = skipWhitespace(clean, cursor + 1);
      if (!hasOneDefaultArgument(clean, codeAt, cursor)) continue;
    } else {
      if (clean[cursor] === ",") cursor = skipWhitespace(clean, cursor + 1);
      if (clean[cursor] !== ")") continue;
    }
    keys.add(key.value);
  }
  return keys;
}

function missingEnvKeys(example, goSources) {
  const documented = new Set(
    [...example.matchAll(/^#?\s?([A-Z][A-Z0-9_]+)=/gm)].map((match) => match[1]),
  );
  const keys = new Set();
  for (const src of goSources) {
    for (const key of envKeysFromGo(src)) keys.add(key);
  }
  return [...keys].filter((key) => !documented.has(key)).sort();
}

test("the Go env scanner recognizes literal readers without false positives", () => {
  const keys = [...envKeysFromGo(`
package probe

func read(dynamicKey string) {
  _ = os.Getenv("DIRECT_GETENV")
  _, _ = os.LookupEnv(
    "LOOKUP_SPACED",
  )
  _, _ = envInt(
    "ENV_INT_MULTILINE",
  )
  _ = getenv("HELPER_WITH_DEFAULT", "fallback")
  _ = getenv("HELPER_EXPRESSION_DEFAULT", fallback("x", nested()))
  _ = getenv(
    "HELPER_TRAILING_COMMA",
    "fallback",
  )
  _ = os.Getenv(\`RAW_GETENV\`)
  _, _ = os.LookupEnv(
    \`RAW_LOOKUP\`,
  )
  _, _ = envInt(\`RAW_ENV_INT\`)
  _ = getenv(\`RAW_HELPER\`, \`fallback\`)
  _ = os.Getenv(dynamicKey)
  _ = custom.Getenv("QUALIFIED_CUSTOM")
  _ = custom . os.Getenv("SPACED_QUALIFIED_CUSTOM")
  _ = Getenv("BARE_GETENV")
  _, _ = custom.LookupEnv("QUALIFIED_LOOKUP")
  _, _ = custom.envInt("QUALIFIED_ENV_INT")
  _, _ = custom . envInt("SPACED_QUALIFIED_ENV_INT")
  _ = custom.getenv("QUALIFIED_HELPER", "fallback")
  _ = os.Getenv("CONCATENATED_KEY" + suffix)
  _, _ = os.LookupEnv("LOOKUP_EXTRA_ARG", fallback)
  _, _ = envInt("ENV_INT_EXTRA_ARG", fallback)
  _ = getenv("MISSING_DEFAULT")
  _ = getenv("EMPTY_DEFAULT", )
  _ = getenv("TOO_MANY_DEFAULTS", "one", "two")
  _ = os.LookupEnv("UNFINISHED_LOOKUP"
  _ = os.Getenv(\`RAW_CONCATENATED\` + suffix)
  _ = custom.Getenv(\`RAW_QUALIFIED\`)
  _ = os.Getenv(rawKey)
  _ = os.Getenv(\`invalid_raw_key\`)
  // _ = os.Getenv("COMMENTED_LINE")
  // _ = os.Getenv(\`RAW_COMMENTED_LINE\`)
  /*
  _, _ = os.LookupEnv("COMMENTED_BLOCK")
  */
  _ = forgetenv("SUFFIX_IDENTIFIER")
  _ = \`os.Getenv("STRING_LITERAL")\`
  _ = "os.Getenv(\`RAW_STRING_CONTENT\`)"
}
`)].sort();

  assert.deepEqual(keys, [
    "DIRECT_GETENV",
    "ENV_INT_MULTILINE",
    "HELPER_EXPRESSION_DEFAULT",
    "HELPER_TRAILING_COMMA",
    "HELPER_WITH_DEFAULT",
    "LOOKUP_SPACED",
    "RAW_ENV_INT",
    "RAW_GETENV",
    "RAW_HELPER",
    "RAW_LOOKUP",
  ]);
  assert.equal(keys.includes(undefined), false);
});

test("raw literal keys participate in the undocumented-variable contract", () => {
  const source =
    "package probe\nfunc read() { _ = os.Getenv(`DOCUMENTED_RAW`); _, _ = os.LookupEnv(`UNDOCUMENTED_RAW`) }\n";
  assert.deepEqual(missingEnvKeys("DOCUMENTED_RAW=\n", [source]), ["UNDOCUMENTED_RAW"]);
});

// .env.example claims to list every variable the server reads ("anything not
// listed is not a knob"). This keeps the claim true: every direct environment
// key read in non-test Go code appears as a line the operator can uncomment.
test("every variable the server reads is documented in .env.example", () => {
  const example = fs.readFileSync(path.join(root, ".env.example"), "utf8");
  const sources = walkGo(path.join(root, "server")).map((file) => fs.readFileSync(file, "utf8"));
  const missing = missingEnvKeys(example, sources);
  assert.deepEqual(missing, [], `add these to .env.example: ${missing.join(", ")}`);
});
