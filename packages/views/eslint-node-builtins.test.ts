// @vitest-environment node
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL(".", import.meta.url));
const eslint = new ESLint({ cwd: root, overrideConfigFile: fileURLToPath(new URL("./eslint.config.mjs", import.meta.url)) });

// The text is linted under a real source path: the type-aware parser rejects a file outside tsconfig.
async function restrictedImportMessages(source: string, file = "office/source-editor-types.ts"): Promise<string[]> {
  const [result] = await eslint.lintText(source, { filePath: `${root}${file}` });
  return result!.messages.filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message);
}

describe("packages/views bans Node built-ins and electron", () => {
  // The first type-aware lint builds the TypeScript program, which takes minutes on a cold checkout.
  beforeAll(async () => {
    await restrictedImportMessages("export {};\n");
  }, 600_000);

  it.each([
    'import { readFile } from "node:fs/promises";',
    'import { join } from "node:path";',
    'import fs from "fs";',
    'import { readFileSync } from "fs/promises";',
    'import path from "path";',
    'import { spawn } from "child_process";',
    'import { app } from "electron";',
    'import { ipcRenderer } from "electron/renderer";',
  ])("rejects %s", async (source) => {
    const messages = await restrictedImportMessages(`${source}\nexport const used = typeof ${/\{ (\w+)|import (\w+)/.exec(source)?.slice(1).find(Boolean)};\n`);
    expect(messages.length).toBeGreaterThan(0);
  });

  it("still lets a views file import react", async () => {
    expect(await restrictedImportMessages('import { useState } from "react";\nexport const used = useState;\n')).toEqual([]);
  });
});
